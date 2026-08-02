package consent

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

const (
	churchA = "church_consent_a"
	churchB = "church_consent_b"
)

func newService(t *testing.T) (*Service, context.Context) {
	t.Helper()

	uri := os.Getenv("MONGODB_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	db, err := mongodb.Connect(ctx, config.MongoConfig{
		URI:            uri,
		Database:       "altar_test_consent",
		ConnectTimeout: 3 * time.Second,
	})
	if err != nil {
		testsupport.SkipOrFail(t, "MongoDB", err)
	}

	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = db.Database().Drop(c)
		_ = db.Close(c)
	})

	svc := NewService(db, nil)
	scoped := tenancy.WithScope(context.Background(), tenancy.Scope{ChurchID: churchA})
	if err := svc.EnsureIndexes(scoped); err != nil {
		t.Fatalf("EnsureIndexes: %v", err)
	}
	return svc, scoped
}

// WP-06 acceptance: revoking communications consent causes a broadcast to skip
// that member.
func TestRevokingCommunicationsSuppressesBroadcast(t *testing.T) {
	svc, ctx := newService(t)

	audience := []string{"m1", "m2", "m3"}
	for _, id := range audience {
		if err := svc.Grant(ctx, id, PurposeCommunications, SourceSignup, "v1", "admin"); err != nil {
			t.Fatalf("grant %s: %v", id, err)
		}
	}

	allowed, err := svc.FilterAllowed(ctx, audience, PurposeCommunications)
	if err != nil {
		t.Fatalf("FilterAllowed: %v", err)
	}
	if len(allowed) != 3 {
		t.Fatalf("all three opted in, want 3 recipients, got %d (%v)", len(allowed), allowed)
	}

	// m2 withdraws.
	if err := svc.Revoke(ctx, "m2", PurposeCommunications, SourceWithdrawal, "m2"); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	allowed, err = svc.FilterAllowed(ctx, audience, PurposeCommunications)
	if err != nil {
		t.Fatalf("FilterAllowed after revoke: %v", err)
	}
	if len(allowed) != 2 {
		t.Fatalf("after revocation want 2 recipients, got %d (%v)", len(allowed), allowed)
	}
	for _, id := range allowed {
		if id == "m2" {
			t.Fatal("m2 revoked consent and must not receive the broadcast")
		}
	}

	granted, err := svc.IsGranted(ctx, "m2", PurposeCommunications)
	if err != nil {
		t.Fatalf("IsGranted: %v", err)
	}
	if granted {
		t.Error("IsGranted must reflect the revocation")
	}
}

// Re-granting after a revoke must work; consent is not one-way.
func TestConsentCanBeRestored(t *testing.T) {
	svc, ctx := newService(t)

	if err := svc.Grant(ctx, "m1", PurposeCommunications, SourceSignup, "v1", ""); err != nil {
		t.Fatalf("grant: %v", err)
	}
	if err := svc.Revoke(ctx, "m1", PurposeCommunications, SourceWithdrawal, ""); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if err := svc.Grant(ctx, "m1", PurposeCommunications, SourceMemberApp, "v2", ""); err != nil {
		t.Fatalf("re-grant: %v", err)
	}

	granted, err := svc.IsGranted(ctx, "m1", PurposeCommunications)
	if err != nil {
		t.Fatalf("IsGranted: %v", err)
	}
	if !granted {
		t.Error("the most recent decision (re-grant) should win")
	}
}

// Purposes are independent: withdrawing from messaging must not stop the
// church recording that member's giving.
func TestPurposesAreIndependent(t *testing.T) {
	svc, ctx := newService(t)

	if err := svc.Grant(ctx, "m1", PurposeCommunications, SourceSignup, "v1", ""); err != nil {
		t.Fatalf("grant comms: %v", err)
	}
	if err := svc.Revoke(ctx, "m1", PurposeCommunications, SourceWithdrawal, ""); err != nil {
		t.Fatalf("revoke comms: %v", err)
	}

	giving, err := svc.IsGranted(ctx, "m1", PurposeGiving)
	if err != nil {
		t.Fatalf("IsGranted giving: %v", err)
	}
	if !giving {
		t.Error("revoking communications must not revoke giving")
	}
}

// Absence of a record must not be read as consent for purposes that require
// explicit opt-in. Failing closed is the point.
func TestUnrecordedConsentFailsClosedForOptInPurposes(t *testing.T) {
	svc, ctx := newService(t)

	for _, p := range []Purpose{PurposeCommunications, PurposeAIProcessing} {
		granted, err := svc.IsGranted(ctx, "never_asked", p)
		if err != nil {
			t.Fatalf("IsGranted %s: %v", p, err)
		}
		if granted {
			t.Errorf("%s must require explicit opt-in; absence of a record is not consent", p)
		}
	}

	// And a broadcast to members who were never asked reaches nobody.
	allowed, err := svc.FilterAllowed(ctx, []string{"never_asked"}, PurposeCommunications)
	if err != nil {
		t.Fatalf("FilterAllowed: %v", err)
	}
	if len(allowed) != 0 {
		t.Errorf("members who never opted in must not be messaged, got %v", allowed)
	}
}

// Membership and giving are necessary to deliver the service, so they are not
// blocked by the absence of a separate opt-in.
func TestServiceNecessaryPurposesAreImplied(t *testing.T) {
	svc, ctx := newService(t)

	for _, p := range []Purpose{PurposeMembership, PurposeGiving} {
		granted, err := svc.IsGranted(ctx, "new_member", p)
		if err != nil {
			t.Fatalf("IsGranted %s: %v", p, err)
		}
		if !granted {
			t.Errorf("%s is necessary to provide the service and should not need a separate opt-in", p)
		}
	}
}

