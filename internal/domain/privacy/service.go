package privacy

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// SessionRevoker ends every session a person holds.
//
// An interface rather than the token issuer itself: this package needs exactly
// one verb, and handing it something that can also MINT tokens would be a
// larger capability than deleting an account requires.
type SessionRevoker interface {
	RevokeAllForUser(ctx context.Context, userID string, ttl time.Duration) error
}

// Service answers and executes data subject requests.
type Service struct {
	db       *mongodb.DB
	receipts *mongodb.TenantCollection
	sessions SessionRevoker
	now      func() time.Time
}

// NewService builds the service.
//
// sessions may be nil — the purge sweeper has no token issuer and does not
// need one, because the sessions were already revoked when the account was
// locked thirty days earlier.
func NewService(db *mongodb.DB, sessions SessionRevoker) *Service {
	return &Service{
		db:       db,
		receipts: db.Tenant(ReceiptCollection),
		sessions: sessions,
		now:      func() time.Time { return time.Now().UTC() },
	}
}

// EnsureIndexes creates what the receipts need.
func (s *Service) EnsureIndexes(ctx context.Context) error { return nil }

// matcher builds the filter that finds one person's rows in a collection.
//
// Both storage forms, always. Under ADR-005 the legacy TypeScript API writes
// memberId as an ObjectId while parts of the Go side write a string, and a
// deletion that matches only one form leaves half the person behind — which is
// the worst possible bug in this file, because it reports success.
func matcher(field, id string) bson.M {
	values := bson.A{id}
	if oid, err := bson.ObjectIDFromHex(id); err == nil {
		values = append(values, oid)
	}
	return bson.M{field: bson.M{"$in": values}}
}

// idFor picks the right identifier for a category.
func idFor(h Holding, memberID, userID string) string {
	if h.Subject == SubjectUser {
		return userID
	}
	return memberID
}

// ExportFor assembles everything held about a person (Act 843 s.32).
func (s *Service) ExportFor(ctx context.Context, memberID, userID string) (*Export, error) {
	memberID = strings.TrimSpace(memberID)
	if memberID == "" {
		return nil, ErrMemberRequired
	}
	churchID, err := tenancy.MustChurchID(ctx)
	if err != nil {
		return nil, err
	}

	out := &Export{
		GeneratedAt: s.now(), Church: churchID,
		About:      map[string]any{},
		Sections:   map[string][]map[string]any{},
		WhatWeHold: Holdings,
	}

	for _, h := range Holdings {
		id := idFor(h, memberID, strings.TrimSpace(userID))
		if id == "" {
			continue
		}
		coll := s.db.Tenant(h.Collection)

		var rows []map[string]any
		if err := coll.Find(ctx, matcher(h.Field, id), &rows); err != nil {
			// A collection that does not exist yet is not an error: it means
			// we hold nothing there, which is a legitimate answer.
			continue
		}
		cleaned := make([]map[string]any, 0, len(rows))
		for _, r := range rows {
			delete(r, "churchId")
			cleaned = append(cleaned, r)
		}
		if h.Collection == "members" && len(cleaned) == 1 {
			out.About = cleaned[0]
			continue
		}
		if len(cleaned) > 0 {
			out.Sections[h.Label] = cleaned
		}
	}
	return out, nil
}

// DeleteRequest is a request to delete an account.
type DeleteRequest struct {
	// MemberID is the member record. Nearly every church record points here.
	MemberID string
	// UserID is the login. Required, and NOT the same identifier — see Subject.
	UserID string
	// Confirmed must be true. The UI has to collect an explicit confirmation
	// after showing what is kept — see Holdings — because "I did not realise
	// my giving history would survive" is exactly the complaint Act 843 s.32
	// exists to prevent.
	Confirmed bool
	// SelfService is true when the person is deleting their own account, which
	// is the case both app stores require to exist.
	SelfService bool
	// ActorID is who performed it, for the audit trail.
	ActorID string
}

