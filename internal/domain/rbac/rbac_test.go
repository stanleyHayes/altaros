package rbac

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

const testChurch = "church_rbac_test"

type harness struct {
	svc *Service
	db  *mongodb.DB
	ctx context.Context
}

func newHarness(t *testing.T) *harness {
	t.Helper()

	uri := os.Getenv("MONGODB_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}
	connectCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	db, err := mongodb.Connect(connectCtx, config.MongoConfig{
		URI:            uri,
		Database:       "altar_test_rbac",
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
	ctx := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: testChurch, UserID: "admin_1", Role: "CHURCH_ADMIN",
	})
	if err := svc.EnsureIndexes(ctx); err != nil {
		t.Fatalf("EnsureIndexes: %v", err)
	}
	if err := svc.EnsureSystemRoles(ctx); err != nil {
		t.Fatalf("EnsureSystemRoles: %v", err)
	}
	return &harness{svc: svc, db: db, ctx: ctx}
}

// user creates a user holding a role, and returns its id.
func (h *harness) user(t *testing.T, roleSlug string) string {
	t.Helper()
	role, err := h.svc.RoleBySlug(h.ctx, roleSlug)
	if err != nil {
		t.Fatalf("RoleBySlug(%s): %v", roleSlug, err)
	}
	res, err := h.db.Tenant(UserCollection).InsertOne(h.ctx, bson.M{
		"email":    "person" + roleSlug + "@example.com",
		"name":     "Test Person",
		"roleId":   role.ID.Hex(),
		"roleSlug": role.Slug,
		"isActive": true,
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	return res.InsertedID.(bson.ObjectID).Hex()
}

// THE headline test. Requirements 5 and 8 look contradictory and both must
// hold: an individual's permissions can be altered without affecting the role,
// AND role permissions can be updated.
func TestIndividualGrantSurvivesARoleEdit(t *testing.T) {
	h := newHarness(t)

	// A custom role with one permission.
	role, err := h.svc.CreateRole(h.ctx, RoleInput{
		Name:        "Ushers",
		Permissions: NewSet(NewPermission(ResourceEvent, ActionRead)),
	}, nil)
	if err != nil {
		t.Fatalf("CreateRole: %v", err)
	}

	userID := h.user(t, SystemMember)
	if err := h.svc.AssignRole(h.ctx, userID, role.ID.Hex()); err != nil {
		t.Fatalf("AssignRole: %v", err)
	}

	// Requirement 5: this one person also gets to read members.
	err = h.svc.SetOverrides(h.ctx, userID,
		NewSet(NewPermission(ResourceMember, ActionRead)), NewSet(), nil)
	if err != nil {
		t.Fatalf("SetOverrides: %v", err)
	}

	before, err := h.svc.AssignmentFor(h.ctx, userID)
	if err != nil {
		t.Fatalf("AssignmentFor: %v", err)
	}
	if !before.Effective.Can(ResourceEvent, ActionRead) {
		t.Fatal("the role's permission should apply")
	}
	if !before.Effective.Can(ResourceMember, ActionRead) {
		t.Fatal("the individual grant should apply")
	}

	// Requirement 8: the ROLE gains a permission. Every holder must pick it up,
	// which a snapshot model could not do.
	_, err = h.svc.UpdateRole(h.ctx, role.ID.Hex(), RoleInput{
		Name: "Ushers",
		Permissions: NewSet(
			NewPermission(ResourceEvent, ActionRead),
			NewPermission(ResourceEvent, ActionUpdate),
		),
	}, nil)
	if err != nil {
		t.Fatalf("UpdateRole: %v", err)
	}

	after, err := h.svc.AssignmentFor(h.ctx, userID)
	if err != nil {
		t.Fatalf("AssignmentFor: %v", err)
	}
	if !after.Effective.Can(ResourceEvent, ActionUpdate) {
		t.Error("requirement 8: the role's new permission must reach its holders")
	}
	if !after.Effective.Can(ResourceMember, ActionRead) {
		t.Error("requirement 5: the individual grant must survive the role edit")
	}
	// A changed authorisation state must produce a new version, or a stale
	// token is never noticed.
	if after.Version == before.Version {
		t.Error("the version should change when the role changes")
	}
}

// The consequence of ADR-008 that someone has to agree to explicitly: an
// individually granted permission SURVIVES its removal from the role. This
// test exists so that behaviour is deliberate rather than discovered.
func TestIndividualGrantSurvivesRemovalFromTheRole(t *testing.T) {
	h := newHarness(t)

	role, err := h.svc.CreateRole(h.ctx, RoleInput{
		Name: "Finance Team",
		Permissions: NewSet(
			NewPermission(ResourceFinance, ActionRead),
			NewPermission(ResourceEvent, ActionRead),
		),
	}, nil)
	if err != nil {
		t.Fatalf("CreateRole: %v", err)
	}

	userID := h.user(t, SystemMember)
	if err := h.svc.AssignRole(h.ctx, userID, role.ID.Hex()); err != nil {
		t.Fatalf("AssignRole: %v", err)
	}
	// The same permission, granted individually as well.
	if err := h.svc.SetOverrides(h.ctx, userID,
		NewSet(NewPermission(ResourceFinance, ActionRead)), NewSet(), nil); err != nil {
		t.Fatalf("SetOverrides: %v", err)
	}

	// The role loses finance entirely.
	if _, err := h.svc.UpdateRole(h.ctx, role.ID.Hex(), RoleInput{
		Name:        "Finance Team",
		Permissions: NewSet(NewPermission(ResourceEvent, ActionRead)),
	}, nil); err != nil {
		t.Fatalf("UpdateRole: %v", err)
	}

	a, err := h.svc.AssignmentFor(h.ctx, userID)
	if err != nil {
		t.Fatalf("AssignmentFor: %v", err)
	}
	if !a.Effective.Can(ResourceFinance, ActionRead) {
		t.Fatal("an individually granted permission must survive removal from the " +
			"role — that is what requirement 5 means, and the role editor has to " +
			"warn about it (Q-11)")
	}

	// And the admin must be able to find out. This is what makes the warning
	// possible rather than theoretical.
	holders, err := h.svc.HoldersWithOverrides(h.ctx, role.ID.Hex())
	if err != nil {
		t.Fatalf("HoldersWithOverrides: %v", err)
	}
	if len(holders) != 1 || holders[0] != userID {
		t.Fatalf("the affected holder should be reported, got %v", holders)
	}

	// And clearing the override must actually remove it (Q-11's second half).
	if err := h.svc.ClearOverrides(h.ctx, userID); err != nil {
		t.Fatalf("ClearOverrides: %v", err)
	}
	cleared, _ := h.svc.AssignmentFor(h.ctx, userID)
	if cleared.Effective.Can(ResourceFinance, ActionRead) {
		t.Error("clearing the overrides should return the user to their role exactly")
	}
}

// A revoke removes a permission the role grants, without touching the role.
func TestRevokeAppliesToOneUserOnly(t *testing.T) {
	h := newHarness(t)

	role, err := h.svc.CreateRole(h.ctx, RoleInput{
		Name:        "Leaders",
		Permissions: NewSet(NewPermission(ResourceMember, ActionRead)),
	}, nil)
	if err != nil {
		t.Fatalf("CreateRole: %v", err)
	}

	restricted := h.user(t, SystemMember)
	if err := h.svc.AssignRole(h.ctx, restricted, role.ID.Hex()); err != nil {
		t.Fatalf("AssignRole: %v", err)
	}
	if err := h.svc.SetOverrides(h.ctx, restricted, NewSet(),
		NewSet(NewPermission(ResourceMember, ActionRead)), nil); err != nil {
		t.Fatalf("SetOverrides: %v", err)
	}

	a, _ := h.svc.AssignmentFor(h.ctx, restricted)
	if a.Effective.Can(ResourceMember, ActionRead) {
		t.Error("the revoke should remove the role's permission for this user")
	}

	// The role itself is untouched.
	unchanged, _ := h.svc.RoleByID(h.ctx, role.ID.Hex())
	if !unchanged.PermissionSet().Can(ResourceMember, ActionRead) {
		t.Error("a per-user revoke must not modify the role")
	}
}

// Requirement 6, enforced on write: a set that grants a write without its read
// is refused, and the error says what to add.
func TestWritePermissionRequiresReadOnSave(t *testing.T) {
	h := newHarness(t)

	_, err := h.svc.CreateRole(h.ctx, RoleInput{
		Name:        "Broken",
		Permissions: NewSet(NewPermission(ResourceFinance, ActionUpdate)),
	}, nil)
	// Expand runs before validation, so this actually succeeds WITH the read
	// added — which is the friendlier half of the rule. What must never happen
	// is the write existing without the read.
	if err != nil {
		t.Fatalf("CreateRole: %v", err)
	}

	role, err := h.svc.RoleBySlug(h.ctx, "broken")
	if err != nil {
		t.Fatalf("RoleBySlug: %v", err)
	}
	if !role.PermissionSet().Can(ResourceFinance, ActionRead) {
		t.Fatal("granting finance:update must imply finance:read, or the user gets " +
			"an edit form full of blanks and saves them over real values")
	}
}

// Validate is the other half: it reports violations rather than silently
// fixing them, so a UI can tell an admin what is wrong.
func TestValidateReportsMissingReads(t *testing.T) {
	s := NewSet(
		NewPermission(ResourceFinance, ActionUpdate),
		NewPermission(ResourceMember, ActionDelete),
		NewPermission(ResourceEvent, ActionRead),
	)
	missing := Validate(s)
	if len(missing) != 2 {
		t.Fatalf("want 2 missing reads, got %v", missing)
	}

	if err := ValidateStrict(s); err == nil {
		t.Fatal("want an error naming what is missing")
	} else if !errors.Is(err, ErrMissingRead) {
		t.Fatalf("want ErrMissingRead, got %v", err)
	}

	// A complete set passes.
	if err := ValidateStrict(Expand(s)); err != nil {
		t.Errorf("an expanded set should be valid: %v", err)
	}
}

func TestExpandAddsImpliedReads(t *testing.T) {
	got := Expand(NewSet(
		NewPermission(ResourceFinance, ActionCreate),
		NewPermission(ResourceMember, ActionDelete),
	))
	for _, want := range []Permission{
		NewPermission(ResourceFinance, ActionRead),
		NewPermission(ResourceMember, ActionRead),
	} {
		if !got.Has(want) {
			t.Errorf("expansion should have added %s", want)
		}
	}
	// Read alone implies nothing further.
	if len(Expand(NewSet(NewPermission(ResourceEvent, ActionRead)))) != 1 {
		t.Error("read should not expand to anything")
	}
}

// Without this, anyone with role:create writes themselves an all-permissions
// role and becomes an administrator — which makes role:create equivalent to
// full access and the whole model decorative.
func TestCallerCannotGrantWhatTheyDoNotHold(t *testing.T) {
	h := newHarness(t)

	// A caller who may create roles and read members, and nothing else.
	callerHolds := NewSet(
		NewPermission(ResourceRole, ActionCreate),
		NewPermission(ResourceRole, ActionRead),
		NewPermission(ResourceMember, ActionRead),
	)

	_, err := h.svc.CreateRole(h.ctx, RoleInput{
		Name:        "Sneaky",
		Permissions: NewSet(NewPermission(ResourceFinance, ActionDelete)),
	}, callerHolds)
	if !errors.Is(err, ErrEscalation) {
		t.Fatalf("want ErrEscalation, got %v", err)
	}

	// What they DO hold is fine.
	if _, err := h.svc.CreateRole(h.ctx, RoleInput{
		Name:        "Fine",
		Permissions: NewSet(NewPermission(ResourceMember, ActionRead)),
	}, callerHolds); err != nil {
		t.Fatalf("granting a held permission should succeed: %v", err)
	}
}

// The same rule applies to individual grants, or escalation just moves.
func TestOverridesCannotEscalateEither(t *testing.T) {
	h := newHarness(t)
	userID := h.user(t, SystemMember)

	callerHolds := NewSet(NewPermission(ResourceMember, ActionRead))
	err := h.svc.SetOverrides(h.ctx, userID,
		NewSet(NewPermission(ResourceFinance, ActionDelete)), NewSet(), callerHolds)
	if !errors.Is(err, ErrEscalation) {
		t.Fatalf("want ErrEscalation, got %v", err)
	}
}

// A church that deletes its only admin role has locked itself out, and the
// recovery is a support ticket against a production database.
func TestSystemRolesCannotBeDeletedOrEdited(t *testing.T) {
	h := newHarness(t)

	admin, err := h.svc.RoleBySlug(h.ctx, SystemAdmin)
	if err != nil {
		t.Fatalf("RoleBySlug: %v", err)
	}

	if err := h.svc.DeleteRole(h.ctx, admin.ID.Hex()); !errors.Is(err, ErrSystemRole) {
		t.Errorf("deleting a system role must be refused, got %v", err)
	}
	if _, err := h.svc.UpdateRole(h.ctx, admin.ID.Hex(),
		RoleInput{Name: "Hacked", Permissions: NewSet()}, nil); !errors.Is(err, ErrSystemRole) {
		t.Errorf("editing a system role must be refused, got %v", err)
	}
}

// Deleting a role that people still hold would leave them with an
// unresolvable role.
func TestRoleInUseCannotBeDeleted(t *testing.T) {
	h := newHarness(t)

	role, err := h.svc.CreateRole(h.ctx, RoleInput{
		Name:        "Temporary",
		Permissions: NewSet(NewPermission(ResourceEvent, ActionRead)),
	}, nil)
	if err != nil {
		t.Fatalf("CreateRole: %v", err)
	}

	userID := h.user(t, SystemMember)
	if err := h.svc.AssignRole(h.ctx, userID, role.ID.Hex()); err != nil {
		t.Fatalf("AssignRole: %v", err)
	}

	if err := h.svc.DeleteRole(h.ctx, role.ID.Hex()); !errors.Is(err, ErrRoleInUse) {
		t.Fatalf("want ErrRoleInUse, got %v", err)
	}

	// Once nobody holds it, it goes.
	member, _ := h.svc.RoleBySlug(h.ctx, SystemMember)
	if err := h.svc.AssignRole(h.ctx, userID, member.ID.Hex()); err != nil {
		t.Fatalf("reassign: %v", err)
	}
	if err := h.svc.DeleteRole(h.ctx, role.ID.Hex()); err != nil {
		t.Fatalf("an unheld role should delete: %v", err)
	}
}

// A user created by the legacy TypeScript API has no roleId, only the fixed
// enum. RBAC has to land without a migration and without breaking them.
func TestLegacyRoleEnumStillResolves(t *testing.T) {
	h := newHarness(t)

	res, err := h.db.Tenant(UserCollection).InsertOne(h.ctx, bson.M{
		"email": "legacy@example.com",
		"name":  "Legacy User",
		// No roleId — exactly what the TypeScript API writes.
		"role":     "CHURCH_ADMIN",
		"isActive": true,
	})
	if err != nil {
		t.Fatalf("create legacy user: %v", err)
	}
	userID := res.InsertedID.(bson.ObjectID).Hex()

	a, err := h.svc.AssignmentFor(h.ctx, userID)
	if err != nil {
		t.Fatalf("AssignmentFor: %v", err)
	}
	if !a.Effective.Can(ResourceMember, ActionRead) {
		t.Error("a legacy CHURCH_ADMIN should map onto the admin role")
	}
	if a.RoleName == "" {
		t.Error("the resolved role should be named")
	}
}

// A legacy MEMBER must not inherit anything an admin has.
func TestLegacyMemberIsNotAnAdmin(t *testing.T) {
	h := newHarness(t)

	res, _ := h.db.Tenant(UserCollection).InsertOne(h.ctx, bson.M{
		"email": "legacymember@example.com", "role": "MEMBER", "isActive": true,
	})
	userID := res.InsertedID.(bson.ObjectID).Hex()

	a, err := h.svc.AssignmentFor(h.ctx, userID)
	if err != nil {
		t.Fatalf("AssignmentFor: %v", err)
	}
	if a.Effective.Can(ResourceFinance, ActionRead) {
		t.Error("a member must not read the church's finances")
	}
	if a.Effective.Can(ResourceRole, ActionCreate) {
		t.Error("a member must not create roles")
	}
}

// A deleted role must cost its holders their extra permissions, not their
// access — and must never fail open.
func TestDeletedRoleFallsBackSafely(t *testing.T) {
	h := newHarness(t)

	res, _ := h.db.Tenant(UserCollection).InsertOne(h.ctx, bson.M{
		"email":  "orphan@example.com",
		"roleId": bson.NewObjectID().Hex(), // points at nothing
		"role":   "MEMBER",
	})
	userID := res.InsertedID.(bson.ObjectID).Hex()

	a, err := h.svc.AssignmentFor(h.ctx, userID)
	if err != nil {
		t.Fatalf("a dangling role reference must not error: %v", err)
	}
	if a.Effective.Can(ResourceFinance, ActionDelete) {
		t.Fatal("a dangling role must never fail open")
	}
}

// Roles are tenant-scoped like everything else.
func TestRolesDoNotCrossChurches(t *testing.T) {
	h := newHarness(t)
	other := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: "other_church", UserID: "u", Role: "CHURCH_ADMIN",
	})

	role, err := h.svc.CreateRole(h.ctx, RoleInput{
		Name:        "Private",
		Permissions: NewSet(NewPermission(ResourceEvent, ActionRead)),
	}, nil)
	if err != nil {
		t.Fatalf("CreateRole: %v", err)
	}

	if _, err := h.svc.RoleByID(other, role.ID.Hex()); !errors.Is(err, ErrRoleNotFound) {
		t.Fatalf("another church must not see this role, got %v", err)
	}

	roles, err := h.svc.Roles(other)
	if err != nil {
		t.Fatalf("Roles: %v", err)
	}
	for _, r := range roles {
		if r.Name == "Private" {
			t.Fatal("another church's role leaked into the list")
		}
	}
}

// Two churches may both have a role called "Ushers"; one church may not have
// two.
func TestRoleNamesAreUniquePerChurchOnly(t *testing.T) {
	h := newHarness(t)
	other := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: "second_church", UserID: "u", Role: "CHURCH_ADMIN",
	})
	if err := h.svc.EnsureSystemRoles(other); err != nil {
		t.Fatalf("EnsureSystemRoles: %v", err)
	}

	in := RoleInput{Name: "Ushers", Permissions: NewSet(NewPermission(ResourceEvent, ActionRead))}
	if _, err := h.svc.CreateRole(h.ctx, in, nil); err != nil {
		t.Fatalf("first church: %v", err)
	}
	if _, err := h.svc.CreateRole(h.ctx, in, nil); !errors.Is(err, ErrRoleNameTaken) {
		t.Errorf("the same church must not have two, got %v", err)
	}
	if _, err := h.svc.CreateRole(other, in, nil); err != nil {
		t.Errorf("another church may use the same name: %v", err)
	}
}

