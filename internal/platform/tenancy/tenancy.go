// Package tenancy carries the calling church through a request.
//
// ALTAR OS is shared-schema multi-tenant: every tenant-scoped row has a
// church_id, and the known failure mode is one missing `WHERE church_id = ?`
// leaking one church's giving records into another's dashboard. The mitigation
// is that tenant scope lives in the context and the data layer refuses to run
// a tenant-scoped query without it — the isolation is structural, not a rule
// people are asked to remember at each call site.
package tenancy

import (
	"context"
	"errors"
)

// ErrNoTenant is returned when a tenant-scoped operation is attempted without
// a resolved church. Callers must treat this as a bug, never as "return all".
var ErrNoTenant = errors.New("tenancy: no church in context")

// Scope identifies who is acting, and on behalf of which church.
type Scope struct {
	// ChurchID is the branch (local assembly) the caller belongs to.
	ChurchID string
	// OrganizationID is the denomination/HQ above the branch. An org-level
	// admin may read across every branch beneath it.
	OrganizationID string
	// UserID is the acting user, recorded on every audit entry.
	UserID string
	// Role determines whether org-wide access is permitted.
	Role string
	// CrossBranch is true when the caller may read sibling branches within
	// their organization (org admins and platform admins).
	CrossBranch bool
}

type ctxKey struct{}

// WithScope returns a context carrying the tenant scope.
func WithScope(ctx context.Context, s Scope) context.Context {
	return context.WithValue(ctx, ctxKey{}, s)
}

// FromContext returns the tenant scope, or ErrNoTenant if absent.
func FromContext(ctx context.Context) (Scope, error) {
	s, ok := ctx.Value(ctxKey{}).(Scope)
	if !ok || s.ChurchID == "" {
		return Scope{}, ErrNoTenant
	}
	return s, nil
}

// MustChurchID returns the church id or an error. Data-access helpers call
// this so a query can never be built without a tenant predicate.
func MustChurchID(ctx context.Context) (string, error) {
	s, err := FromContext(ctx)
	if err != nil {
		return "", err
	}
	return s.ChurchID, nil
}
