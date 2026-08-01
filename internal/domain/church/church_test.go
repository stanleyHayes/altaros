package church

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

type fixture struct {
	svc      *Service
	orgID    string
	branchA  string
	branchB  string
	branchC  string
	otherOrg string
	otherID  string
}

func newFixture(t *testing.T) (*fixture, context.Context) {
	t.Helper()
	ctx := context.Background()

	uri := os.Getenv("MONGODB_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}
	connectCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	db, err := mongodb.Connect(connectCtx, config.MongoConfig{
		URI:            uri,
		Database:       "altar_test_church",
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

	svc := NewService(db)
	if err := svc.EnsureIndexes(ctx); err != nil {
		t.Fatalf("EnsureIndexes: %v", err)
	}

	now := time.Now().UTC()

	// A denomination with three branches — the shape the flat model could not
	// express.
	orgRes, err := db.Global(CollectionOrganizations).InsertOne(ctx, Organization{
		Name: "Grace Chapel International", Slug: "grace-chapel-intl",
		Country: "Ghana", DataRegion: "gh", CreatedAt: now, UpdatedAt: now,
	})
	if err != nil {
		t.Fatalf("seed org: %v", err)
	}
	orgID := orgRes.InsertedID.(bson.ObjectID)

	otherRes, err := db.Global(CollectionOrganizations).InsertOne(ctx, Organization{
		Name: "Living Word Network", Slug: "living-word",
		Country: "Ghana", DataRegion: "gh", CreatedAt: now, UpdatedAt: now,
	})
	if err != nil {
		t.Fatalf("seed other org: %v", err)
	}
	otherOrgID := otherRes.InsertedID.(bson.ObjectID)

	mk := func(name, slug string, org bson.ObjectID) string {
		res, err := db.Global(CollectionChurches).InsertOne(ctx, bson.M{
			"organizationId": org,
			"name":           name,
			"slug":           slug,
			"country":        "Ghana",
			"currency":       "GHS",
			"timezone":       "Africa/Accra",
			"isActive":       true,
			"createdAt":      now,
			"updatedAt":      now,
		})
		if err != nil {
			t.Fatalf("seed branch %s: %v", name, err)
		}
		return res.InsertedID.(bson.ObjectID).Hex()
	}

	f := &fixture{
		svc:      svc,
		orgID:    orgID.Hex(),
		otherOrg: otherOrgID.Hex(),
	}
	f.branchA = mk("Accra Central", "accra-central", orgID)
	f.branchB = mk("Kumasi Branch", "kumasi", orgID)
	f.branchC = mk("Takoradi Branch", "takoradi", orgID)
	f.otherID = mk("Living Word Accra", "lw-accra", otherOrgID)

	return f, ctx
}

func scopeFor(role, churchID, orgID string) tenancy.Scope {
	return tenancy.Scope{
		ChurchID:       churchID,
		OrganizationID: orgID,
		UserID:         "u1",
		Role:           role,
		CrossBranch:    role == RoleOrgAdmin || role == RoleSuperAdmin,
	}
}

// WP-11 acceptance: an Org Admin sees every branch; a Church Admin sees one.
func TestOrgAdminSeesAllBranchesChurchAdminSeesOne(t *testing.T) {
	f, ctx := newFixture(t)

	orgCtx := tenancy.WithScope(ctx, scopeFor(RoleOrgAdmin, f.branchA, f.orgID))
	visible, err := f.svc.VisibleChurchIDs(orgCtx)
	if err != nil {
		t.Fatalf("VisibleChurchIDs (org admin): %v", err)
	}
	if len(visible) != 3 {
		t.Fatalf("org admin should see all 3 branches, saw %d: %v", len(visible), visible)
	}

	churchCtx := tenancy.WithScope(ctx, scopeFor(RoleChurchAdmin, f.branchA, f.orgID))
	visible, err = f.svc.VisibleChurchIDs(churchCtx)
	if err != nil {
		t.Fatalf("VisibleChurchIDs (church admin): %v", err)
	}
	if len(visible) != 1 || visible[0] != f.branchA {
		t.Fatalf("church admin should see only their own branch, saw %v", visible)
	}
}

// An org admin's reach must stop at their own organization.
func TestOrgAdminCannotSeeAnotherOrganization(t *testing.T) {
	f, ctx := newFixture(t)

	orgCtx := tenancy.WithScope(ctx, scopeFor(RoleOrgAdmin, f.branchA, f.orgID))
	visible, err := f.svc.VisibleChurchIDs(orgCtx)
	if err != nil {
		t.Fatalf("VisibleChurchIDs: %v", err)
	}
	for _, id := range visible {
		if id == f.otherID {
			t.Fatal("an org admin must not see a branch of another denomination")
		}
	}

	if err := f.svc.CanAccessChurch(orgCtx, f.otherID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("want ErrForbidden for another org's branch, got %v", err)
	}
}

// Ordinary roles are confined to their branch.
func TestMemberAndDepartmentLeaderAreBranchScoped(t *testing.T) {
	f, ctx := newFixture(t)

	for _, role := range []string{RoleMember, RoleDepartmentLeader} {
		c := tenancy.WithScope(ctx, scopeFor(role, f.branchA, f.orgID))
		visible, err := f.svc.VisibleChurchIDs(c)
		if err != nil {
			t.Fatalf("%s: %v", role, err)
		}
		if len(visible) != 1 || visible[0] != f.branchA {
			t.Errorf("%s should be confined to their branch, saw %v", role, visible)
		}
		if err := f.svc.CanAccessChurch(c, f.branchB); !errors.Is(err, ErrForbidden) {
			t.Errorf("%s must not reach a sibling branch, got %v", role, err)
		}
	}
}

func TestSuperAdminSeesEveryChurch(t *testing.T) {
	f, ctx := newFixture(t)

	c := tenancy.WithScope(ctx, scopeFor(RoleSuperAdmin, f.branchA, f.orgID))
	visible, err := f.svc.VisibleChurchIDs(c)
	if err != nil {
		t.Fatalf("VisibleChurchIDs: %v", err)
	}
	if len(visible) != 4 {
		t.Fatalf("platform admin should see all 4 churches, saw %d", len(visible))
	}
}

// An org admin with no organization is a bug; it must degrade to their own
// branch rather than to everything.
func TestOrgAdminWithoutOrganizationFallsBackToOwnBranch(t *testing.T) {
	f, ctx := newFixture(t)

	c := tenancy.WithScope(ctx, scopeFor(RoleOrgAdmin, f.branchA, ""))
	visible, err := f.svc.VisibleChurchIDs(c)
	if err != nil {
		t.Fatalf("VisibleChurchIDs: %v", err)
	}
	if len(visible) != 1 || visible[0] != f.branchA {
		t.Fatalf("must fail closed to the caller's own branch, saw %v", visible)
	}
}

func TestVisibilityRequiresTenantScope(t *testing.T) {
	f, ctx := newFixture(t)

	if _, err := f.svc.VisibleChurchIDs(ctx); !errors.Is(err, tenancy.ErrNoTenant) {
		t.Fatalf("want ErrNoTenant with no scope, got %v", err)
	}
}

// A branch that becomes its own ancestor would make the hierarchy walk loop
// forever.
func TestCircularParentIsRejected(t *testing.T) {
	f, ctx := newFixture(t)

	if err := f.svc.SetParent(ctx, f.branchB, f.branchA); err != nil {
		t.Fatalf("A -> B should be allowed: %v", err)
	}
	if err := f.svc.SetParent(ctx, f.branchC, f.branchB); err != nil {
		t.Fatalf("B -> C should be allowed: %v", err)
	}

	// Closing the loop: A under C, when C is already under B under A.
	if err := f.svc.SetParent(ctx, f.branchA, f.branchC); !errors.Is(err, ErrCircularParent) {
		t.Fatalf("a cycle must be refused, got %v", err)
	}
	if err := f.svc.SetParent(ctx, f.branchA, f.branchA); !errors.Is(err, ErrCircularParent) {
		t.Fatalf("a branch cannot parent itself, got %v", err)
	}
}

func TestBranchesOfListsOnlyThatOrganization(t *testing.T) {
	f, ctx := newFixture(t)

	branches, err := f.svc.BranchesOf(ctx, f.orgID)
	if err != nil {
		t.Fatalf("BranchesOf: %v", err)
	}
	if len(branches) != 3 {
		t.Fatalf("want 3 branches, got %d", len(branches))
	}
	// Sorted by name for stable UI listing.
	if branches[0].Name != "Accra Central" {
		t.Errorf("branches should be sorted by name, first is %s", branches[0].Name)
	}
}