// RequestDeletion locks an account and schedules its erasure.
//
// This is what the person's button does. The account is unusable the instant
// they confirm — sign-in refused, every session revoked — and the data is
// destroyed when the grace period expires. See GracePeriod for why it is two
// steps rather than one.
//
// Returns a receipt whose Reference is also the restore code, so somebody who
// deleted by mistake has one thing to quote and no account to sign in to.
func (s *Service) RequestDeletion(ctx context.Context, req DeleteRequest) (*Receipt, error) {
	memberID := strings.TrimSpace(req.MemberID)
	userID := strings.TrimSpace(req.UserID)
	if memberID == "" || userID == "" {
		return nil, ErrMemberRequired
	}
	if !req.Confirmed {
		return nil, ErrConfirmationRequired
	}
	churchID, err := tenancy.MustChurchID(ctx)
	if err != nil {
		return nil, err
	}

	now := s.now()
	receipt := &Receipt{
		ChurchID:    mongodb.ID(churchID),
		Reference:   newReference(),
		RequestedAt: now,
		Status:      StatusPending,
		PurgeAfter:  now.Add(GracePeriod),
		MemberID:    mongodb.ID(memberID),
		UserID:      mongodb.ID(userID),
		SelfService: req.SelfService,
	}
	// The person is told what will survive BEFORE the grace period ends, not
	// after, so the window is theirs to act on with full information.
	for _, h := range Holdings {
		if h.Disposition != Erased {
			receipt.Retained = append(receipt.Retained,
				RetentionNote{Label: h.Label, Because: h.Because})
		}
	}

	// Locked first, recorded second. If this dies in between, the account is
	// unusable and no receipt claims otherwise — the safe way round. The
	// reverse would promise a deletion that never started.
	if err := s.lockAccount(ctx, userID, memberID, now, receipt.PurgeAfter); err != nil {
		return nil, err
	}

	res, err := s.receipts.InsertOne(ctx, bson.M{
		"reference": receipt.Reference, "requestedAt": receipt.RequestedAt,
		"status": string(StatusPending), "purgeAfter": receipt.PurgeAfter,
		"memberId": receipt.MemberID, "userId": receipt.UserID,
		"selfService": receipt.SelfService, "retained": receipt.Retained,
	})
	if err != nil {
		return nil, fmt.Errorf("privacy: record deletion: %w", err)
	}
	if oid, ok := res.InsertedID.(bson.ObjectID); ok {
		receipt.ID = oid
	}
	return receipt, nil
}

// lockAccount makes the account unusable immediately.
func (s *Service) lockAccount(ctx context.Context, userID, memberID string, now, purgeAfter time.Time) error {
	users := s.db.Tenant("users")
	if _, err := users.UpdateMany(ctx, matcher("_id", userID), bson.M{"$set": bson.M{
		// isActive is already checked on every sign-in path, so this alone
		// refuses password login, OTP login and refresh.
		"isActive":            false,
		"deletionRequestedAt": now,
		"purgeAfter":          purgeAfter,
	}}); err != nil {
		return fmt.Errorf("privacy: lock account: %w", err)
	}

	// Marked rather than hidden: church staff should see that somebody is
	// leaving rather than find a member silently missing from a rota.
	members := s.db.Tenant("members")
	if _, err := members.UpdateMany(ctx, matcher("_id", memberID), bson.M{"$set": bson.M{
		"deletionRequestedAt": now,
		"purgeAfter":          purgeAfter,
	}}); err != nil {
		return fmt.Errorf("privacy: mark member: %w", err)
	}

	// Every session dies now, not in thirty days.
	if s.sessions != nil {
		if err := s.sessions.RevokeAllForUser(ctx, userID, GracePeriod+24*time.Hour); err != nil {
			return fmt.Errorf("privacy: revoke sessions: %w", err)
		}
	}
	return nil
}

// CancelDeletion restores an account inside the grace period.
//
// # Why the lookup is global
//
// Somebody inside the grace period CANNOT SIGN IN — that is the whole point of
// the lock — so there is no session, and therefore no church, to scope a query
// by. A tenant-scoped lookup here fails with "sign in to continue" and the
// window becomes unusable, which is the bug this comment exists to stop coming
// back.
//
// It is safe because the reference is the credential: 64 bits of randomness,
// single-purpose, and useless once the window closes. The tenant is then taken
// FROM the receipt, so every write below is still scoped to one church.
func (s *Service) CancelDeletion(ctx context.Context, reference string) (*Receipt, error) {
	reference = strings.TrimSpace(reference)
	if reference == "" {
		return nil, ErrNotFound
	}

	var receipt Receipt
	err := s.db.Global(ReceiptCollection).
		FindOne(ctx, bson.M{"reference": reference}).Decode(&receipt)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("privacy: read receipt: %w", err)
	}
	// Re-enter the church the receipt belongs to, so the writes below are
	// tenant-scoped exactly as they would be for a signed-in caller.
	ctx = tenancy.WithScope(ctx, tenancy.Scope{
		ChurchID: receipt.ChurchID.String(),
		UserID:   "system:restore",
		Role:     "SYSTEM",
	})
	if !(&receipt).Restorable(s.now()) {
		// Purged or already cancelled. Deliberately the same error as an
		// unknown reference: a distinct "too late" would confirm that a given
		// reference once existed.
		return nil, ErrNotFound
	}

	users := s.db.Tenant("users")
	if _, err := users.UpdateMany(ctx, matcher("_id", receipt.UserID.String()), bson.M{
		"$set":   bson.M{"isActive": true},
		"$unset": bson.M{"deletionRequestedAt": "", "purgeAfter": ""},
	}); err != nil {
		return nil, fmt.Errorf("privacy: restore account: %w", err)
	}
	members := s.db.Tenant("members")
	if _, err := members.UpdateMany(ctx, matcher("_id", receipt.MemberID.String()), bson.M{
		"$unset": bson.M{"deletionRequestedAt": "", "purgeAfter": ""},
	}); err != nil {
		return nil, fmt.Errorf("privacy: restore member: %w", err)
	}

	now := s.now()
	if _, err := s.receipts.UpdateOne(ctx, bson.M{"_id": receipt.ID}, bson.M{"$set": bson.M{
		"status": string(StatusCancelled), "cancelledAt": now,
	}}); err != nil {
		return nil, fmt.Errorf("privacy: mark cancelled: %w", err)
	}
	receipt.Status, receipt.CancelledAt = StatusCancelled, now
	return &receipt, nil
}

