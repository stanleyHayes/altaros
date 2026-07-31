package tenancy

import (
	"context"
	"errors"
	"testing"
)

// The failure mode this guards against is a tenant-scoped query running with
// no church predicate and returning every church's rows. An empty context must
// error, never yield a usable scope.
func TestFromContextWithoutScopeErrors(t *testing.T) {
	if _, err := FromContext(context.Background()); !errors.Is(err, ErrNoTenant) {
		t.Fatalf("want ErrNoTenant, got %v", err)
	}
}

func TestMustChurchIDWithoutScopeErrors(t *testing.T) {
	id, err := MustChurchID(context.Background())
	if !errors.Is(err, ErrNoTenant) {
		t.Fatalf("want ErrNoTenant, got %v", err)
	}
	if id != "" {
		t.Errorf("must not return a church id on failure, got %q", id)
	}
}

// A scope carrying an empty ChurchID is as dangerous as no scope at all: it
// would build `WHERE church_id = ""` and silently match nothing, or worse be
// dropped by a query builder.
func TestEmptyChurchIDIsRejected(t *testing.T) {
	ctx := WithScope(context.Background(), Scope{UserID: "u1", Role: "MEMBER"})
	if _, err := FromContext(ctx); !errors.Is(err, ErrNoTenant) {
		t.Fatal("a scope with an empty ChurchID must be rejected")
	}
}

func TestRoundTrip(t *testing.T) {
	want := Scope{
		ChurchID:       "church_1",
		OrganizationID: "org_1",
		UserID:         "user_1",
		Role:           "CHURCH_ADMIN",
		CrossBranch:    true,
	}

	got, err := FromContext(WithScope(context.Background(), want))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != want {
		t.Errorf("scope did not round-trip:\n got %+v\nwant %+v", got, want)
	}
}

func TestScopesDoNotLeakBetweenContexts(t *testing.T) {
	base := context.Background()
	a := WithScope(base, Scope{ChurchID: "church_a"})
	b := WithScope(base, Scope{ChurchID: "church_b"})

	scopeA, _ := FromContext(a)
	scopeB, _ := FromContext(b)

	if scopeA.ChurchID == scopeB.ChurchID {
		t.Fatal("sibling contexts must not share a tenant scope")
	}
	if _, err := FromContext(base); !errors.Is(err, ErrNoTenant) {
		t.Error("deriving a scoped context must not mutate the parent")
	}
}
