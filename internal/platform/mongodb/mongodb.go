// Package mongodb provides the tenant-safe data access layer (WP-07).
//
// ALTAR OS is shared-schema multi-tenant: tenant-scoped documents all carry a
// churchId, and the known catastrophic failure is a single query that forgets
// to filter on it, returning one church's giving records to another.
//
// The mitigation here is structural rather than procedural. Tenant-scoped
// collections are only reachable through TenantCollection, which:
//
//   - reads the church from the request context, and returns ErrNoTenant if
//     there isn't one, so a query cannot be built "unscoped by accident";
//   - injects churchId into every filter itself, so the caller cannot forget;
//   - refuses a caller-supplied churchId that contradicts the context, so a
//     handler cannot be tricked into reading another tenant by passing an id
//     from user input.
//
// Collections that are genuinely global (churches, organizations, platform
// audit) use Global() explicitly, which makes the exception visible in review.
package mongodb

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/tracing"
)

// TenantField is the document field every tenant-scoped collection carries.
// It matches the camelCase the TypeScript API already writes, so the Go
// services and the legacy API can share one database during migration.
const TenantField = "churchId"

// ErrCrossTenant is returned when a filter names a church other than the one
// in context. This is a rejected security violation, not a not-found.
var ErrCrossTenant = errors.New("mongodb: filter targets a different church than the request scope")

// tenantValue renders a church id in the form the database stores it.
//
// Mongoose declares churchId as Schema.Types.ObjectId, so the legacy
// TypeScript API both writes and queries it as a BSON ObjectId. ADR-005 has
// the two writers sharing one database, so Go must write the same type — a
// document stamped with the string "6a6d…" is simply invisible to every
// Mongoose query, and a member created through the Go API would not appear in
// the existing dashboard at all.
//
// Ids that are not valid ObjectIds stay strings: test fixtures use readable
// scope names, and forcing them through ObjectID would make the wrapper
// untestable without a real database.
func tenantValue(churchID string) any {
	if oid, err := bson.ObjectIDFromHex(churchID); err == nil {
		return oid
	}
	return churchID
}

// tenantMatch builds a filter predicate that matches either storage form.
//
// Both forms have to match during the migration: documents Mongoose wrote
// carry an ObjectId, and any documents Go wrote before this fix carry a
// string. Matching only one silently halves a church's data.
func tenantMatch(churchID string) any {
	if oid, err := bson.ObjectIDFromHex(churchID); err == nil {
		return bson.M{"$in": bson.A{oid, churchID}}
	}
	return churchID
}

// sameChurch reports whether a caller-supplied churchId refers to the church
// in context, in either storage form.
func sameChurch(supplied any, churchID string) bool {
	switch v := supplied.(type) {
	case string:
		return v == churchID
	case bson.ObjectID:
		return v.Hex() == churchID
	default:
		return false
	}
}

// DB wraps a Mongo database with tenant-aware accessors.
type DB struct {
	client *mongo.Client
	db     *mongo.Database
}

// Connect dials MongoDB and verifies the connection before returning, so a
// misconfigured deployment fails at boot rather than on first request.
func Connect(ctx context.Context, cfg config.MongoConfig) (*DB, error) {
	ctx, cancel := context.WithTimeout(ctx, cfg.ConnectTimeout)
	defer cancel()

	client, err := mongo.Connect(options.Client().ApplyURI(cfg.URI))
	if err != nil {
		return nil, fmt.Errorf("mongodb: connect: %w", err)
	}
	if err := client.Ping(ctx, nil); err != nil {
		return nil, fmt.Errorf("mongodb: ping %s: %w", cfg.URI, err)
	}

	return &DB{client: client, db: client.Database(cfg.Database)}, nil
}

// Close disconnects the client.
func (d *DB) Close(ctx context.Context) error {
	if d == nil || d.client == nil {
		return nil
	}
	return d.client.Disconnect(ctx)
}

// Ping verifies the database is reachable, for the readiness probe.
func (d *DB) Ping(ctx context.Context) error {
	if d == nil || d.client == nil {
		return errors.New("mongodb: not connected")
	}
	return d.client.Ping(ctx, nil)
}

// Database exposes the raw database. Reserved for migrations and index
// management; request-path code should use Tenant or Global.
func (d *DB) Database() *mongo.Database { return d.db }

// Global returns a collection with no tenant filtering. Use only for
// genuinely cross-tenant data (churches, organizations, platform audit).
func (d *DB) Global(name string) *mongo.Collection { return d.db.Collection(name) }

// Tenant returns a tenant-scoped view of a collection.
func (d *DB) Tenant(name string) *TenantCollection {
	return &TenantCollection{coll: d.db.Collection(name), name: name}
}

