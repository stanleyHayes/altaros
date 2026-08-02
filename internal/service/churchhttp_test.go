package service

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
	"github.com/hayfordstanley/altar-os/internal/platform/token"
)

// churchFixture seeds two branches under one organization, plus an unrelated
// third, so cross-branch reach can be tested in both directions.
func churchFixture(t *testing.T) (*mongodb.DB, map[string]bson.ObjectID, bson.ObjectID) {
	t.Helper()

	uri := os.Getenv("MONGODB_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	db, err := mongodb.Connect(ctx, config.MongoConfig{
		URI:            uri,
		Database:       "altar_test_churchhttp",
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

	orgID := bson.NewObjectID()
	ids := map[string]bson.ObjectID{}
	now := time.Now().UTC()

	for _, c := range []struct {
		key, name, slug string
		org             any
	}{
		{"home", "Grace Chapel", "grace-http", orgID},
		{"sibling", "Living Word", "living-http", orgID},
		{"stranger", "Unrelated Assembly", "stranger-http", bson.NewObjectID()},
	} {
		id := bson.NewObjectID()
		ids[c.key] = id
		if _, err := db.Global("churches").InsertOne(ctx, bson.M{
			"_id": id, "organizationId": c.org, "name": c.name, "slug": c.slug,
			"country": "GH", "currency": "GHS", "isActive": true,
			"createdAt": now, "updatedAt": now,
		}); err != nil {
			t.Fatalf("seed church %s: %v", c.key, err)
		}
	}
	return db, ids, orgID
}

// countChurchIDs reads the churchIds array out of the envelope.
func countChurchIDs(t *testing.T, body []byte) int {
	t.Helper()
	var env struct {
		Data struct {
			ChurchIDs []string `json:"churchIds"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("decode %q: %v", body, err)
	}
	return len(env.Data.ChurchIDs)
}

// A church admin reads one branch. This is the guarantee WP-11 built and that
// had no HTTP caller until now.
func TestChurchAdminSeesOnlyTheirBranch(t *testing.T) {
	db, ids, orgID := churchFixture(t)
	d := newTestDeps(t)
	d.Mongo = db

	r := standalone(churchRoutes(d))
	access := tokenFor(t, d, token.Identity{
		UserID:         "u1",
		ChurchID:       ids["home"].Hex(),
		OrganizationID: orgID.Hex(),
		Role:           RoleChurchAdmin,
	})

	rec := call(r, http.MethodGet, "/churches/visible", access)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	if n := countChurchIDs(t, rec.Body.Bytes()); n != 1 {
		t.Fatalf("a church admin sees %d churches, want exactly their own", n)
	}
}

// An org admin reads every branch in their denomination — and no further.
func TestOrgAdminSeesEveryBranchInTheirOrganization(t *testing.T) {
	db, ids, orgID := churchFixture(t)
	d := newTestDeps(t)
	d.Mongo = db

	r := standalone(churchRoutes(d))
	access := tokenFor(t, d, token.Identity{
		UserID:         "u2",
		ChurchID:       ids["home"].Hex(),
		OrganizationID: orgID.Hex(),
		Role:           RoleOrgAdmin,
	})

	rec := call(r, http.MethodGet, "/churches/visible", access)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	// Two branches in this organization; the third belongs to another and must
	// not appear — reach stops at the organization boundary.
	if n := countChurchIDs(t, rec.Body.Bytes()); n != 2 {
		t.Fatalf("an org admin sees %d churches, want the 2 in their organization", n)
	}
}

// The enumeration guard: a church the caller may not reach must be
// indistinguishable from one that does not exist. A 403 confirms it exists,
// which lets anyone with an account enumerate every church on the platform by
// walking ObjectIds.
func TestUnreachableChurchIsNotFoundNotForbidden(t *testing.T) {
	db, ids, orgID := churchFixture(t)
	d := newTestDeps(t)
	d.Mongo = db

	r := standalone(churchRoutes(d))
	access := tokenFor(t, d, token.Identity{
		UserID:         "u3",
		ChurchID:       ids["home"].Hex(),
		OrganizationID: orgID.Hex(),
		Role:           RoleChurchAdmin,
	})

	// A sibling branch they may not read, and a church that does not exist at
	// all, must answer identically.
	sibling := call(r, http.MethodGet, "/churches/"+ids["sibling"].Hex(), access)
	missing := call(r, http.MethodGet, "/churches/"+bson.NewObjectID().Hex(), access)

	if sibling.Code != http.StatusNotFound {
		t.Errorf("a sibling branch returned %d; 403 would confirm it exists", sibling.Code)
	}
	if missing.Code != http.StatusNotFound {
		t.Errorf("a non-existent church returned %d, want 404", missing.Code)
	}
	if sibling.Body.String() != missing.Body.String() {
		t.Errorf("the two answers differ, which is enumerable:\n  %s\n  %s",
			sibling.Body.String(), missing.Body.String())
	}
}

func TestOwnChurchIsReadable(t *testing.T) {
	db, ids, orgID := churchFixture(t)
	d := newTestDeps(t)
	d.Mongo = db

	r := standalone(churchRoutes(d))
	access := tokenFor(t, d, token.Identity{
		UserID:         "u4",
		ChurchID:       ids["home"].Hex(),
		OrganizationID: orgID.Hex(),
		Role:           RoleMember,
	})

	if rec := call(r, http.MethodGet, "/churches/"+ids["home"].Hex(), access); rec.Code != http.StatusOK {
		t.Fatalf("own church returned %d, want 200", rec.Code)
	}
	if rec := call(r, http.MethodGet, "/churches/current", access); rec.Code != http.StatusOK {
		t.Fatalf("current church returned %d, want 200", rec.Code)
	}
}

func TestPublicChurchSlugResolvesOnlyMinimalActiveJoinData(t *testing.T) {
	db, ids, _ := churchFixture(t)
	d := newTestDeps(t)
	d.Mongo = db
	r := standalone(churchRoutes(d))

	rec := call(r, http.MethodGet, "/churches/slug/grace-http", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("public active slug returned %d, body = %s", rec.Code, rec.Body)
	}
	var env struct {
		Data struct {
			ID, Name, Slug string
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode public church: %v", err)
	}
	if env.Data.ID != ids["home"].Hex() || env.Data.Name != "Grace Chapel" || env.Data.Slug != "grace-http" {
		t.Fatalf("unexpected public church payload: %+v", env.Data)
	}
	for _, privateField := range []string{"address", "email", "phone", "payoutSubaccountCode", "organizationId"} {
		if strings.Contains(rec.Body.String(), privateField) {
			t.Errorf("public response leaked %q: %s", privateField, rec.Body)
		}
	}

	ctx := context.Background()
	if _, err := db.Global("churches").InsertOne(ctx, bson.M{
		"_id": bson.NewObjectID(), "name": "Closed Church", "slug": "closed-http",
		"isActive": false, "createdAt": time.Now().UTC(), "updatedAt": time.Now().UTC(),
	}); err != nil {
		t.Fatalf("seed inactive church: %v", err)
	}
	inactive := call(r, http.MethodGet, "/churches/slug/closed-http", "")
	missing := call(r, http.MethodGet, "/churches/slug/missing-http", "")
	if inactive.Code != http.StatusNotFound || missing.Code != http.StatusNotFound {
		t.Fatalf("inactive/missing statuses = %d/%d, want 404/404", inactive.Code, missing.Code)
	}
	if inactive.Body.String() != missing.Body.String() {
		t.Errorf("inactive church is distinguishable from missing church")
	}
}

// Listing an organization's branches is an org-admin action; a church admin
// asking for it is refused.
func TestBranchListingRequiresOrgAdmin(t *testing.T) {
	db, ids, orgID := churchFixture(t)
	d := newTestDeps(t)
	d.Mongo = db

	r := standalone(churchRoutes(d))
	path := "/organizations/" + orgID.Hex() + "/branches"

	churchAdmin := tokenFor(t, d, token.Identity{
		UserID: "u5", ChurchID: ids["home"].Hex(),
		OrganizationID: orgID.Hex(), Role: RoleChurchAdmin,
	})
	if rec := call(r, http.MethodGet, path, churchAdmin); rec.Code != http.StatusForbidden {
		t.Errorf("a church admin got %d listing branches, want 403", rec.Code)
	}

	orgAdmin := tokenFor(t, d, token.Identity{
		UserID: "u6", ChurchID: ids["home"].Hex(),
		OrganizationID: orgID.Hex(), Role: RoleOrgAdmin,
	})
	if rec := call(r, http.MethodGet, path, orgAdmin); rec.Code != http.StatusOK {
		t.Errorf("an org admin got %d listing branches, want 200", rec.Code)
	}
}

func TestChurchRoutesRequireAuthentication(t *testing.T) {
	db, _, _ := churchFixture(t)
	d := newTestDeps(t)
	d.Mongo = db

	r := standalone(churchRoutes(d))
	for _, path := range []string{"/churches/visible", "/churches/current"} {
		if rec := call(r, http.MethodGet, path, ""); rec.Code != http.StatusUnauthorized {
			t.Errorf("%s without a token returned %d, want 401", path, rec.Code)
		}
	}
}
