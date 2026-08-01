package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

// WP-35: identity is scoped to a workspace.
//
// The acceptance criterion is one sentence with three parts — the same email
// address holds an account in two churches; signing in to one cannot see the
// other's data; and a wrong workspace, a wrong password and a non-existent
// workspace answer the same way. Each is a test below.

// church creates an active church with a slug and returns its id.
func (h *harness) church(t *testing.T, ctx context.Context, slug, name string) bson.ObjectID {
	t.Helper()
	id := bson.NewObjectID()
	_, err := h.db.Global("churches").InsertOne(ctx, bson.M{
		"_id": id, "slug": slug, "name": name, "isActive": true,
	})
	if err != nil {
		t.Fatalf("seed church %s: %v", slug, err)
	}
	return id
}

// account creates a user in a church with a known password.
func (h *harness) account(t *testing.T, ctx context.Context, churchID bson.ObjectID, email, phone, password string) *User {
	t.Helper()
	hash, err := HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	doc := bson.M{
		"churchId":     churchID,
		"name":         "Test Person",
		"role":         "MEMBER",
		"passwordHash": hash,
		"isActive":     true,
		"createdAt":    time.Now().UTC(),
		"updatedAt":    time.Now().UTC(),
	}
	if email != "" {
		doc["email"] = email
	}
	if phone != "" {
		doc["phone"] = phone
	}
	res, err := h.db.Global(Collection).InsertOne(ctx, doc)
	if err != nil {
		t.Fatalf("seed account %s: %v", email, err)
	}
	return &User{ID: res.InsertedID.(bson.ObjectID), Email: email, Phone: phone}
}

// dropGlobalIndexes removes the global uniqueness so a test can exercise the
// end state. The real migration does this through DropGlobalUniqueness, which
// is tested separately; here it is setup, not the thing under test.
func (h *harness) dropGlobalIndexes(t *testing.T, ctx context.Context) {
	t.Helper()
	for _, name := range globalUniqueIndexes {
		_ = h.db.Global(Collection).Indexes().DropOne(ctx, name)
	}
}

// dropAllUniqueness additionally removes the COMPOUND indexes, so a test can
// write the colliding data the preflight is supposed to find. Nothing else
// should use this: it takes the collection to a state the application never
// puts it in.
func (h *harness) dropAllUniqueness(t *testing.T, ctx context.Context) {
	t.Helper()
	h.dropGlobalIndexes(t, ctx)
	for _, name := range []string{"uq_church_email", "uq_church_phone"} {
		_ = h.db.Global(Collection).Indexes().DropOne(ctx, name)
	}
}

// TestOneAddressHoldsAnAccountInTwoChurches is WP-35's headline: the thing a
// global unique index made impossible.
func TestOneAddressHoldsAnAccountInTwoChurches(t *testing.T) {
	h, ctx := newHarness(t)
	h.dropGlobalIndexes(t, ctx)

	grace := h.church(t, ctx, "grace-chapel", "Grace Chapel")
	living := h.church(t, ctx, "living-word", "Living Word")

	const shared = "kofi@example.org"
	h.account(t, ctx, grace, shared, "+233240000001", "GracePassword1")
	h.account(t, ctx, living, shared, "+233240000002", "LivingPassword1")

	graceSession, err := h.svc.LoginWithPassword(ctx, "grace-chapel", shared, "GracePassword1")
	if err != nil {
		t.Fatalf("sign in to grace-chapel: %v", err)
	}
	livingSession, err := h.svc.LoginWithPassword(ctx, "living-word", shared, "LivingPassword1")
	if err != nil {
		t.Fatalf("sign in to living-word: %v", err)
	}

	// Two accounts, not one — and each session belongs to the church it named.
	if graceSession.User.ID == livingSession.User.ID {
		t.Fatal("both sign-ins resolved the same account")
	}
	if graceSession.User.ChurchID.String() != grace.Hex() {
		t.Errorf("grace session is in church %s, want %s", graceSession.User.ChurchID, grace.Hex())
	}
	if livingSession.User.ChurchID.String() != living.Hex() {
		t.Errorf("living session is in church %s, want %s", livingSession.User.ChurchID, living.Hex())
	}
}