func TestEveryChurchGetsTheThreeSystemRoles(t *testing.T) {
	h := newHarness(t)

	for _, slug := range []string{SystemAdmin, SystemStaff, SystemMember} {
		role, err := h.svc.RoleBySlug(h.ctx, slug)
		if err != nil {
			t.Fatalf("%s: %v", slug, err)
		}
		if !role.System {
			t.Errorf("%s should be marked as a system role", slug)
		}
	}

	// Running it again must not duplicate or reset them.
	if err := h.svc.EnsureSystemRoles(h.ctx); err != nil {
		t.Fatalf("second run: %v", err)
	}
	roles, _ := h.svc.Roles(h.ctx)
	if len(roles) != len(systemRoles()) {
		t.Fatalf("want exactly %d system roles after two runs, got %d",
			len(systemRoles()), len(roles))
	}
}

// The admin role must be able to run the church — and must NOT hold welfare.
//
// This used to assert that the admin held literally everything, which is the
// contract WP-27 had to break. Its acceptance criterion is "a church admin
// WITHOUT the welfare role cannot read case details", and that was unachievable
// while every admin got welfare by being made an admin.
//
// The point is not that administrators are untrusted. It is that a church's
// welfare records name people in crisis, and access to them should be a
// decision somebody made rather than a side effect of being handed the admin
// role to manage giving reports.
func TestAdminRoleHoldsEverythingExceptPastoralCare(t *testing.T) {
	h := newHarness(t)

	admin, err := h.svc.RoleBySlug(h.ctx, SystemAdmin)
	if err != nil {
		t.Fatalf("RoleBySlug: %v", err)
	}
	held := admin.PermissionSet()

	for _, r := range AllResources {
		for _, a := range AllActions {
			pastoral := isPastoral(r)
			switch {
			case pastoral && held.Can(r, a):
				t.Errorf("the admin role holds %s, which no blanket grant may "+
					"include — WP-27's criterion depends on it", NewPermission(r, a))
			case !pastoral && !held.Can(r, a):
				t.Errorf("the admin role is missing %s", NewPermission(r, a))
			}
		}
	}
}

