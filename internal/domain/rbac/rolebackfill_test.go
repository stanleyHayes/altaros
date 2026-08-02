package rbac

import (
	"context"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

// backfillDB is separate from the other tests' database so a global operation
// cannot see roles they created.
func backfillDB(t *testing.T) *mongodb.DB {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	db, err := mongodb.Connect(ctx, config.MongoConfig{
		URI:            testsupport.MongoURI(),
		Database:       "altar_test_rbac_backfill",
		ConnectTimeout: 3 * time.Second,
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
	return db
}

// A church whose Staff role predates a new resource gets it; a church that
// narrowed the role keeps its narrowing.
func TestBackfillGrantsOnlyResourcesTheRoleHasNeverHeld(t *testing.T) {
	db := backfillDB(t)
	svc := NewService(db)

	const (
		untouched = "6a6d0a46536bf5e6e21cb001"
		narrowed  = "6a6d0a46536bf5e6e21cb002"
	)

	// An old Staff role: everything the role held BEFORE social existed.
	old := []string{
		"member:read", "member:create", "member:update",
		"event:read", "event:create", "event:update",
		"communication:read", "communication:create",
		"church:read", "report:read",
	}
	// A church that deliberately took member writes away from Staff.
	narrow := []string{
		"member:read",
		"event:read", "event:create", "event:update",
		"communication:read", "communication:create",
		"church:read", "report:read",
	}

	roles := db.Global(RoleCollection)
	for churchID, perms := range map[string][]string{untouched: old, narrowed: narrow} {
		if _, err := roles.InsertOne(context.Background(), bson.M{
			"churchId": mongodb.ID(churchID), "slug": SystemStaff, "name": "Staff",
			"permissions": perms, "system": true, "version": int64(1),
			"createdAt": time.Now(), "updatedAt": time.Now(),
		}); err != nil {
			t.Fatalf("seed %s: %v", churchID, err)
		}
	}

	// --- dry run changes nothing ---
	dry, err := svc.BackfillSystemRoles(context.Background(), false)
	if err != nil {
		t.Fatalf("dry run: %v", err)
	}
	if !dry.DryRun || dry.Changed != 2 {
		t.Fatalf("dry run reports DryRun=%v changed=%d, want a dry run over 2 roles",
			dry.DryRun, dry.Changed)
	}
	var check struct {
		Permissions []string `bson:"permissions"`
	}
	if err := roles.FindOne(context.Background(),
		bson.M{"churchId": mongodb.ID(untouched)}).Decode(&check); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if len(check.Permissions) != len(old) {
		t.Fatalf("a dry run wrote %d permissions", len(check.Permissions))
	}

	// --- applying grants the new resource ---
	applied, err := svc.BackfillSystemRoles(context.Background(), true)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if applied.Changed != 2 {
		t.Fatalf("applied to %d roles, want 2", applied.Changed)
	}

	staffCtx := tenancy.WithScope(context.Background(), tenancy.Scope{ChurchID: untouched})
	role, err := svc.RoleBySlug(staffCtx, SystemStaff)
	if err != nil {
		t.Fatalf("RoleBySlug: %v", err)
	}
	set := role.PermissionSet()
	if !set.Can(ResourceSocial, ActionRead) || !set.Can(ResourceSocial, ActionUpdate) {
		t.Error("the Staff role did not gain the newly introduced resource")
	}
	// Everything it already held is untouched.
	if !set.Can(ResourceMember, ActionCreate) {
		t.Error("the backfill removed a permission the role already held")
	}

	// The church that NARROWED Staff keeps its narrowing: member is a resource
	// it holds permissions on, so the backfill has no business there.
	narrowCtx := tenancy.WithScope(context.Background(), tenancy.Scope{ChurchID: narrowed})
	narrowRole, err := svc.RoleBySlug(narrowCtx, SystemStaff)
	if err != nil {
		t.Fatalf("RoleBySlug: %v", err)
	}
	narrowSet := narrowRole.PermissionSet()
	if narrowSet.Can(ResourceMember, ActionCreate) {
		t.Fatal("the backfill restored a permission an administrator had removed")
	}
	if !narrowSet.Can(ResourceSocial, ActionRead) {
		t.Error("the narrowed role did not gain the new resource")
	}
}

// Running twice must not double anything or keep reporting work to do.
func TestBackfillIsIdempotent(t *testing.T) {
	db := backfillDB(t)
	svc := NewService(db)

	roles := db.Global(RoleCollection)
	if _, err := roles.InsertOne(context.Background(), bson.M{
		"churchId": mongodb.ID("6a6d0a46536bf5e6e21cb003"),
		"slug":     SystemStaff, "name": "Staff",
		"permissions": []string{"member:read", "church:read"},
		"system":      true, "version": int64(1),
		"createdAt": time.Now(), "updatedAt": time.Now(),
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	first, err := svc.BackfillSystemRoles(context.Background(), true)
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	if first.Changed != 1 {
		t.Fatalf("first run changed %d", first.Changed)
	}

	second, err := svc.BackfillSystemRoles(context.Background(), true)
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if second.Changed != 0 {
		t.Fatalf("a second run changed %d roles, want none", second.Changed)
	}

	ctx := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: "6a6d0a46536bf5e6e21cb003",
	})
	role, err := svc.RoleBySlug(ctx, SystemStaff)
	if err != nil {
		t.Fatalf("RoleBySlug: %v", err)
	}
	seen := map[string]int{}
	for _, p := range role.Permissions {
		seen[p]++
	}
	for p, n := range seen {
		if n > 1 {
			t.Errorf("permission %q appears %d times", p, n)
		}
	}
}

// A custom role is not a system role and must never be touched.
func TestBackfillIgnoresCustomRoles(t *testing.T) {
	db := backfillDB(t)
	svc := NewService(db)

	roles := db.Global(RoleCollection)
	if _, err := roles.InsertOne(context.Background(), bson.M{
		"churchId": mongodb.ID("6a6d0a46536bf5e6e21cb004"),
		"slug":     "ushers", "name": "Ushers",
		"permissions": []string{"event:read"},
		"createdAt":   time.Now(), "updatedAt": time.Now(),
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	out, err := svc.BackfillSystemRoles(context.Background(), true)
	if err != nil {
		t.Fatalf("backfill: %v", err)
	}
	if out.Examined != 0 || out.Changed != 0 {
		t.Fatalf("examined %d and changed %d custom roles", out.Examined, out.Changed)
	}
}

// The grant has to reach people already signed in, which means the version
// bumps — it is what the assignment hash and the permission cache key off.
func TestBackfillBumpsTheRoleVersion(t *testing.T) {
	db := backfillDB(t)
	svc := NewService(db)

	roles := db.Global(RoleCollection)
	if _, err := roles.InsertOne(context.Background(), bson.M{
		"churchId": mongodb.ID("6a6d0a46536bf5e6e21cb005"),
		"slug":     SystemStaff, "name": "Staff",
		"permissions": []string{"member:read", "church:read"},
		"system":      true, "version": int64(7),
		"createdAt": time.Now(), "updatedAt": time.Now(),
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if _, err := svc.BackfillSystemRoles(context.Background(), true); err != nil {
		t.Fatalf("backfill: %v", err)
	}

	var after struct {
		Version int64 `bson:"version"`
	}
	if err := roles.FindOne(context.Background(),
		bson.M{"churchId": mongodb.ID("6a6d0a46536bf5e6e21cb005")}).Decode(&after); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if after.Version != 8 {
		t.Errorf("version = %d after a grant, want 8", after.Version)
	}
}
