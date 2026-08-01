package rbac

import (
	"context"
	"errors"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

// unseeded builds a service against a church that has NEVER had system roles
// provisioned — which, before this was fixed, was every church that did not
// come out of `make seed`.
func unseeded(t *testing.T) (*Service, context.Context) {
	t.Helper()

	connectCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	db, err := mongodb.Connect(connectCtx, config.MongoConfig{
		URI:            testsupport.MongoURI(),
		Database:       "altar_test_rbac_provisioning",
		ConnectTimeout: 5 * time.Second,
	})
	if err != nil {
		testsupport.SkipOrFail(t, "MongoDB", err)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = db.Database().Drop(c)
		_ = db.Close(c)
	})

	svc := NewService(db)
	// A brand-new church id, and deliberately NO EnsureSystemRoles call.
	ctx := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: bson.NewObjectID().Hex(),
		UserID:   bson.NewObjectID().Hex(),
		Role:     "CHURCH_ADMIN",
	})
	if err := svc.EnsureIndexes(ctx); err != nil {
		t.Fatalf("EnsureIndexes: %v", err)
	}
	return svc, ctx
}

// TestAChurchWithoutProvisionedRolesStillWorks is the regression test for the
// worst bug in WP-36, which shipped and which only an audit of the wiring
// found.
//
// EnsureSystemRoles was called from exactly one place: the seeder. A church
// created through the real signup flow — or by the legacy TypeScript API, which
// has never heard of roles and under ADR-005 writes the same database — got
// none. roleFor then fell through to its "unassigned" fallback, which holds
// nil permissions, and every person in that church including its administrator
// held NOTHING. Failing closed is right; failing closed for every real customer
// while passing every test against seeded data is not.
func TestAChurchWithoutProvisionedRolesStillWorks(t *testing.T) {
	svc, ctx := unseeded(t)

	scope, _ := tenancy.FromContext(ctx)
	adminID := bson.NewObjectID()
	_, err := svc.users.InsertOne(ctx, bson.M{
		"_id":   adminID,
		"email": "pastor@unseeded.example",
		"name":  "Unseeded Admin",
		// What the legacy TypeScript API writes: a role enum and no roleId.
		"role":     "CHURCH_ADMIN",
		"isActive": true,
	})
	if err != nil {
		t.Fatalf("create admin: %v", err)
	}

	assignment, err := svc.AssignmentFor(ctx, adminID.Hex())
	if err != nil {
		t.Fatalf("AssignmentFor: %v", err)
	}

	if assignment.Effective.Can(ResourceMember, ActionRead) {
		// Sanity: this is what we want.
	}
	if len(assignment.Effective) == 0 {
		t.Fatalf("a church administrator in an unprovisioned church holds NOTHING "+
			"(role %q) — every RBAC-guarded route 404s and the dashboard renders "+
			"an empty sidebar for a real customer", assignment.RoleName)
	}

	// And specifically: an admin must be an admin.
	for _, want := range []Permission{
		NewPermission(ResourceMember, ActionRead),
		NewPermission(ResourceFinance, ActionRead),
		NewPermission(ResourceUser, ActionCreate),
		NewPermission(ResourceRole, ActionCreate),
	} {
		if !assignment.Effective.Has(want) {
			t.Errorf("admin is missing %s in an unprovisioned church", want)
		}
	}

	_ = scope
}

// TestAnUnprovisionedMemberGetsTheMemberRole checks the other end: the fallback
// must not hand out administrator permissions to make the test above pass.
func TestAnUnprovisionedMemberGetsTheMemberRole(t *testing.T) {
	svc, ctx := unseeded(t)

	memberID := bson.NewObjectID()
	if _, err := svc.users.InsertOne(ctx, bson.M{
		"_id": memberID, "email": "member@unseeded.example",
		"role": "MEMBER", "isActive": true,
	}); err != nil {
		t.Fatalf("create member: %v", err)
	}

	assignment, err := svc.AssignmentFor(ctx, memberID.Hex())
	if err != nil {
		t.Fatalf("AssignmentFor: %v", err)
	}

	if assignment.Effective.Can(ResourceFinance, ActionRead) {
		t.Error("a member must not read the church books")
	}
	if assignment.Effective.Can(ResourceRole, ActionCreate) {
		t.Error("a member must not create roles")
	}
	if !assignment.Effective.Can(ResourceEvent, ActionRead) {
		t.Error("a member should still read events")
	}
}

// TestProvisioningIsIdempotentUnderConcurrency covers the self-healing path
// being hit by several requests at once, which is exactly what happens on the
// first page load after a church is created — a dashboard fires six requests to
// paint one screen.
func TestProvisioningIsIdempotentUnderConcurrency(t *testing.T) {
	svc, ctx := unseeded(t)

	userID := bson.NewObjectID()
	if _, err := svc.users.InsertOne(ctx, bson.M{
		"_id": userID, "email": "racer@unseeded.example",
		"role": "CHURCH_ADMIN", "isActive": true,
	}); err != nil {
		t.Fatalf("create user: %v", err)
	}

	const attempts = 8
	errs := make(chan error, attempts)
	for range attempts {
		go func() {
			_, err := svc.AssignmentFor(ctx, userID.Hex())
			errs <- err
		}()
	}
	for range attempts {
		if err := <-errs; err != nil && !errors.Is(err, ErrRoleNotFound) {
			t.Fatalf("concurrent resolution failed: %v", err)
		}
	}

	roles, err := svc.Roles(ctx)
	if err != nil {
		t.Fatalf("Roles: %v", err)
	}
	// Three system roles, not twenty-four. The unique index on
	// (churchId, slug) is what holds this.
	if len(roles) != 3 {
		names := make([]string, len(roles))
		for i, r := range roles {
			names[i] = r.Slug
		}
		t.Fatalf("got %d roles after concurrent provisioning, want 3: %v", len(roles), names)
	}
}