// And somebody has to be able to hold it, or the feature is unreachable.
func TestThePastoralRoleHoldsWelfareAndLittleElse(t *testing.T) {
	h := newHarness(t)

	pastoral, err := h.svc.RoleBySlug(h.ctx, SystemPastoral)
	if err != nil {
		t.Fatalf("the pastoral role was not provisioned: %v", err)
	}
	held := pastoral.PermissionSet()

	for _, a := range []Action{ActionRead, ActionCreate, ActionUpdate} {
		if !held.Can(ResourceWelfare, a) {
			t.Errorf("the pastoral role cannot %s welfare", a)
		}
	}
	// Deliberately narrow. A pastoral carer needs to know who a case is about;
	// they have no business in the giving ledger.
	for _, r := range []Resource{ResourceFinance, ResourceRole, ResourceSettings} {
		for _, a := range AllActions {
			if held.Can(r, a) {
				t.Errorf("the pastoral role holds %s, which is beyond its purpose",
					NewPermission(r, a))
			}
		}
	}
}

// A version has to change when anything about the authorisation changes, or a
// stale token is never noticed and a removal takes effect only at expiry.
func TestVersionChangesWithOverrides(t *testing.T) {
	h := newHarness(t)
	userID := h.user(t, SystemStaff)

	before, err := h.svc.AssignmentFor(h.ctx, userID)
	if err != nil {
		t.Fatalf("AssignmentFor: %v", err)
	}

	if err := h.svc.SetOverrides(h.ctx, userID,
		NewSet(NewPermission(ResourceFinance, ActionRead)), NewSet(), nil); err != nil {
		t.Fatalf("SetOverrides: %v", err)
	}

	after, _ := h.svc.AssignmentFor(h.ctx, userID)
	if after.Version == before.Version {
		t.Fatal("the version must change when a user's permissions change")
	}
	if before.Version == "" || after.Version == "" {
		t.Fatal("a version must always be present")
	}
}

