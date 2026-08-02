package auth

import (
	"context"
	"errors"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"
)

// Q-10 (answered 2 Aug 2026): self-signup is allowed. R-17 is what that opens,
// and these are the two mitigations that live in this package — the kill switch
// and the provenance marker. The third, "verification before the account is
// usable", was already true: Register returns no tokens and VerifyOTP is the
// first point a session may be issued.

// churchWithSignup creates an active church with an explicit signup setting.
func (h *harness) churchWithSignup(t *testing.T, ctx context.Context, slug string, enabled *bool) bson.ObjectID {
	t.Helper()
	id := bson.NewObjectID()
	doc := bson.M{"_id": id, "slug": slug, "name": slug, "isActive": true}
	if enabled != nil {
		doc["selfSignupEnabled"] = *enabled
	}
	if _, err := h.db.Global("churches").InsertOne(ctx, doc); err != nil {
		t.Fatalf("seed church %s: %v", slug, err)
	}
	return id
}

func registration(churchID bson.ObjectID, email, phone string) RegisterRequest {
	return RegisterRequest{
		ChurchID: churchID.Hex(),
		Email:    email,
		Phone:    phone,
		Name:     "Ama Serwaa",
		Password: "AltarOS2026!",
	}
}

func TestAChurchThatPredatesTheSettingStillAcceptsSignups(t *testing.T) {
	// The regression this exists for. Q-10 makes self-signup the default, so
	// the field is a POINTER — every church created before it exists has the
	// field absent, and reading absent as false would close registration
	// platform-wide in a single deploy.
	h, ctx := newHarness(t)
	churchID := h.churchWithSignup(t, ctx, "predates-the-setting", nil)

	user, err := h.svc.Register(ctx, registration(churchID,
		"ama@predates.test", "+233241110001"))
	if err != nil {
		t.Fatalf("a church with no setting refused a signup: %v", err)
	}
	if !user.SelfRegistered {
		t.Error("a self-registration was not marked as one")
	}
}

func TestClosingSelfSignupRefusesNewAccounts(t *testing.T) {
	h, ctx := newHarness(t)
	closed := false
	churchID := h.churchWithSignup(t, ctx, "invitation-only", &closed)

	_, err := h.svc.Register(ctx, registration(churchID,
		"ama@invitation-only.test", "+233241110002"))
	if !errors.Is(err, ErrSelfSignupClosed) {
		t.Fatalf("a closed church accepted a signup: %v", err)
	}

	// Distinct from "no such church": the person needs to be told to ask for
	// an invitation, not left thinking they have the wrong address.
	if errors.Is(err, ErrChurchUnavailable) {
		t.Error("a closed church should not read as an unavailable one")
	}
}

func TestReopeningSelfSignupWorks(t *testing.T) {
	h, ctx := newHarness(t)
	closed := false
	churchID := h.churchWithSignup(t, ctx, "reopened", &closed)

	if _, err := h.svc.Register(ctx, registration(churchID,
		"first@reopened.test", "+233241110003")); !errors.Is(err, ErrSelfSignupClosed) {
		t.Fatalf("setup: expected the church to be closed, got %v", err)
	}

	if _, err := h.db.Global("churches").UpdateOne(ctx,
		bson.M{"_id": churchID},
		bson.M{"$set": bson.M{"selfSignupEnabled": true}}); err != nil {
		t.Fatalf("reopen: %v", err)
	}

	if _, err := h.svc.Register(ctx, registration(churchID,
		"second@reopened.test", "+233241110004")); err != nil {
		t.Fatalf("a reopened church still refused a signup: %v", err)
	}
}

func TestASelfRegisteredAccountGetsNoSessionUntilItIsVerified(t *testing.T) {
	// The mitigation that was already in place, asserted so it stays that way.
	// An account that could sign in before proving control of its phone would
	// make open signup a way to hold sessions in bulk.
	h, ctx := newHarness(t)
	churchID := h.churchWithSignup(t, ctx, "verify-first", nil)

	user, err := h.svc.Register(ctx, registration(churchID,
		"ama@verify-first.test", "+233241110005"))
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if user.PhoneVerified {
		t.Error("a new self-registration should not start verified")
	}
	if !user.PhoneVerificationRequired {
		t.Error("a new self-registration should require verification")
	}
}

func TestAnAccountTheChurchAddedIsNotMarkedSelfRegistered(t *testing.T) {
	// The provenance marker is only useful if it distinguishes. An account
	// created by the church must not carry it, or a church looking at a name it
	// does not recognise learns nothing.
	h, ctx := newHarness(t)
	churchID := h.churchWithSignup(t, ctx, "added-by-office", nil)

	added := h.account(t, ctx, churchID, "office@added.test", "+233241110006", "AltarOS2026!")

	var stored User
	if err := h.db.Global(Collection).FindOne(ctx,
		bson.M{"_id": added.ID}).Decode(&stored); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if stored.SelfRegistered {
		t.Error("an account the church created was marked as self-registered")
	}
}
