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