// span starts a database span carrying the collection, the operation, and the
// church — but never the filter.
//
// A filter contains phone numbers, emails and member ids, and a trace backend
// is a second copy of production data with weaker access controls than the
// database. The collection and operation are enough to answer the questions
// traces are for: which query is slow, and for which church.
func (t *TenantCollection) span(ctx context.Context, op string) (context.Context, trace.Span) {
	ctx, span := tracing.Start(ctx, "mongodb."+t.name+"."+op,
		trace.WithSpanKind(trace.SpanKindClient))
	span.SetAttributes(
		attribute.String(tracing.AttrCollection, t.name),
		attribute.String("db.operation", op),
		attribute.String("db.system", "mongodb"),
	)
	if scope, err := tenancy.FromContext(ctx); err == nil {
		span.SetAttributes(tracing.TenantAttributes(scope.ChurchID, scope.Role)...)
	}
	return ctx, span
}

// recordErr marks a span failed and returns the error unchanged.
//
// ErrNoDocuments is deliberately not an error here: "this member has no
// giving history" is a normal answer, and marking it failed would fill the
// trace backend with red spans that mean nothing.
func recordErr(span trace.Span, err error) error {
	if err != nil && !errors.Is(err, mongo.ErrNoDocuments) {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	}
	return err
}

// TenantCollection is a collection that can only be queried within a church.
type TenantCollection struct {
	coll *mongo.Collection
	name string
}

// scopedFilter merges the caller's filter with the church from context.
//
// A caller-supplied churchId is allowed only when it matches the context; a
// mismatch is a cross-tenant attempt and is refused rather than silently
// overwritten, so the attempt is visible instead of quietly downgraded.
func (t *TenantCollection) scopedFilter(ctx context.Context, filter any) (bson.M, error) {
	churchID, err := tenancy.MustChurchID(ctx)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", t.name, err)
	}

	out := bson.M{}
	switch f := filter.(type) {
	case nil:
		// No filter: tenant predicate only.
	case bson.M:
		for k, v := range f {
			out[k] = v
		}
	case bson.D:
		for _, e := range f {
			out[e.Key] = e.Value
		}
	default:
		return nil, fmt.Errorf(
			"%s: filter must be bson.M, bson.D or nil (got %T); "+
				"other shapes cannot be checked for tenant safety", t.name, filter)
	}

	if existing, ok := out[TenantField]; ok {
		if !sameChurch(existing, churchID) {
			return nil, fmt.Errorf("%s: %w", t.name, ErrCrossTenant)
		}
	}

	out[TenantField] = tenantMatch(churchID)
	return out, nil
}

// stampTenant sets churchId on a document being written, and rejects a
// document that claims a different church.
func (t *TenantCollection) stampTenant(ctx context.Context, doc bson.M) (bson.M, error) {
	churchID, err := tenancy.MustChurchID(ctx)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", t.name, err)
	}

	out := bson.M{}
	for k, v := range doc {
		out[k] = v
	}

	if existing, ok := out[TenantField]; ok {
		if !sameChurch(existing, churchID) {
			return nil, fmt.Errorf("%s: %w", t.name, ErrCrossTenant)
		}
	}

	out[TenantField] = tenantValue(churchID)
	now := time.Now().UTC()
	if _, ok := out["createdAt"]; !ok {
		out["createdAt"] = now
	}
	out["updatedAt"] = now
	return out, nil
}

// FindOne returns a single document within the caller's church.
func (t *TenantCollection) FindOne(ctx context.Context, filter any, out any) error {
	ctx, span := t.span(ctx, "findOne")
	defer span.End()

	scoped, err := t.scopedFilter(ctx, filter)
	if err != nil {
		return recordErr(span, err)
	}
	return recordErr(span, t.coll.FindOne(ctx, scoped).Decode(out))
}

// Find returns matching documents within the caller's church.
func (t *TenantCollection) Find(ctx context.Context, filter any, out any, opts ...options.Lister[options.FindOptions]) error {
	ctx, span := t.span(ctx, "find")
	defer span.End()

	scoped, err := t.scopedFilter(ctx, filter)
	if err != nil {
		return recordErr(span, err)
	}
	cur, err := t.coll.Find(ctx, scoped, opts...)
	if err != nil {
		return recordErr(span, err)
	}
	return recordErr(span, cur.All(ctx, out))
}

// CountDocuments counts within the caller's church.
func (t *TenantCollection) CountDocuments(ctx context.Context, filter any) (int64, error) {
	scoped, err := t.scopedFilter(ctx, filter)
	if err != nil {
		return 0, err
	}
	return t.coll.CountDocuments(ctx, scoped)
}

