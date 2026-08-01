package mongodb

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

func indexTestDB(t *testing.T) *DB {
	t.Helper()

	uri := os.Getenv("MONGODB_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	db, err := Connect(ctx, config.MongoConfig{
		URI:            uri,
		Database:       "altar_test_indexes",
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

// The case that broke the boot: Mongoose created `slug_1`, Go wants
// `org_slug_unique` on the same key. Same guarantees, different name — that
// must be accepted rather than fail the whole service.
func TestExistingIndexUnderADifferentNameIsAccepted(t *testing.T) {
	db := indexTestDB(t)
	ctx := context.Background()
	coll := db.Global("legacy_named")

	// Mongoose's version.
	if _, err := coll.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "slug", Value: 1}},
		Options: options.Index().SetName("slug_1").SetUnique(true),
	}); err != nil {
		t.Fatalf("seed legacy index: %v", err)
	}

	// Go's version of the same constraint.
	err := EnsureIndexes(ctx, coll, []mongo.IndexModel{{
		Keys:    bson.D{{Key: "slug", Value: 1}},
		Options: options.Index().SetName("org_slug_unique").SetUnique(true),
	}})
	if err != nil {
		t.Fatalf("an equivalent index under another name must be accepted: %v", err)
	}

	// The legacy index must still be the one in place — dropping and
	// rebuilding it would disturb the live TypeScript API.
	found, err := describeIndexes(ctx, coll)
	if err != nil {
		t.Fatalf("describeIndexes: %v", err)
	}
	if found["slug:1"].name != "slug_1" {
		t.Errorf("the legacy index should be untouched, got %q", found["slug:1"].name)
	}
}

// The line the tolerance must not cross: an existing index that does NOT
// enforce uniqueness cannot satisfy a requirement for one. Accepting it would
// remove the constraint that makes payments idempotent, while the service
// booted looking healthy.
func TestWeakerExistingIndexIsRefused(t *testing.T) {
	db := indexTestDB(t)
	ctx := context.Background()
	coll := db.Global("weaker")

	if _, err := coll.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "idempotencyKey", Value: 1}},
		Options: options.Index().SetName("idempotencyKey_1"), // NOT unique
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	err := EnsureIndexes(ctx, coll, []mongo.IndexModel{{
		Keys:    bson.D{{Key: "idempotencyKey", Value: 1}},
		Options: options.Index().SetName("uq_idempotency").SetUnique(true),
	}})
	if !errors.Is(err, ErrIndexConflict) {
		t.Fatalf("want ErrIndexConflict, got %v", err)
	}
}

// A unique index already in place satisfies a non-unique requirement: it is
// strictly stronger.
func TestStrongerExistingIndexIsAccepted(t *testing.T) {
	db := indexTestDB(t)
	ctx := context.Background()
	coll := db.Global("stronger")

	if _, err := coll.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "ref", Value: 1}},
		Options: options.Index().SetName("ref_1").SetUnique(true),
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	if err := EnsureIndexes(ctx, coll, []mongo.IndexModel{{
		Keys:    bson.D{{Key: "ref", Value: 1}},
		Options: options.Index().SetName("ref_lookup"),
	}}); err != nil {
		t.Fatalf("a stronger existing index should satisfy a weaker requirement: %v", err)
	}
}

func TestNewIndexesAreCreated(t *testing.T) {
	db := indexTestDB(t)
	ctx := context.Background()
	coll := db.Global("fresh")

	models := []mongo.IndexModel{
		{
			Keys:    bson.D{{Key: "churchId", Value: 1}, {Key: "occurredAt", Value: -1}},
			Options: options.Index().SetName("church_occurred"),
		},
		{
			Keys:    bson.D{{Key: "idempotencyKey", Value: 1}},
			Options: options.Index().SetName("uq_idempotency").SetUnique(true),
		},
	}
	if err := EnsureIndexes(ctx, coll, models); err != nil {
		t.Fatalf("EnsureIndexes: %v", err)
	}

	found, err := describeIndexes(ctx, coll)
	if err != nil {
		t.Fatalf("describeIndexes: %v", err)
	}
	if _, ok := found["churchId:1,occurredAt:-1"]; !ok {
		t.Error("the compound index was not created")
	}
	if info, ok := found["idempotencyKey:1"]; !ok || !info.unique {
		t.Errorf("the unique index was not created as unique: %+v", info)
	}
}

