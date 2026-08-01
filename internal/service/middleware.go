package service

import (
	"errors"
	"net/http"
	"strings"

	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/token"
	"github.com/hayfordstanley/altar-os/internal/platform/tracing"

	"go.opentelemetry.io/otel/trace"
)

// Roles, matching the shared-types contract the frontends already use.
const (
	RoleSuperAdmin  = "SUPER_ADMIN"
	RoleOrgAdmin    = "ORG_ADMIN"
	RoleChurchAdmin = "CHURCH_ADMIN"
	RoleDeptLeader  = "DEPARTMENT_LEADER"
	RoleMember      = "MEMBER"
)

// authenticated verifies the bearer token and puts the caller's tenant scope
// into the request context.
//
// This is the single place a request acquires a tenant. Everything below it
// reaches the database through TenantCollection, which refuses to build a
// query without one — so a handler that forgets to scope its work gets an
// error rather than another church's data. The two halves are deliberate: the
// wrapper cannot be bypassed, and this middleware is the only thing that
// satisfies it.
func authenticated(d *deps.Deps) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw := bearer(r)
			if raw == "" {
				httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
				return
			}

			claims, err := d.Tokens.Verify(r.Context(), raw, token.KindAccess)
			if err != nil {
				switch {
				case errors.Is(err, token.ErrRevoked):
					httpx.Error(w, http.StatusUnauthorized, "Session has ended. Please sign in again.")
				default:
					// Expired, malformed, wrong kind and wrong signature are
					// one message: distinguishing them tells an attacker which
					// part of a forged token to fix.
					httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
				}
				return
			}

			// A token with no church cannot be scoped, and scoping it to
			// "everything" is exactly the bug the tenant wrapper exists to
			// prevent. Refuse instead.
			if claims.ChurchID == "" && claims.Role != RoleSuperAdmin {
				httpx.Error(w, http.StatusForbidden, "This account is not linked to a church.")
				return
			}

			scope := tenancy.Scope{
				ChurchID:       claims.ChurchID,
				OrganizationID: claims.OrganizationID,
				UserID:         claims.UserID,
				Role:           claims.Role,
				CrossBranch:    crossBranch(claims.Role),
			}

			// Tag the request span with the church, so a trace can answer "is
			// this slow for everyone or for one church" — the first question
			// in any incident. Deliberately not the user id, phone or email:
			// a trace backend is a second copy of production data with weaker
			// access controls than the database.
			trace.SpanFromContext(r.Context()).SetAttributes(
				tracing.TenantAttributes(scope.ChurchID, scope.Role)...)

			next.ServeHTTP(w, r.WithContext(tenancy.WithScope(r.Context(), scope)))
		})
	}
}

// crossBranch reports whether a role may read sibling branches. Only org-level
// and platform admins; a church admin sees exactly their own branch.
func crossBranch(role string) bool {
	return role == RoleOrgAdmin || role == RoleSuperAdmin
}

// requireRole rejects callers whose role is not in the allowed set.
//
// Roles are checked against an allowlist rather than a hierarchy level. A
// numeric hierarchy invites "role >= admin" comparisons, and the first role
// that does not fit the ladder — a finance officer who is not a general admin
// — silently gains everything below it.
func requireRole(allowed ...string) func(http.Handler) http.Handler {
	permitted := make(map[string]bool, len(allowed))
	for _, role := range allowed {
		permitted[role] = true
	}
	// A platform admin is always permitted; every list would otherwise repeat
	// it and the one that forgot would lock support out of a live incident.
	permitted[RoleSuperAdmin] = true

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			scope, err := tenancy.FromContext(r.Context())
			if err != nil {
				// Reaching a role check with no scope means the route was
				// mounted without authenticated() — a wiring bug, not a
				// client error.
				httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
				return
			}
			if !permitted[scope.Role] {
				httpx.Error(w, http.StatusForbidden, "You do not have permission to do that.")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// callerScope returns the request's tenant scope.
func callerScope(r *http.Request) (tenancy.Scope, error) {
	return tenancy.FromContext(r.Context())
}

// selfOr reports whether the caller is the member in question, or otherwise
// holds a permission over that kind of record.
//
// This is the OR half of the routes that serve both audiences from one path.
// GET /finance/members/{memberId}/giving cannot carry requirePermission alone —
// that would deny a member their own giving history, since the Member role
// deliberately holds no finance permission — and it cannot rely on ownership
// alone, because leadership legitimately reads other people's.
//
// The permission is a PARAMETER rather than a fixed leadership check, and that
// distinction is load-bearing: the two callers need different ones. Reading a
// member's giving takes finance:read; reading their contact record takes
// member:read. The single hard-coded role list this replaces answered both with
// the same yes, which is how a department leader ended up able to read any
// member's giving history.
//
// Without any of this, an authenticated member could read the whole
// congregation's giving by changing an id in a URL — the single most likely way
// this platform leaks data.
func selfOr(r *http.Request, memberID string, resource rbac.Resource, action rbac.Action) bool {
	scope, err := callerScope(r)
	if err != nil {
		return false
	}
	if scope.UserID == memberID {
		return true
	}
	// A platform admin, for the same reason requireRole admits one.
	if scope.Role == RoleSuperAdmin {
		return true
	}
	return permissionsFrom(r.Context()).Can(resource, action)
}

// bearerFrom extracts a bearer token from an Authorization header value.
func bearerFrom(header string) string {
	if after, ok := strings.CutPrefix(header, "Bearer "); ok {
		return strings.TrimSpace(after)
	}
	return ""
}