// InsertOne writes a document stamped with the caller's church.
func (t *TenantCollection) InsertOne(ctx context.Context, doc bson.M) (*mongo.InsertOneResult, error) {
	ctx, span := t.span(ctx, "insertOne")
	defer span.End()

	stamped, err := t.stampTenant(ctx, doc)
	if err != nil {
		return nil, recordErr(span, err)
	}
	res, err := t.coll.InsertOne(ctx, stamped)
	return res, recordErr(span, err)
}

// InsertMany writes many documents, each stamped with the caller's church.
//
// UNORDERED. That is the whole reason this exists rather than a loop over
// InsertOne: an unordered insert does not stop at the first failure, so a batch
// that partially collides with a unique index still writes everything that did
// not collide, and reports the collisions per row. That is exactly the shape of
// an offline check-in queue reconciling — most of the batch is new, some of it
// the server already has, and neither outcome may cost the other.
//
// The error on partial failure is a mongo.BulkWriteException whose WriteErrors
// carry the index of each failed document within docs. Callers that expect
// collisions must inspect it rather than treat it as failure; see
// event.Service.Sync.
func (t *TenantCollection) InsertMany(ctx context.Context, docs []bson.M, opts ...options.Lister[options.InsertManyOptions]) (*mongo.InsertManyResult, error) {
	ctx, span := t.span(ctx, "insertMany")
	defer span.End()

	if len(docs) == 0 {
		return &mongo.InsertManyResult{}, nil
	}

	stamped := make([]any, 0, len(docs))
	for _, doc := range docs {
		out, err := t.stampTenant(ctx, doc)
		if err != nil {
			return nil, recordErr(span, err)
		}
		stamped = append(stamped, out)
	}

	// SetOrdered(false) is prepended rather than appended so a caller can
	// override it deliberately, but never fails to get it by omission.
	opts = append([]options.Lister[options.InsertManyOptions]{
		options.InsertMany().SetOrdered(false),
	}, opts...)

	res, err := t.coll.InsertMany(ctx, stamped, opts...)
	// A duplicate key here is an expected outcome, not a fault: recording it as
	// a span error would paint every successful reconcile red.
	if err != nil && !mongo.IsDuplicateKeyError(err) {
		recordErr(span, err)
	}
	return res, err
}

// UpdateOne updates a document within the caller's church.
func (t *TenantCollection) UpdateOne(ctx context.Context, filter any, update bson.M) (*mongo.UpdateResult, error) {
	scoped, err := t.scopedFilter(ctx, filter)
	if err != nil {
		return nil, err
	}
	// Never let an update move a document to another church.
	if set, ok := update["$set"].(bson.M); ok {
		if _, present := set[TenantField]; present {
			return nil, fmt.Errorf("%s: %w (update may not reassign %s)",
				t.name, ErrCrossTenant, TenantField)
		}
		set["updatedAt"] = time.Now().UTC()
	}
	return t.coll.UpdateOne(ctx, scoped, update)
}

// UpdateMany updates every matching document within the caller's church.
//
// The same reassignment guard as UpdateOne, and for a stronger reason: a bulk
// update that could rewrite churchId would move somebody else's documents into
// this church in one statement rather than one at a time.
func (t *TenantCollection) UpdateMany(ctx context.Context, filter any, update bson.M) (*mongo.UpdateResult, error) {
	scoped, err := t.scopedFilter(ctx, filter)
	if err != nil {
		return nil, err
	}
	if set, ok := update["$set"].(bson.M); ok {
		if _, present := set[TenantField]; present {
			return nil, fmt.Errorf("%s: %w (update may not reassign %s)",
				t.name, ErrCrossTenant, TenantField)
		}
		set["updatedAt"] = time.Now().UTC()
	}
	return t.coll.UpdateMany(ctx, scoped, update)
}

// UpsertOne updates a document within the caller's church, creating it if it
// does not exist.
//
// The tenant is applied twice, and both are necessary. The filter is scoped so
// an upsert cannot match another church's document, and churchId is forced
// into $setOnInsert so a newly created document is stamped — an upsert whose
// filter matches nothing inserts a document built from the update, and without
// the stamp that document would have no tenant at all and be invisible to
// every subsequent scoped query.
func (t *TenantCollection) UpsertOne(ctx context.Context, filter any, update bson.M) (*mongo.UpdateResult, error) {
	churchID, err := tenancy.MustChurchID(ctx)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", t.name, err)
	}
	scoped, err := t.scopedFilter(ctx, filter)
	if err != nil {
		return nil, err
	}

	out := bson.M{}
	for k, v := range update {
		out[k] = v
	}

	// Never let an upsert move a document to another church.
	if set, ok := out["$set"].(bson.M); ok {
		if _, present := set[TenantField]; present {
			return nil, fmt.Errorf("%s: %w (upsert may not reassign %s)",
				t.name, ErrCrossTenant, TenantField)
		}
		copied := bson.M{}
		for k, v := range set {
			copied[k] = v
		}
		copied["updatedAt"] = time.Now().UTC()
		out["$set"] = copied
	}

	onInsert := bson.M{}
	if existing, ok := out["$setOnInsert"].(bson.M); ok {
		for k, v := range existing {
			onInsert[k] = v
		}
	}
	if claimed, ok := onInsert[TenantField]; ok {
		if !sameChurch(claimed, churchID) {
			return nil, fmt.Errorf("%s: %w", t.name, ErrCrossTenant)
		}
	}
	onInsert[TenantField] = tenantValue(churchID)
	if _, ok := onInsert["createdAt"]; !ok {
		onInsert["createdAt"] = time.Now().UTC()
	}
	out["$setOnInsert"] = onInsert

	return t.coll.UpdateOne(ctx, scoped, out, options.UpdateOne().SetUpsert(true))
}

