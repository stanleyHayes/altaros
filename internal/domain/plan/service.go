package plan

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// Service reads and changes what a church is entitled to.
type Service struct {
	subs   *mongodb.TenantCollection
	global *mongo.Collection
	now    func() time.Time
}

// NewService builds the service.
func NewService(db *mongodb.DB) *Service {
	return &Service{
		subs:   db.Tenant(Collection),
		global: db.Global(Collection),
		now:    func() time.Time { return time.Now().UTC() },
	}
}

// EnsureIndexes creates what the plan lookup needs.
func (s *Service) EnsureIndexes(ctx context.Context) error {
	return s.subs.EnsureIndexes(ctx, []mongo.IndexModel{{
		// One subscription per church. Two would give the platform two
		// answers about what a church may do, and whichever the query
		// happened to return would decide whether a service could start.
		Keys:    bson.D{{Key: "churchId", Value: 1}},
		Options: options.Index().SetName("church_plan").SetUnique(true),
	}})
}

// For returns what the calling church may do right now.
//
// A church with NO subscription record gets the free tier rather than an
// error. Every church that has ever signed up predates this collection, and a
// missing row must mean "has not paid us yet", not "cannot use the product".
func (s *Service) For(ctx context.Context) (Entitlement, error) {
	sub, err := s.Current(ctx)
	if err != nil {
		return Entitlement{}, err
	}
	return sub.Effective(), nil
}

// Current returns the calling church's subscription, inventing a free one if
// there is none.
func (s *Service) Current(ctx context.Context) (*Subscription, error) {
	churchID, err := tenancy.MustChurchID(ctx)
	if err != nil {
		return nil, err
	}

	var sub Subscription
	err = s.subs.FindOne(ctx, bson.M{}, &sub)
	if errors.Is(err, mongo.ErrNoDocuments) {
		// Not persisted: reading a plan must not write one, or a health check
		// against a church would create rows nobody asked for.
		return &Subscription{
			ChurchID: mongodb.ID(churchID),
			Tier:     TierFree, Status: StatusActive,
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("plan: read subscription: %w", err)
	}
	return &sub, nil
}

// SetTier moves a church onto a plan.
//
// Upsert, because the first time a church pays is also the first time it has a
// row. Status is set to active: somebody has just decided this church is on
// this plan, and leaving a stale suspension behind would sell them something
// they cannot use.
func (s *Service) SetTier(ctx context.Context, tier Tier, actorID string) (*Subscription, error) {
	if EntitlementFor(tier).Tier != tier {
		return nil, fmt.Errorf("%w: %q", ErrTierUnknown, tier)
	}
	now := s.now()

	if _, err := s.subs.UpsertOne(ctx, bson.M{}, bson.M{
		"$set": bson.M{
			"tier": string(tier), "status": string(StatusActive),
			"updatedAt": now,
		},
		"$unset":       bson.M{"pastDueSince": ""},
		"$setOnInsert": bson.M{"createdAt": now},
	}); err != nil {
		return nil, fmt.Errorf("plan: set tier: %w", err)
	}
	return s.Current(ctx)
}

// MarkPastDue records a failed subscription payment.
//
// The grace clock starts on the FIRST failure and is not restarted by later
// ones. A card that fails every night for a fortnight would otherwise reset
// the clock nightly and never expire, which is a church streaming for free
// forever because its payment method is broken rather than because we decided
// to let it.
func (s *Service) MarkPastDue(ctx context.Context) (*Subscription, error) {
	now := s.now()
	if _, err := s.subs.UpdateOne(ctx,
		bson.M{"status": bson.M{"$ne": string(StatusSuspended)}},
		bson.M{
			"$set":         bson.M{"status": string(StatusPastDue), "updatedAt": now},
			"$setOnInsert": bson.M{"pastDueSince": now},
		}); err != nil {
		return nil, fmt.Errorf("plan: mark past due: %w", err)
	}
	// $setOnInsert does not fire on an update, so the clock is started
	// explicitly and only when it is not already running.
	if _, err := s.subs.UpdateOne(ctx,
		bson.M{"pastDueSince": bson.M{"$exists": false}},
		bson.M{"$set": bson.M{"pastDueSince": now}}); err != nil {
		return nil, fmt.Errorf("plan: start grace clock: %w", err)
	}
	return s.Current(ctx)
}

// MarkPaid clears a past-due state after a successful payment.
func (s *Service) MarkPaid(ctx context.Context, periodEnd time.Time) (*Subscription, error) {
	now := s.now()
	if _, err := s.subs.UpdateOne(ctx, bson.M{}, bson.M{
		"$set":   bson.M{"status": string(StatusActive), "currentPeriodEnd": periodEnd, "updatedAt": now},
		"$unset": bson.M{"pastDueSince": ""},
	}); err != nil {
		return nil, fmt.Errorf("plan: mark paid: %w", err)
	}
	return s.Current(ctx)
}

// SetCommissionOverride records a negotiated rate, or clears it with nil.
func (s *Service) SetCommissionOverride(ctx context.Context, basisPoints *int64) (*Subscription, error) {
	update := bson.M{"$set": bson.M{"updatedAt": s.now()}}
	if basisPoints == nil {
		update["$unset"] = bson.M{"commissionOverrideBasisPoints": ""}
	} else {
		update["$set"].(bson.M)["commissionOverrideBasisPoints"] = *basisPoints
	}
	if _, err := s.subs.UpdateOne(ctx, bson.M{}, update); err != nil {
		return nil, fmt.Errorf("plan: set commission override: %w", err)
	}
	return s.Current(ctx)
}

// SuspendExpired suspends churches whose grace period has run out.
//
// Global, because it runs on a timer and a timer has no church behind it. It
// only ever moves past_due to suspended — it never touches an active
// subscription, so a bug here cannot take a paying church off the air.
func (s *Service) SuspendExpired(ctx context.Context) (int64, error) {
	cutoff := s.now().Add(-GracePeriod)

	res, err := s.global.UpdateMany(ctx, bson.M{
		"status":       string(StatusPastDue),
		"pastDueSince": bson.M{"$lt": cutoff},
	}, bson.M{"$set": bson.M{
		"status": string(StatusSuspended), "updatedAt": s.now(),
	}})
	if err != nil {
		return 0, fmt.Errorf("plan: suspend expired: %w", err)
	}
	return res.ModifiedCount, nil
}