// TestTheWrongWorkspaceIsTheWrongPassword is the disclosure property. Naming
// the wrong church for a real address must not be distinguishable from getting
// the password wrong, or the sign-in form answers "which churches is this
// person a member of" one guess at a time.
func TestTheWrongWorkspaceIsTheWrongPassword(t *testing.T) {
	h, ctx := newHarness(t)
	h.dropGlobalIndexes(t, ctx)

	grace := h.church(t, ctx, "grace-chapel", "Grace Chapel")
	h.church(t, ctx, "living-word", "Living Word")
	h.account(t, ctx, grace, "kofi@example.org", "+233240000001", "GracePassword1")

	cases := []struct {
		name                       string
		workspace, email, password string
	}{
		{"right everything but the password", "grace-chapel", "kofi@example.org", "WrongPassword1"},
		{"right address, wrong church", "living-word", "kofi@example.org", "GracePassword1"},
		{"church that does not exist", "no-such-church", "kofi@example.org", "GracePassword1"},
		{"address that does not exist", "grace-chapel", "nobody@example.org", "GracePassword1"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := h.svc.LoginWithPassword(ctx, c.workspace, c.email, c.password)
			if !errors.Is(err, ErrInvalidCredentials) {
				t.Fatalf("got %v, want ErrInvalidCredentials — a distinct answer here "+
					"tells an attacker which half was right", err)
			}
		})
	}
}

// TestAnUnknownWorkspaceStillCostsABcrypt covers the timing half of the same
// property. Returning early for an unknown church makes latency say "no such
// church" even when the message does not.
func TestAnUnknownWorkspaceStillCostsABcrypt(t *testing.T) {
	h, ctx := newHarness(t)
	h.dropGlobalIndexes(t, ctx)

	grace := h.church(t, ctx, "grace-chapel", "Grace Chapel")
	h.account(t, ctx, grace, "kofi@example.org", "+233240000001", "GracePassword1")

	measure := func(workspace, email string) time.Duration {
		start := time.Now()
		_, _ = h.svc.LoginWithPassword(ctx, workspace, email, "WrongPassword1")
		return time.Since(start)
	}

	unknownChurch := measure("no-such-church", "kofi@example.org")
	realChurchWrongPassword := measure("grace-chapel", "kofi@example.org")

	// bcrypt at cost 12 is ~100ms+; a path that skipped it would be
	// sub-millisecond. The assertion is deliberately loose — this is about
	// orders of magnitude, not a benchmark, and a tight bound would be flaky
	// on a loaded CI box.
	if unknownChurch < realChurchWrongPassword/4 {
		t.Fatalf("an unknown workspace answered in %v against %v for a real one; "+
			"response latency is saying which churches exist",
			unknownChurch, realChurchWrongPassword)
	}
}

// TestWithoutAWorkspaceAnAmbiguousAddressIsRefused covers the migration
// fallback. It must resolve exactly one account or refuse — picking either of
// two signs somebody into a church they did not name.
func TestWithoutAWorkspaceAnAmbiguousAddressIsRefused(t *testing.T) {
	h, ctx := newHarness(t)
	h.dropGlobalIndexes(t, ctx)

	grace := h.church(t, ctx, "grace-chapel", "Grace Chapel")
	living := h.church(t, ctx, "living-word", "Living Word")

	const shared = "kofi@example.org"
	h.account(t, ctx, grace, shared, "+233240000001", "SamePassword1")

	// One account: the fallback resolves it, which is what keeps un-updated
	// clients working through the migration.
	if _, err := h.svc.LoginWithPassword(ctx, "", shared, "SamePassword1"); err != nil {
		t.Fatalf("a single account must still resolve without a workspace: %v", err)
	}

	// Two: it must refuse rather than choose.
	h.account(t, ctx, living, shared, "+233240000002", "SamePassword1")
	_, err := h.svc.LoginWithPassword(ctx, "", shared, "SamePassword1")
	if !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("got %v, want ErrInvalidCredentials — signing in without naming a "+
			"workspace must not pick one of two churches", err)
	}
}

// TestWorkspaceIdentifiersAreForgiving covers what a person actually types off
// a printed bulletin.
func TestWorkspaceIdentifiersAreForgiving(t *testing.T) {
	h, ctx := newHarness(t)
	h.dropGlobalIndexes(t, ctx)

	grace := h.church(t, ctx, "grace-chapel", "Grace Chapel")
	h.account(t, ctx, grace, "kofi@example.org", "+233240000001", "GracePassword1")

	for _, typed := range []string{"grace-chapel", "Grace-Chapel", "  grace-chapel  ", "@grace-chapel"} {
		if _, err := h.svc.LoginWithPassword(ctx, typed, "kofi@example.org", "GracePassword1"); err != nil {
			t.Errorf("workspace %q was refused: %v", typed, err)
		}
	}
}

