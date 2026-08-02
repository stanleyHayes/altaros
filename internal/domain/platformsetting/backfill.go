package platformsetting

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// Backfilling the commission rate onto existing provider subaccounts.
//
// # What this is and is not for
//
// It is NOT what makes a rate change take effect. Every charge ALTAR OS
// initialises carries an explicit per-transaction charge computed from the live
// rate, and that overrides whatever is stored on the subaccount. Measured
// against Paystack's test API on 2 Aug 2026: two identical GHS 100 charges
// against one subaccount stored at 2.5%, one sending an explicit charge of 150
// and one not, split 150/9655 and 250/9555 respectively.
//
// What it IS for is every charge ALTAR OS did not originate — a payment link
// created in the provider's dashboard, a recurring plan set up there, a future
// code path that forgets the explicit charge — and for the number a church sees
// when it logs into the provider. A stale figure there is something they can
// reasonably dispute, and "our API sends a different number" is not an answer
// anybody wants to give.

// SubaccountUpdater is the slice of the payment gateway a backfill needs.
//
// Narrower than payments.Gateway on purpose: this operation writes commission
// splits across every church on the platform, and it should not be holding
// something that can also initialise charges or move money.
type SubaccountUpdater interface {
	UpdateSubaccountCommission(ctx context.Context, code string, commissionBasisPoints int64) error
}

// maxBackfillChurches bounds one run.
//
// A ceiling rather than a page size: the run is resumable and idempotent, so
// hitting it means "run it again", not "some churches were silently skipped" —
// and the result says which is which.
const maxBackfillChurches = 500

// perChurchTimeout bounds one provider call.
//
// Short, because the failure being guarded against is not a slow provider but a
// hung one: without it, one church that never answers holds the whole backfill
// open and an operator sees a request that never returns and no way to tell how
// far it got.
const perChurchTimeout = 15 * time.Second

// ChurchResult is what happened to one church.
type ChurchResult struct {
	ChurchID string `json:"churchId"`
	Name     string `json:"name"`
	// BasisPoints is the rate that applies to this church — its own negotiated
	// override if it has one, otherwise the platform rate.
	BasisPoints int64 `json:"basisPoints"`
	// Negotiated marks a church on its own rate rather than the platform's.
	Negotiated bool `json:"negotiated,omitempty"`
	// Outcome is one of: updated, unchanged, skipped, failed.
	Outcome string `json:"outcome"`
	Reason  string `json:"reason,omitempty"`
}

// Backfill outcomes.
const (
	OutcomeUpdated   = "updated"
	OutcomeUnchanged = "unchanged"
	OutcomeSkipped   = "skipped"
	OutcomeFailed    = "failed"
)

// BackfillReport is the whole run.
type BackfillReport struct {
	Updated   int `json:"updated"`
	Unchanged int `json:"unchanged"`
	Skipped   int `json:"skipped"`
	Failed    int `json:"failed"`
	// Churches is every church considered, with what happened to it. Returned
	// in full rather than summarised: a backfill that reports "197 of 200"
	// without saying which three is a backfill nobody can finish.
	Churches []ChurchResult `json:"churches"`
	// Truncated is true when more churches exist than one run handles.
	Truncated bool `json:"truncated,omitempty"`
	// DryRun reports what WOULD change without changing it.
	DryRun bool `json:"dryRun"`
	// Note explains what this operation does and does not affect, in the
	// response rather than in documentation somebody has to find.
	Note string `json:"note"`
	// RanAt is when.
	RanAt time.Time `json:"ranAt"`
}