// Consent is tenant-scoped: one church's grant must never authorise another
// church to message the same person.
func TestConsentDoesNotCrossChurches(t *testing.T) {
	svc, ctxA := newService(t)
	ctxB := tenancy.WithScope(context.Background(), tenancy.Scope{ChurchID: churchB})

	if err := svc.Grant(ctxA, "shared_member", PurposeCommunications, SourceSignup, "v1", ""); err != nil {
		t.Fatalf("grant in church A: %v", err)
	}

	granted, err := svc.IsGranted(ctxB, "shared_member", PurposeCommunications)
	if err != nil {
		t.Fatalf("IsGranted in church B: %v", err)
	}
	if granted {
		t.Fatal("a grant to church A must not authorise church B")
	}
}

// An unrecognised purpose is never granted, and is reported rather than
// silently treated as allowed.
func TestUnknownPurposeIsRefused(t *testing.T) {
	svc, ctx := newService(t)

	granted, err := svc.IsGranted(ctx, "m1", Purpose("marketing_partners"))
	if !errors.Is(err, ErrUnknownPurpose) {
		t.Fatalf("want ErrUnknownPurpose, got %v", err)
	}
	if granted {
		t.Error("an unknown purpose must never be granted")
	}
}

// History backs data-subject access requests, so it must retain superseded
// decisions rather than only the current state.
func TestHistoryRetainsSupersededDecisions(t *testing.T) {
	svc, ctx := newService(t)

	if err := svc.Grant(ctx, "m1", PurposeCommunications, SourceSignup, "v1", ""); err != nil {
		t.Fatalf("grant: %v", err)
	}
	if err := svc.Revoke(ctx, "m1", PurposeCommunications, SourceWithdrawal, ""); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	history, err := svc.History(ctx, "m1")
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(history) != 2 {
		t.Fatalf("both the grant and the revocation must be retained, got %d", len(history))
	}
	if history[0].Granted {
		t.Error("history should be newest-first; the revocation should lead")
	}
}

func TestEmptyAudienceIsHandled(t *testing.T) {
	svc, ctx := newService(t)

	allowed, err := svc.FilterAllowed(ctx, nil, PurposeCommunications)
	if err != nil {
		t.Fatalf("FilterAllowed(nil): %v", err)
	}
	if len(allowed) != 0 {
		t.Errorf("empty audience should yield no recipients, got %v", allowed)
	}
}

// The bug this test exists for was invisible for months, and the reason it was
// invisible is the interesting part.
//
// TenantCollection stamps churchId as a BSON ObjectId whenever the church id is
// valid hex, so that documents stay readable by the legacy Mongoose schema
// (ADR-005). Record.ChurchID was declared as a plain `string`, and the driver
// refuses to decode an ObjectId into one. Every read of a consent record in
// production would therefore fail with a BSON error.
//
// It never fired here because every fixture above uses "church_consent_a",
// which is NOT valid hex — so the wrapper stored it as a string and the string
// field decoded it happily. The tests passed for a reason that does not hold in
// production.
//
// It never fired in the product either, because the only caller is the consent
// check, and the only messages that reach it are announcements and pastoral
// notes. Receipts and OTPs are transactional and skip the check by design. The
// first church broadcast would have failed for the entire congregation.
func TestConsentReadsBackWhenTheChurchIDIsARealObjectID(t *testing.T) {
	svc, _ := newService(t)

	// A REAL ObjectID, as every production church has.
	churchID := bson.NewObjectID().Hex()
	ctx := tenancy.WithScope(context.Background(), tenancy.Scope{ChurchID: churchID})

	const memberID = "member_objectid_church"
	if err := svc.Grant(ctx, memberID, PurposeCommunications,
		SourceSignup, "v1", "system"); err != nil {
		t.Fatalf("Grant: %v", err)
	}

	granted, err := svc.IsGranted(ctx, memberID, PurposeCommunications)
	if err != nil {
		t.Fatalf("IsGranted against an ObjectId church: %v", err)
	}
	if !granted {
		t.Fatal("consent was granted but does not read back")
	}

	// And the id survives the round trip in a usable form.
	history, err := svc.History(ctx, memberID)
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(history) == 0 {
		t.Fatal("no history for a granted consent")
	}
	if history[0].ChurchID.String() != churchID {
		t.Errorf("ChurchID = %q, want %q", history[0].ChurchID, churchID)
	}
}

// FilterAllowed is what a broadcast actually calls, so it gets the same test.
func TestFilterAllowedWorksAgainstAnObjectIDChurch(t *testing.T) {
	svc, _ := newService(t)

	churchID := bson.NewObjectID().Hex()
	ctx := tenancy.WithScope(context.Background(), tenancy.Scope{ChurchID: churchID})

	consenting := "member_yes"
	declining := "member_no"
	if err := svc.Grant(ctx, consenting, PurposeCommunications,
		SourceSignup, "v1", "system"); err != nil {
		t.Fatalf("Grant: %v", err)
	}
	if err := svc.Revoke(ctx, declining, PurposeCommunications,
		SourceWithdrawal, "system"); err != nil {
		t.Fatalf("Revoke: %v", err)
	}

	allowed, err := svc.FilterAllowed(ctx,
		[]string{consenting, declining, "member_unknown"}, PurposeCommunications)
	if err != nil {
		t.Fatalf("FilterAllowed: %v", err)
	}
	if len(allowed) != 1 || allowed[0] != consenting {
		t.Fatalf("allowed = %v, want exactly [%s] — unrecorded consent fails closed",
			allowed, consenting)
	}
}