// Running it twice must be a no-op, since it runs on every boot.
func TestEnsureIndexesIsIdempotent(t *testing.T) {
	db := indexTestDB(t)
	ctx := context.Background()
	coll := db.Global("twice")

	models := []mongo.IndexModel{{
		Keys:    bson.D{{Key: "phoneE164", Value: 1}},
		Options: options.Index().SetName("phone_unique").SetUnique(true),
	}}
	for i := 0; i < 3; i++ {
		if err := EnsureIndexes(ctx, coll, models); err != nil {
			t.Fatalf("pass %d: %v", i+1, err)
		}
	}

	found, _ := describeIndexes(ctx, coll)
	if len(found) != 2 { // _id_ plus ours
		t.Errorf("want 2 indexes after 3 passes, got %d: %+v", len(found), found)
	}
}

// Field order distinguishes indexes: {churchId,occurredAt} and
// {occurredAt,churchId} have different prefixes, and treating them as equal
// would let a query needing the churchId prefix believe it is covered.
func TestKeyOrderDistinguishesIndexes(t *testing.T) {
	forward, err := normalizeKey(bson.D{{Key: "churchId", Value: 1}, {Key: "occurredAt", Value: -1}})
	if err != nil {
		t.Fatalf("normalizeKey: %v", err)
	}
	reversed, err := normalizeKey(bson.D{{Key: "occurredAt", Value: -1}, {Key: "churchId", Value: 1}})
	if err != nil {
		t.Fatalf("normalizeKey: %v", err)
	}
	if forward == reversed {
		t.Fatal("index key order must be significant")
	}
}

// Direction matters too: an ascending and a descending index on the same field
// are not interchangeable for a sort.
func TestKeyDirectionIsSignificant(t *testing.T) {
	asc, _ := normalizeKey(bson.D{{Key: "createdAt", Value: 1}})
	desc, _ := normalizeKey(bson.D{{Key: "createdAt", Value: -1}})
	if asc == desc {
		t.Fatal("index direction must be significant")
	}
}

// A compound key given as bson.M has no defined order and cannot be compared
// safely, so it is refused rather than guessed at.
func TestCompoundMapKeysAreRefused(t *testing.T) {
	if _, err := normalizeKey(bson.M{"a": 1, "b": -1}); err == nil {
		t.Fatal("a compound bson.M key must be refused")
	}
	// A single-field map is unambiguous.
	if _, err := normalizeKey(bson.M{"a": 1}); err != nil {
		t.Errorf("a single-field map is unambiguous: %v", err)
	}
}