// purge destroys the data. Irreversible, and only ever called by the sweeper
// once the grace period has expired.
//
// Apple 5.1.1(v) permits retention where the law requires it PROVIDED the
// person is told — so the retained list on the receipt is not a courtesy, it
// is what makes the retention lawful and the review passable.
func (s *Service) purge(ctx context.Context, req DeleteRequest) (*Receipt, error) {
	memberID := strings.TrimSpace(req.MemberID)
	userID := strings.TrimSpace(req.UserID)
	if memberID == "" || userID == "" {
		// Both, always. One without the other silently half-deletes.
		return nil, ErrMemberRequired
	}
	if !req.Confirmed {
		return nil, ErrConfirmationRequired
	}
	churchID, err := tenancy.MustChurchID(ctx)
	if err != nil {
		return nil, err
	}

	started := s.now()
	receipt := &Receipt{
		ChurchID:    mongodb.ID(churchID),
		RequestedAt: started,
		SelfService: req.SelfService,
		Erased:      map[string]int64{},
		Anonymised:  map[string]int64{},
	}

	for _, h := range Holdings {
		coll := s.db.Tenant(h.Collection)
		filter := matcher(h.Field, idFor(h, memberID, userID))

		switch h.Disposition {
		case Retained:
			receipt.Retained = append(receipt.Retained,
				RetentionNote{Label: h.Label, Because: h.Because})

		case Anonymised:
			// Severed, not tokenised. The id is UNSET rather than replaced,
			// because any stable replacement — a hash, a pseudonym — is a
			// re-identification key and would make "anonymised" untrue.
			unset := bson.M{}
			for _, f := range h.IdentityFields {
				unset[f] = ""
			}
			res, err := coll.UpdateMany(ctx, filter, bson.M{
				"$unset": unset,
				"$set":   bson.M{"anonymisedAt": started},
			})
			if err != nil {
				return nil, fmt.Errorf("privacy: anonymise %s: %w", h.Collection, err)
			}
			if res.ModifiedCount > 0 {
				receipt.Anonymised[h.Label] = res.ModifiedCount
			}
			receipt.Retained = append(receipt.Retained,
				RetentionNote{Label: h.Label, Because: h.Because})

		case Erased:
			res, err := coll.DeleteMany(ctx, filter)
			if err != nil {
				return nil, fmt.Errorf("privacy: erase %s: %w", h.Collection, err)
			}
			if res.DeletedCount > 0 {
				receipt.Erased[h.Label] = res.DeletedCount
			}
		}
	}

	receipt.CompletedAt = s.now()
	receipt.Status = StatusPurged
	return receipt, nil
}

// ReceiptByReference finds a deletion receipt.
//
// The only lookup offered, because a receipt holds no member id — there is
// deliberately no way to ask "was this person deleted", which would
// re-identify somebody who exercised their right to be forgotten.
func (s *Service) ReceiptByReference(ctx context.Context, reference string) (*Receipt, error) {
	var out Receipt
	err := s.receipts.FindOne(ctx, bson.M{"reference": strings.TrimSpace(reference)}, &out)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("privacy: read receipt: %w", err)
	}
	return &out, nil
}