// TestAnInactiveChurchCannotBeSignedInTo — a church that has been deactivated
// must not remain a way in, and must not announce that it exists either.
func TestAnInactiveChurchCannotBeSignedInTo(t *testing.T) {
	h, ctx := newHarness(t)
	h.dropGlobalIndexes(t, ctx)

	closed := bson.NewObjectID()
	_, err := h.db.Global("churches").InsertOne(ctx, bson.M{
		"_id": closed, "slug": "closed-chapel", "name": "Closed Chapel", "isActive": false,
	})
	if err != nil {
		t.Fatalf("seed church: %v", err)
	}
	h.account(t, ctx, closed, "kofi@example.org", "+233240000001", "GracePassword1")

	if _, err := h.svc.LoginWithPassword(ctx, "closed-chapel", "kofi@example.org", "GracePassword1"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("got %v, want ErrInvalidCredentials", err)
	}
}

// --- OTP ---

// TestACodeForOneChurchDoesNotVerifyTheOther is the OTP half of the separation,
// and the one that is least visible: both accounts share a phone number, so
// keyed on the number alone they share one outstanding code.
func TestACodeForOneChurchDoesNotVerifyTheOther(t *testing.T) {
	h, ctx := newHarness(t)
	h.dropGlobalIndexes(t, ctx)

	grace := h.church(t, ctx, "grace-chapel", "Grace Chapel")
	living := h.church(t, ctx, "living-word", "Living Word")

	const shared = "+233249999999"
	graceAccount := h.account(t, ctx, grace, "kofi+grace@example.org", shared, "GracePassword1")
	h.account(t, ctx, living, "kofi+living@example.org", shared, "LivingPassword1")

	// A code for Grace.
	if err := h.svc.RequestOTP(ctx, "grace-chapel", shared); err != nil {
		t.Fatalf("RequestOTP: %v", err)
	}
	graceCode := h.sms.lastCode(t)

	// It must not verify a sign-in to Living Word.
	if _, err := h.svc.VerifyOTP(ctx, "living-word", shared, graceCode); err == nil {
		t.Fatal("a code issued for one church verified a sign-in to another")
	}

	// And it still works for the church it was issued for.
	result, err := h.svc.VerifyOTP(ctx, "grace-chapel", shared, graceCode)
	if err != nil {
		t.Fatalf("VerifyOTP for the issuing church: %v", err)
	}
	if result.User.ID != graceAccount.ID {
		t.Fatalf("verified into the wrong account")
	}
}

// TestBothChurchesCanHaveACodeOutstanding — keyed on the number alone, the
// second request inside the resend window is refused as a duplicate and one of
// the two people cannot sign in at all.
func TestBothChurchesCanHaveACodeOutstanding(t *testing.T) {
	h, ctx := newHarness(t)
	h.dropGlobalIndexes(t, ctx)

	grace := h.church(t, ctx, "grace-chapel", "Grace Chapel")
	living := h.church(t, ctx, "living-word", "Living Word")

	const shared = "+233249999999"
	h.account(t, ctx, grace, "kofi+grace@example.org", shared, "GracePassword1")
	h.account(t, ctx, living, "kofi+living@example.org", shared, "LivingPassword1")

	if err := h.svc.RequestOTP(ctx, "grace-chapel", shared); err != nil {
		t.Fatalf("first request: %v", err)
	}
	if err := h.svc.RequestOTP(ctx, "living-word", shared); err != nil {
		t.Fatalf("a second church could not issue a code for the same number: %v", err)
	}
}

// --- the migration itself ---

