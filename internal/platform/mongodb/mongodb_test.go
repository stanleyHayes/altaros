package mongodb

import (
	"context"
	"errors"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// scopedFilter and stampTenant never touch the driver, so they can be tested
// without a database. These run everywhere, including CI.
func newColl() *TenantCollection { return &TenantCollection{name: "members"} }

func scoped(churchID string) context.Context {
	return tenancy.WithScope(context.Background(), tenancy.Scope{ChurchID: churchID})
}

// The headline guarantee: no tenant in context means no query, ever.
func TestQueryWithoutTenantIsRefused(t *testing.T) {
	_, err := newColl().scopedFilter(context.Background(), bson.M{"status": "active"})
	if !errors.Is(err, tenancy.ErrNoTenant) {
		t.Fatalf("want ErrNoTenant, got %v", err)
	}
}

func TestWriteWithoutTenantIsRefused(t *testing.T) {
	_, err := newColl().stampTenant(context.Background(), bson.M{"name": "Ama"})
	if !errors.Is(err, tenancy.ErrNoTenant) {
		t.Fatalf("want ErrNoTenant, got %v", err)
	}
}

// The caller cannot forget the predicate, because they never write it.
func TestTenantPredicateIsInjected(t *testing.T) {
	got, err := newColl().scopedFilter(scoped("church_a"), bson.M{"status": "active"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got[TenantField] != "church_a" {
		t.Errorf("want %s=church_a, got %v", TenantField, got[TenantField])
	}
	if got["status"] != "active" {
		t.Error("caller's own predicates must be preserved")
	}
}

func TestNilFilterStillScoped(t *testing.T) {
	got, err := newColl().scopedFilter(scoped("church_a"), nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 || got[TenantField] != "church_a" {
		t.Errorf("a nil filter must become a tenant-only filter, got %v", got)
	}
}

func TestBsonDFilterIsScoped(t *testing.T) {
	got, err := newColl().scopedFilter(scoped("church_a"), bson.D{{Key: "status", Value: "active"}})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got[TenantField] != "church_a" || got["status"] != "active" {
		t.Errorf("bson.D filters must be scoped and preserved, got %v", got)
	}
}

// A handler that passes a churchId from user input must not be able to read
// another church. The mismatch is refused rather than silently overwritten,
// so the attempt surfaces instead of degrading to a confusing empty result.
func TestCrossTenantFilterIsRejected(t *testing.T) {
	_, err := newColl().scopedFilter(scoped("church_a"), bson.M{TenantField: "church_b"})
	if !errors.Is(err, ErrCrossTenant) {
		t.Fatalf("want ErrCrossTenant, got %v", err)
	}
}

func TestMatchingTenantFilterIsAllowed(t *testing.T) {
	if _, err := newColl().scopedFilter(scoped("church_a"), bson.M{TenantField: "church_a"}); err != nil {
		t.Fatalf("a filter restating the correct church should be allowed: %v", err)
	}
}

// Writing a document that claims another church is the write-side equivalent.
func TestCrossTenantInsertIsRejected(t *testing.T) {
	_, err := newColl().stampTenant(scoped("church_a"), bson.M{
		"name":      "Ama",
		TenantField: "church_b",
	})
	if !errors.Is(err, ErrCrossTenant) {
		t.Fatalf("want ErrCrossTenant, got %v", err)
	}
}

func TestInsertStampsTenantAndTimestamps(t *testing.T) {
	got, err := newColl().stampTenant(scoped("church_a"), bson.M{"name": "Ama"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got[TenantField] != "church_a" {
		t.Errorf("insert must stamp %s", TenantField)
	}
	for _, field := range []string{"createdAt", "updatedAt"} {
		if _, ok := got[field]; !ok {
			t.Errorf("insert must set %s", field)
		}
	}
}

// stampTenant must not mutate the caller's map — a caller reusing a document
// would otherwise carry one church's id into the next write.
func TestStampDoesNotMutateCallerDocument(t *testing.T) {
	doc := bson.M{"name": "Ama"}
	if _, err := newColl().stampTenant(scoped("church_a"), doc); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, leaked := doc[TenantField]; leaked {
		t.Error("stampTenant must not write into the caller's document")
	}
}

func TestScopedFilterDoesNotMutateCallerFilter(t *testing.T) {
	filter := bson.M{"status": "active"}
	if _, err := newColl().scopedFilter(scoped("church_a"), filter); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, leaked := filter[TenantField]; leaked {
		t.Error("scopedFilter must not write into the caller's filter")
	}
}

// An unsupported filter shape cannot be inspected for tenant safety, so it is
// refused rather than passed through unchecked.
func TestUncheckableFilterShapeIsRefused(t *testing.T) {
	type customFilter struct{ Status string }
	if _, err := newColl().scopedFilter(scoped("church_a"), customFilter{Status: "active"}); err == nil {
		t.Fatal("an un-inspectable filter type must be refused, not passed through")
	}
}

// Two churches must never resolve to the same filter.
func TestDifferentChurchesProduceDifferentFilters(t *testing.T) {
	a, _ := newColl().scopedFilter(scoped("church_a"), bson.M{"status": "active"})
	b, _ := newColl().scopedFilter(scoped("church_b"), bson.M{"status": "active"})
	if a[TenantField] == b[TenantField] {
		t.Fatal("filters for different churches must differ")
	}
}

// An aggregation with no tenant is the most dangerous query shape in the
// system: it returns results rather than an error, and the results belong to
// everyone.
func TestAggregateWithoutTenantIsRefused(t *testing.T) {
	_, err := newColl().scopedPipeline(context.Background(), []bson.M{
		{"$group": bson.M{"_id": nil, "total": bson.M{"$sum": "$amount"}}},
	})
	if !errors.Is(err, tenancy.ErrNoTenant) {
		t.Fatalf("want ErrNoTenant, got %v", err)
	}
}

// The tenant stage must come FIRST. A pipeline starting with $group or $sort
// would otherwise have already read every church's documents before any later
// filter could apply.
func TestTenantStageIsPrependedNotAppended(t *testing.T) {
	got, err := newColl().scopedPipeline(scoped("church_a"), []bson.M{
		{"$group": bson.M{"_id": "$type", "total": bson.M{"$sum": "$amount"}}},
		{"$sort": bson.M{"total": -1}},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("want 3 stages, got %d", len(got))
	}

	match, ok := got[0]["$match"].(bson.M)
	if !ok {
		t.Fatalf("the first stage must be $match, got %v", got[0])
	}
	if match[TenantField] != "church_a" {
		t.Errorf("first stage = %v, want %s=church_a", match, TenantField)
	}
	// The caller's own stages must survive, in order.
	if _, ok := got[1]["$group"]; !ok {
		t.Error("the caller's $group should follow the tenant stage")
	}
	if _, ok := got[2]["$sort"]; !ok {
		t.Error("the caller's $sort should be last")
	}
}

// Stages that read or write another collection escape the tenant filter
// entirely, so a leading $match cannot constrain them.
func TestPipelineStagesThatEscapeTheTenantAreRefused(t *testing.T) {
	for _, stage := range []bson.M{
		{"$out": "exported"},
		{"$merge": bson.M{"into": "exported"}},
		{"$unionWith": "transactions"},
		{"$lookup": bson.M{"from": "members", "as": "member"}},
	} {
		if _, err := newColl().scopedPipeline(scoped("church_a"), []bson.M{stage}); err == nil {
			t.Errorf("%v should be refused in a tenant-scoped pipeline", stage)
		}
	}
}

// A forbidden stage buried later in the pipeline is just as dangerous as one
// at the front.
func TestForbiddenStageIsCaughtAnywhereInThePipeline(t *testing.T) {
	_, err := newColl().scopedPipeline(scoped("church_a"), []bson.M{
		{"$match": bson.M{"status": "success"}},
		{"$group": bson.M{"_id": "$type"}},
		{"$out": "everyones_giving"},
	})
	if err == nil {
		t.Fatal("a $out in the last stage must still be refused")
	}
}

// The caller's slice must not be modified under them.
func TestScopedPipelineDoesNotMutateCallerPipeline(t *testing.T) {
	original := []bson.M{{"$group": bson.M{"_id": "$type"}}}
	if _, err := newColl().scopedPipeline(scoped("church_a"), original); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(original) != 1 {
		t.Fatalf("caller's pipeline grew to %d stages", len(original))
	}
	if _, ok := original[0]["$group"]; !ok {
		t.Error("caller's first stage was replaced")
	}
}

// An empty pipeline is still scoped, or "aggregate everything" means every
// church.
func TestEmptyPipelineIsStillScoped(t *testing.T) {
	got, err := newColl().scopedPipeline(scoped("church_a"), nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1 stage, got %d", len(got))
	}
	if match := got[0]["$match"].(bson.M); match[TenantField] != "church_a" {
		t.Errorf("got %v", match)
	}
}