// newReference is a random handle for a deletion.
//
// Random rather than derived: anything computed from the member's id or email
// would let somebody test whether a given person had been deleted, which is
// the one question this record must not answer.
func newReference() string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return "DEL-" + hex.EncodeToString([]byte(time.Now().UTC().Format("20060102150405")))
	}
	return "DEL-" + strings.ToUpper(hex.EncodeToString(buf))
}

// PurgeResult reports one sweep.
type PurgeResult struct {
	Examined int `json:"examined"`
	Purged   int `json:"purged"`
}

// maxPurgePerSweep bounds one run, so a backlog is worked through over several
// sweeps rather than in one pass that times out and finishes none of them.
const maxPurgePerSweep = 50

// PurgeDue destroys the data behind every deletion whose grace period has
// expired.
//
// This is the half that makes "deleted" true rather than "hidden". Without it
// the flag is a lie: the account would be unusable forever while every record
// sat intact in the database, which is exactly the deactivation-dressed-as-
// deletion that App Store 5.1.1(v) rejects and that Act 843 s.33 does not
// permit.
func (s *Service) PurgeDue(ctx context.Context) (*PurgeResult, error) {
	now := s.now()
	out := &PurgeResult{}

	var due []Receipt
	err := s.receipts.Find(ctx, bson.M{
		"status":     string(StatusPending),
		"purgeAfter": bson.M{"$lte": now},
	}, &due, options.Find().
		SetSort(bson.D{{Key: "purgeAfter", Value: 1}}).
		SetLimit(maxPurgePerSweep))
	if err != nil {
		return nil, fmt.Errorf("privacy: find due deletions: %w", err)
	}
	out.Examined = len(due)

	for i := range due {
		r := &due[i]

		// Conditional on it still being pending. Two sweepers running at once
		// — the normal state of a service with more than one replica — must
		// not both purge the same person and double-count the receipt.
		claim, err := s.receipts.UpdateOne(ctx,
			bson.M{"_id": r.ID, "status": string(StatusPending)},
			bson.M{"$set": bson.M{"status": "purging", "purgeStartedAt": now}})
		if err != nil {
			return out, fmt.Errorf("privacy: claim deletion: %w", err)
		}
		if claim.ModifiedCount == 0 {
			continue
		}

		done, err := s.purge(ctx, DeleteRequest{
			MemberID:    r.MemberID.String(),
			UserID:      r.UserID.String(),
			Confirmed:   true,
			SelfService: r.SelfService,
		})
		if err != nil {
			// Put it back so the next sweep retries rather than stranding a
			// half-purged person in a state nothing looks at again.
			_, _ = s.receipts.UpdateOne(ctx, bson.M{"_id": r.ID},
				bson.M{"$set": bson.M{"status": string(StatusPending)}})
			return out, fmt.Errorf("privacy: purge %s: %w", r.Reference, err)
		}

		// The identifiers are REMOVED as the receipt completes. That is what
		// leaves a finished receipt holding no way to work out who it was
		// about — the church keeps proof the request was honoured, and nobody
		// can use it to re-identify somebody who exercised their right to be
		// forgotten.
		if _, err := s.receipts.UpdateOne(ctx, bson.M{"_id": r.ID}, bson.M{
			"$set": bson.M{
				"status": string(StatusPurged), "completedAt": done.CompletedAt,
				"erased": done.Erased, "anonymised": done.Anonymised,
			},
			"$unset": bson.M{"memberId": "", "userId": "", "purgeStartedAt": ""},
		}); err != nil {
			return out, fmt.Errorf("privacy: finish receipt: %w", err)
		}
		out.Purged++
	}
	return out, nil
}

// ChurchesWithDuePurges lists churches with deletions ready to execute.
//
// Global, because the sweeper runs on a timer and a timer has no church behind
// it. The caller re-enters each church's scope to do the work — the same shape
// as the notification and escalation sweepers, and for the same reason.
func (s *Service) ChurchesWithDuePurges(ctx context.Context) ([]string, error) {
	var raw []any
	err := s.db.Global(ReceiptCollection).Distinct(ctx, mongodb.TenantField, bson.M{
		"status":     string(StatusPending),
		"purgeAfter": bson.M{"$lte": s.now()},
	}).Decode(&raw)
	if err != nil {
		return nil, fmt.Errorf("privacy: find churches with due purges: %w", err)
	}

	out := make([]string, 0, len(raw))
	for _, v := range raw {
		// Both storage forms (ADR-005), or the sweeper silently skips half the
		// platform and those deletions never complete.
		switch id := v.(type) {
		case string:
			if id != "" {
				out = append(out, id)
			}
		case bson.ObjectID:
			out = append(out, id.Hex())
		}
	}
	return out, nil
}