// TestPreflightFindsWhatTheIndexWouldReject is the evidence the migration runs
// on. Without it, the collision is discovered by a failed index build on a live
// collection.
func TestPreflightFindsWhatTheIndexWouldReject(t *testing.T) {
	h, ctx := newHarness(t)
	// No uniqueness at all: the point is to write data the compound index
	// would reject and check the preflight reports it BEFORE the build.
	h.dropAllUniqueness(t, ctx)

	grace := h.church(t, ctx, "grace-chapel", "Grace Chapel")
	living := h.church(t, ctx, "living-word", "Living Word")

	// The same address in two churches is FINE — that is the point of WP-35.
	h.account(t, ctx, grace, "shared@example.org", "+233240000001", "Password1")
	h.account(t, ctx, living, "shared@example.org", "+233240000002", "Password1")

	collisions, err := h.svc.PreflightWorkspaceMigration(ctx)
	if err != nil {
		t.Fatalf("preflight: %v", err)
	}
	if len(collisions) != 0 {
		t.Fatalf("the same address in two churches must not be a collision: %v", collisions)
	}

	// The same address TWICE IN ONE church is not.
	h.account(t, ctx, grace, "shared@example.org", "+233240000003", "Password1")

	collisions, err = h.svc.PreflightWorkspaceMigration(ctx)
	if err != nil {
		t.Fatalf("preflight: %v", err)
	}
	if len(collisions) != 1 {
		t.Fatalf("got %d collisions, want 1: %v", len(collisions), collisions)
	}
	if collisions[0].Value != "shared@example.org" || collisions[0].Count != 2 {
		t.Fatalf("collision = %s, want shared@example.org held twice", collisions[0])
	}
}

// TestTheMigrationRefusesToRunOnCollidingData is the guard that makes the
// preflight more than advice.
func TestTheMigrationRefusesToRunOnCollidingData(t *testing.T) {
	h, ctx := newHarness(t)
	h.dropAllUniqueness(t, ctx)

	grace := h.church(t, ctx, "grace-chapel", "Grace Chapel")
	h.account(t, ctx, grace, "twice@example.org", "+233240000001", "Password1")
	h.account(t, ctx, grace, "twice@example.org", "+233240000002", "Password1")

	if _, err := h.svc.DropGlobalUniqueness(ctx); !errors.Is(err, ErrMigrationUnsafe) {
		t.Fatalf("got %v, want ErrMigrationUnsafe — dropping here builds a unique "+
			"index that cannot succeed", err)
	}
}

// TestTheMigrationIsIdempotent — it runs against a database two writers share,
// and either may have got there first.
func TestTheMigrationIsIdempotent(t *testing.T) {
	h, ctx := newHarness(t)

	if _, err := h.svc.DropGlobalUniqueness(ctx); err != nil {
		t.Fatalf("first run: %v", err)
	}
	second, err := h.svc.DropGlobalUniqueness(ctx)
	if err != nil {
		t.Fatalf("second run: %v", err)
	}
	if len(second) != 0 {
		t.Fatalf("the second run dropped %v; it should have found nothing left", second)
	}

	// And the compound uniqueness is still there afterwards.
	if err := h.svc.requireCompoundIndexes(ctx); err != nil {
		t.Fatalf("compound indexes are missing after the migration: %v", err)
	}
}

// TestTheCompoundIndexStillRefusesADuplicateInOneChurch — the migration must
// not trade one address per platform for no uniqueness at all.
func TestTheCompoundIndexStillRefusesADuplicateInOneChurch(t *testing.T) {
	h, ctx := newHarness(t)
	if _, err := h.svc.DropGlobalUniqueness(ctx); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	grace := h.church(t, ctx, "grace-chapel", "Grace Chapel")
	h.account(t, ctx, grace, "once@example.org", "+233240000001", "Password1")

	_, err := h.db.Global(Collection).InsertOne(ctx, bson.M{
		"churchId": grace, "email": "once@example.org", "phone": "+233240000009",
		"name": "Impostor", "isActive": true,
	})
	if err == nil {
		t.Fatal("a second account with the same address in the same church was accepted")
	}
}

// TestAccountsWithoutAnEmailDoNotCollide is the partial-filter half of the
// compound index — the trap that has now bitten this codebase three times.
func TestAccountsWithoutAnEmailDoNotCollide(t *testing.T) {
	h, ctx := newHarness(t)
	if _, err := h.svc.DropGlobalUniqueness(ctx); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	grace := h.church(t, ctx, "grace-chapel", "Grace Chapel")
	// Phone-only members are the common case in this market, not an edge one.
	h.account(t, ctx, grace, "", "+233240000001", "Password1")
	h.account(t, ctx, grace, "", "+233240000002", "Password1")
}