// Grant beats revoke, because an admin who ticks a box expects the box to win.
func TestGrantBeatsRevoke(t *testing.T) {
	p := NewPermission(ResourceMember, ActionRead)
	got := Effective(NewSet(), NewSet(p), NewSet(p))
	if !got.Has(p) {
		t.Fatal("an explicit grant should win over a revoke of the same permission")
	}
}

func TestMalformedPermissionsAreRefused(t *testing.T) {
	for _, raw := range []string{"", "member", "member:", ":read", "member:fly", "ufo:read"} {
		if Permission(raw).Valid() {
			t.Errorf("%q should not be a valid permission", raw)
		}
	}
	for _, raw := range []string{"member:read", "finance:delete", "role:create"} {
		if !Permission(raw).Valid() {
			t.Errorf("%q should be valid", raw)
		}
	}
}

// Stored data outlives code: a permission removed from the platform must not
// make an existing role undecodable.
func TestUnknownStoredPermissionsAreIgnored(t *testing.T) {
	s := SetFromStrings([]string{"member:read", "obsolete:read", "finance:delete", "junk"})
	if len(s) != 2 {
		t.Fatalf("want the 2 recognised permissions, got %v", s.Strings())
	}
	if !s.Can(ResourceMember, ActionRead) || !s.Can(ResourceFinance, ActionDelete) {
		t.Errorf("the recognised permissions should survive: %v", s.Strings())
	}
}

// An unsorted set makes every save look like a change and every token differ
// from the last.
func TestSetStringsAreSorted(t *testing.T) {
	s := NewSet(
		NewPermission(ResourceMember, ActionRead),
		NewPermission(ResourceFinance, ActionRead),
		NewPermission(ResourceChurch, ActionRead),
	)
	got := s.Strings()
	for i := 1; i < len(got); i++ {
		if got[i-1] > got[i] {
			t.Fatalf("permissions are not sorted: %v", got)
		}
	}
}

func TestSlugify(t *testing.T) {
	cases := []struct{ in, want string }{
		{"Ushers", "ushers"},
		{"Finance Team", "finance-team"},
		{"  Youth   Ministry  ", "youth-ministry"},
		{"Media & Sound", "media-sound"},
		{"Choir (Main)", "choir-main"},
	}
	for _, c := range cases {
		if got := slugify(c.in); got != c.want {
			t.Errorf("slugify(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
