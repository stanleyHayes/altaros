package mongodb

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

// WP-07 acceptance: cross-tenant reads return zero rows across every
// tenant-scoped domain, proven against a real MongoDB rather than a mock.
//
// Skips when MongoDB is unreachable so `go test ./...` still works on a
// machine with no infrastructure; run `make infra-up` to exercise it.
func testDB(t *testing.T) *DB {
	t.Helper()

	uri := os.Getenv("MONGODB_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	db, err := Connect(ctx, config.MongoConfig{
		URI: uri,
		// A dedicated database: these tests drop collections, and must never
		// be able to touch development or production data.
		Database:       "altar_test_isolation",
		ConnectTimeout: 3 * time.Second,
	})
	if err != nil {
		testsupport.SkipOrFail(t, "MongoDB at "+uri, err)
	}

	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = db.Database().Drop(cleanupCtx)
		_ = db.Close(cleanupCtx)
	})
	return db
}

// The domains that carry tenant-scoped data. Every one is checked, because an
// isolation bug in a single collection is enough to leak a church's records.
var tenantDomains = []string{
	"members", "transactions", "events", "attendance",
	"announcements", "prayer_requests", "welfare_cases", "groups",
}

func TestCrossTenantReadsReturnZeroRows(t *testing.T) {
	db := testDB(t)

	const (
		churchA = "church_alpha"
		churchB = "church_beta"
	)
	ctxA := tenancy.WithScope(context.Background(), tenancy.Scope{ChurchID: churchA})
	ctxB := tenancy.WithScope(context.Background(), tenancy.Scope{ChurchID: churchB})

	// Seed both churches in every domain.
	for _, domain := range tenantDomains {
		coll := db.Tenant(domain)
		for i := 0; i < 3; i++ {
			if _, err := coll.InsertOne(ctxA, bson.M{"label": "alpha", "n": i}); err != nil {
				t.Fatalf("%s: seeding church A: %v", domain, err)
			}
			if _, err := coll.InsertOne(ctxB, bson.M{"label": "beta", "n": i}); err != nil {
				t.Fatalf("%s: seeding church B: %v", domain, err)
			}
		}
	}

	for _, domain := range tenantDomains {
		t.Run(domain, func(t *testing.T) {
			coll := db.Tenant(domain)

			// Each church sees only its own documents.
			countA, err := coll.CountDocuments(ctxA, nil)
			if err != nil {
				t.Fatalf("count for church A: %v", err)
			}
			if countA != 3 {
				t.Errorf("church A should see exactly its own 3 documents, saw %d", countA)
			}

			// An unfiltered read must never surface the other church.
			var docs []bson.M
			if err := coll.Find(ctxA, nil, &docs); err != nil {
				t.Fatalf("find for church A: %v", err)
			}
			for _, d := range docs {
				if d["label"] != "alpha" {
					t.Fatalf("church A read a document belonging to another church: %v", d)
				}
				if d[TenantField] != churchA {
					t.Fatalf("document has wrong %s: %v", TenantField, d[TenantField])
				}
			}

			// Explicitly asking for the other church is refused, not served.
			if _, err := coll.CountDocuments(ctxA, bson.M{TenantField: churchB}); !errors.Is(err, ErrCrossTenant) {
				t.Errorf("cross-tenant filter should be refused, got %v", err)
			}

			// And with no tenant at all, nothing is readable.
			if _, err := coll.CountDocuments(context.Background(), nil); !errors.Is(err, tenancy.ErrNoTenant) {
				t.Errorf("unscoped read should be refused, got %v", err)
			}
		})
	}
}

// Deleting within one church must not touch another's data.
func TestDeleteIsTenantScoped(t *testing.T) {
	db := testDB(t)
	coll := db.Tenant("members")

	ctxA := tenancy.WithScope(context.Background(), tenancy.Scope{ChurchID: "del_a"})
	ctxB := tenancy.WithScope(context.Background(), tenancy.Scope{ChurchID: "del_b"})

	if _, err := coll.InsertOne(ctxA, bson.M{"email": "shared@example.org"}); err != nil {
		t.Fatalf("seed A: %v", err)
	}
	if _, err := coll.InsertOne(ctxB, bson.M{"email": "shared@example.org"}); err != nil {
		t.Fatalf("seed B: %v", err)
	}

	// Same email in both churches: deleting from A must leave B intact.
	if _, err := coll.DeleteOne(ctxA, bson.M{"email": "shared@example.org"}); err != nil {
		t.Fatalf("delete in A: %v", err)
	}

	countB, err := coll.CountDocuments(ctxB, bson.M{"email": "shared@example.org"})
	if err != nil {
		t.Fatalf("count B: %v", err)
	}
	if countB != 1 {
		t.Errorf("church B's document must survive a delete in church A, count=%d", countB)
	}
}

// An update must not be able to move a document into another church.
func TestUpdateCannotReassignTenant(t *testing.T) {
	db := testDB(t)
	coll := db.Tenant("members")
	ctx := tenancy.WithScope(context.Background(), tenancy.Scope{ChurchID: "upd_a"})

	if _, err := coll.InsertOne(ctx, bson.M{"name": "Kwame"}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	_, err := coll.UpdateOne(ctx, bson.M{"name": "Kwame"}, bson.M{
		"$set": bson.M{TenantField: "upd_b"},
	})
	if !errors.Is(err, ErrCrossTenant) {
		t.Fatalf("reassigning %s must be refused, got %v", TenantField, err)
	}
}