func TestRequestsUniqueness(t *testing.T) {
	cases := []struct {
		name  string
		model mongo.IndexModel
		want  bool
	}{
		{"no options", mongo.IndexModel{Keys: bson.D{{Key: "a", Value: 1}}}, false},
		{"named only", mongo.IndexModel{
			Keys: bson.D{{Key: "a", Value: 1}}, Options: options.Index().SetName("a"),
		}, false},
		{"unique", mongo.IndexModel{
			Keys: bson.D{{Key: "a", Value: 1}}, Options: options.Index().SetUnique(true),
		}, true},
		{"unique with other options", mongo.IndexModel{
			Keys: bson.D{{Key: "a", Value: 1}},
			Options: options.Index().SetName("x").SetUnique(true).
				SetPartialFilterExpression(bson.M{"a": bson.M{"$exists": true}}),
		}, true},
		{"explicitly not unique", mongo.IndexModel{
			Keys: bson.D{{Key: "a", Value: 1}}, Options: options.Index().SetUnique(false),
		}, false},
	}
	for _, c := range cases {
		if got := requestsUniqueness(c.model); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

// ADR-005 has the Go services and the legacy TypeScript API sharing one
// database, which only works if each can see what the other wrote. Mongoose
// declares churchId as an ObjectId, so a Go document stamped with a string is
// invisible to every Mongoose query — a member created through the Go API
// would simply not appear in the existing dashboard.
func TestGoWritesAreVisibleToMongooseStyleQueries(t *testing.T) {
	db := indexTestDB(t)
	churchOID := bson.NewObjectID()
	ctx := scoped(churchOID.Hex())
	coll := db.Tenant("interop_members")

	if _, err := coll.InsertOne(ctx, bson.M{"firstName": "Ama", "lastName": "Owusu"}); err != nil {
		t.Fatalf("InsertOne: %v", err)
	}

	// Exactly the query Mongoose issues: churchId as a BSON ObjectId.
	raw := db.Global("interop_members")
	count, err := raw.CountDocuments(context.Background(), bson.M{"churchId": churchOID})
	if err != nil {
		t.Fatalf("CountDocuments: %v", err)
	}
	if count != 1 {
		t.Fatalf("a Mongoose-style ObjectId query found %d of the Go-written documents, want 1", count)
	}
}

// And the reverse: documents Mongoose wrote must be readable through the
// tenant wrapper, or the Go services cannot see the existing congregation.
func TestMongooseWritesAreVisibleToGo(t *testing.T) {
	db := indexTestDB(t)
	churchOID := bson.NewObjectID()
	raw := db.Global("interop_reverse")

	// Exactly what Mongoose writes.
	if _, err := raw.InsertOne(context.Background(), bson.M{
		"churchId": churchOID, "firstName": "Kofi", "lastName": "Boateng",
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	ctx := scoped(churchOID.Hex())
	count, err := db.Tenant("interop_reverse").CountDocuments(ctx, nil)
	if err != nil {
		t.Fatalf("CountDocuments: %v", err)
	}
	if count != 1 {
		t.Fatalf("the tenant wrapper found %d Mongoose-written documents, want 1", count)
	}
}

// Documents Go wrote with a string churchId before this fix must stay
// readable, or the fix would strand data rather than repair it.
func TestLegacyStringChurchIdsAreStillMatched(t *testing.T) {
	db := indexTestDB(t)
	churchOID := bson.NewObjectID()
	raw := db.Global("interop_mixed")

	// One written the old way (string), one the new way (ObjectId).
	if _, err := raw.InsertMany(context.Background(), []any{
		bson.M{"churchId": churchOID.Hex(), "name": "written as a string"},
		bson.M{"churchId": churchOID, "name": "written as an ObjectId"},
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	ctx := scoped(churchOID.Hex())
	count, err := db.Tenant("interop_mixed").CountDocuments(ctx, nil)
	if err != nil {
		t.Fatalf("CountDocuments: %v", err)
	}
	if count != 2 {
		t.Fatalf("found %d of 2 documents; both storage forms must match", count)
	}
}

// The isolation guarantee must survive the type change: another church still
// sees nothing, in either storage form.
func TestTypeInteropDoesNotWeakenIsolation(t *testing.T) {
	db := indexTestDB(t)
	mine := bson.NewObjectID()
	theirs := bson.NewObjectID()
	raw := db.Global("interop_isolation")

	if _, err := raw.InsertMany(context.Background(), []any{
		bson.M{"churchId": mine, "name": "mine, ObjectId"},
		bson.M{"churchId": mine.Hex(), "name": "mine, string"},
		bson.M{"churchId": theirs, "name": "theirs, ObjectId"},
		bson.M{"churchId": theirs.Hex(), "name": "theirs, string"},
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	coll := db.Tenant("interop_isolation")
	count, err := coll.CountDocuments(scoped(mine.Hex()), nil)
	if err != nil {
		t.Fatalf("CountDocuments: %v", err)
	}
	if count != 2 {
		t.Fatalf("should see exactly my own 2 documents, got %d", count)
	}

	// And a filter naming the other church is still refused outright.
	if _, err := coll.CountDocuments(scoped(mine.Hex()), bson.M{"churchId": theirs}); !errors.Is(err, ErrCrossTenant) {
		t.Fatalf("a cross-tenant ObjectId filter must be refused, got %v", err)
	}
	if _, err := coll.CountDocuments(scoped(mine.Hex()), bson.M{"churchId": theirs.Hex()}); !errors.Is(err, ErrCrossTenant) {
		t.Fatalf("a cross-tenant string filter must be refused, got %v", err)
	}
}

// A caller may legitimately pass their own church id in either form.
func TestMatchingTenantFilterInEitherFormIsAllowed(t *testing.T) {
	oid := bson.NewObjectID()
	ctx := scoped(oid.Hex())

	if _, err := newColl().scopedFilter(ctx, bson.M{"churchId": oid}); err != nil {
		t.Errorf("an ObjectId matching the scope should be allowed: %v", err)
	}
	if _, err := newColl().scopedFilter(ctx, bson.M{"churchId": oid.Hex()}); err != nil {
		t.Errorf("a string matching the scope should be allowed: %v", err)
	}
}