// DeleteOne deletes a document within the caller's church.
func (t *TenantCollection) DeleteOne(ctx context.Context, filter any) (*mongo.DeleteResult, error) {
	scoped, err := t.scopedFilter(ctx, filter)
	if err != nil {
		return nil, err
	}
	return t.coll.DeleteOne(ctx, scoped)
}

// DeleteMany deletes every matching document within the caller's church.
//
// The tenant predicate matters more here than anywhere else in this file. An
// unscoped DeleteOne removes one wrong row; an unscoped DeleteMany with a loose
// filter removes a collection. `{"versionId": x}` looks safe until the day two
// churches hold documents that match — and scopedFilter is what makes that
// impossible rather than unlikely.
func (t *TenantCollection) DeleteMany(ctx context.Context, filter any) (*mongo.DeleteResult, error) {
	scoped, err := t.scopedFilter(ctx, filter)
	if err != nil {
		return nil, err
	}
	return t.coll.DeleteMany(ctx, scoped)
}

// Aggregate runs a pipeline within the caller's church.
//
// The tenant predicate is PREPENDED as its own $match stage rather than merged
// into the caller's first stage. That placement is the whole guarantee: a
// pipeline whose first stage is $group, $lookup, $unionWith or $sort would
// otherwise have already read every church's documents before any filter the
// caller wrote could apply. Forcing it first means no stage can ever observe
// another church's data, whatever the caller passes.
//
// It also prevents the caller from omitting the tenant filter by accident,
// which on an aggregation is silent — the pipeline still returns results, just
// results belonging to everyone.
func (t *TenantCollection) Aggregate(ctx context.Context, pipeline []bson.M, out any, opts ...options.Lister[options.AggregateOptions]) error {
	scoped, err := t.scopedPipeline(ctx, pipeline)
	if err != nil {
		return err
	}
	cur, err := t.coll.Aggregate(ctx, scoped, opts...)
	if err != nil {
		return err
	}
	return cur.All(ctx, out)
}

// scopedPipeline prepends the tenant predicate and refuses stages that would
// escape the wrapper.
func (t *TenantCollection) scopedPipeline(ctx context.Context, pipeline []bson.M) ([]bson.M, error) {
	churchID, err := tenancy.MustChurchID(ctx)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", t.name, err)
	}

	for _, stage := range pipeline {
		for _, forbidden := range forbiddenStages {
			if _, bad := stage[forbidden]; bad {
				return nil, fmt.Errorf(
					"%s: %s is not permitted in a tenant-scoped pipeline", t.name, forbidden)
			}
		}
	}

	scoped := make([]bson.M, 0, len(pipeline)+1)
	scoped = append(scoped, bson.M{"$match": bson.M{TenantField: tenantMatch(churchID)}})
	scoped = append(scoped, pipeline...)
	return scoped, nil
}

// forbiddenStages read or write outside the collection the tenant filter
// applies to, so a leading $match cannot constrain them:
//
//   - $out and $merge write results into another collection, leaving the
//     wrapper behind entirely.
//   - $unionWith and $lookup read a second collection, whose documents the
//     leading $match never touched.
//
// Nothing here needs them. Allowing them would make the isolation guarantee
// conditional on someone reviewing every pipeline, which is exactly the
// property this wrapper exists to remove.
var forbiddenStages = []string{"$out", "$merge", "$unionWith", "$lookup"}

// Indexes exposes the underlying index view for migrations. Every
// tenant-scoped compound index must lead with churchId (ADR-005).
func (t *TenantCollection) Indexes() mongo.IndexView { return t.coll.Indexes() }

// EnsureIndexes creates this collection's indexes, tolerating equivalent ones
// the legacy Mongoose API already created under different names. See the
// package-level EnsureIndexes for why that tolerance is necessary and where it
// stops.
func (t *TenantCollection) EnsureIndexes(ctx context.Context, models []mongo.IndexModel) error {
	return EnsureIndexes(ctx, t.coll, models)
}
