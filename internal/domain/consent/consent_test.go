package consent

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
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
		t.Skipf("MongoDB unavailable (run `make infra-up`): %v", err)
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