// BackfillCommission writes each church's effective commission onto its
// provider subaccount.
//
// dryRun reports what would change without changing anything, which is the
// mode an operator should reach for first: this writes a money-splitting
// parameter across every church on the platform, and being able to read the
// list before pressing the button is the difference between a considered change
// and a discovered one.
func (s *Service) BackfillCommission(ctx context.Context, db *mongodb.DB,
	gateway SubaccountUpdater, dryRun bool) (*BackfillReport, error) {

	current, err := s.Current(ctx)
	if err != nil {
		return nil, err
	}

	// Global(), because this crosses every tenant by definition. Only churches
	// that actually have a subaccount: one that has never been onboarded to the
	// provider has nothing to write to, and counting it as a failure would make
	// every run look broken.
	cursor, err := db.Global("churches").Find(ctx,
		bson.M{"payoutSubaccountCode": bson.M{"$nin": bson.A{nil, ""}}},
		options.Find().SetLimit(maxBackfillChurches+1).
			SetSort(bson.D{{Key: "_id", Value: 1}}))
	if err != nil {
		return nil, fmt.Errorf("platformsetting: find churches: %w", err)
	}

	var churches []struct {
		ID                    bson.ObjectID `bson:"_id"`
		Name                  string        `bson:"name"`
		PayoutSubaccount      string        `bson:"payoutSubaccountCode"`
		CommissionBasisPoints *int64        `bson:"commissionBasisPoints"`
		SyncedBasisPoints     *int64        `bson:"commissionSyncedBasisPoints"`
	}
	if err := cursor.All(ctx, &churches); err != nil {
		return nil, fmt.Errorf("platformsetting: read churches: %w", err)
	}

	report := &BackfillReport{
		RanAt:  s.now().UTC(),
		DryRun: dryRun,
		Note: "This updates the split stored with the payment provider. It does " +
			"NOT change what ALTAR OS charges: every gift taken through ALTAR OS " +
			"already uses the current rate, because it is sent with each " +
			"transaction. This matters for payment links or recurring plans set " +
			"up directly in the provider's dashboard, and for the figure a church " +
			"sees when it logs in there.",
	}
	if len(churches) > maxBackfillChurches {
		churches = churches[:maxBackfillChurches]
		report.Truncated = true
	}

	for _, ch := range churches {
		// The church's OWN rate wins. A blanket backfill that overwrote a
		// negotiated rate would silently re-price a launch partner — and
		// because the pointer distinguishes "no override" from "override of
		// zero", a partner on 0% keeps 0% rather than being quietly moved to
		// the platform default.
		bps := current.CommissionBasisPoints
		negotiated := false
		if ch.CommissionBasisPoints != nil {
			bps, negotiated = *ch.CommissionBasisPoints, true
		}

		result := ChurchResult{
			ChurchID:    ch.ID.Hex(),
			Name:        ch.Name,
			BasisPoints: bps,
			Negotiated:  negotiated,
		}

		// Already at the right rate. Skipping is what makes a re-run cheap and
		// makes "run it again after a partial failure" the correct advice
		// rather than a way to hammer the provider.
		if ch.SyncedBasisPoints != nil && *ch.SyncedBasisPoints == bps {
			result.Outcome = OutcomeUnchanged
			report.Unchanged++
			report.Churches = append(report.Churches, result)
			continue
		}

		if dryRun {
			result.Outcome = OutcomeSkipped
			result.Reason = "dry run — would be updated"
			report.Skipped++
			report.Churches = append(report.Churches, result)
			continue
		}

		callCtx, cancel := context.WithTimeout(ctx, perChurchTimeout)
		err := gateway.UpdateSubaccountCommission(callCtx, ch.PayoutSubaccount, bps)
		cancel()

		if err != nil {
			// Recorded on the church, not only in the response. An operator who
			// closes the tab still has to be able to find out which churches
			// did not take.
			result.Outcome, result.Reason = OutcomeFailed, err.Error()
			report.Failed++
			s.recordSync(ctx, db, ch.ID, nil, err.Error())
			report.Churches = append(report.Churches, result)

			// Keep going. One church whose subaccount was closed at the
			// provider must not stop the other 199 — and because the operation
			// is idempotent, the ones that did succeed stay succeeded.
			continue
		}

		result.Outcome = OutcomeUpdated
		report.Updated++
		s.recordSync(ctx, db, ch.ID, &bps, "")
		report.Churches = append(report.Churches, result)
	}

	if report.Churches == nil {
		report.Churches = []ChurchResult{}
	}
	return report, nil
}

// recordSync stamps what the provider now holds for a church.
//
// Best effort: a failed bookkeeping write must not turn a successful provider
// update into a reported failure, because the next run would then try to apply
// something already applied. The cost of losing the stamp is one redundant
// call on the next run, which is harmless precisely because the update is
// idempotent.
func (s *Service) recordSync(ctx context.Context, db *mongodb.DB,
	churchID bson.ObjectID, bps *int64, failure string) {

	set := bson.M{"commissionSyncedAt": s.now().UTC()}
	unset := bson.M{}
	if bps != nil {
		set["commissionSyncedBasisPoints"] = *bps
	}
	if failure != "" {
		set["commissionSyncError"] = failure
	} else {
		unset["commissionSyncError"] = ""
	}

	update := bson.M{"$set": set}
	if len(unset) > 0 {
		update["$unset"] = unset
	}
	_, _ = db.Global("churches").UpdateOne(ctx, bson.M{"_id": churchID}, update)
}

// ErrNoGateway means a backfill was asked for with no payment provider.
var ErrNoGateway = errors.New("platformsetting: no payment provider is configured")
