package service

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// permissionsKey carries the caller's effective permissions on the request.
type permissionsKey struct{}

// withPermissions attaches a resolved permission set to the request.
func withPermissions(ctx context.Context, set rbac.Set) context.Context {
	return context.WithValue(ctx, permissionsKey{}, set)
}

// permissionsFrom returns the caller's permissions, or an empty set.
//
// Empty rather than nil-with-error, and that matters: every check against an
// empty set fails, so a request that somehow reached a guarded handler without
// resolution is denied rather than waved through.
func permissionsFrom(ctx context.Context) rbac.Set {
	if set, ok := ctx.Value(permissionsKey{}).(rbac.Set); ok {
		return set
	}
	return rbac.NewSet()
}

// Can reports whether the caller may act on a resource. For handlers deciding
// what to include in a response.
func Can(r *http.Request, resource rbac.Resource, action rbac.Action) bool {
	return permissionsFrom(r.Context()).Can(resource, action)
}

// resolvePermissions loads the caller's effective permissions onto the request.
//
// Mounted after authenticated(), which is what puts the user in scope. Resolved
// per request rather than read from the token, because a permission REMOVAL has
// to take effect on the next request rather than at token expiry — the
// direction that matters, since the risk is someone keeping access they should
// have lost.
//
// The cost of that is a lookup per request, which is why the cache below
// exists: a short TTL keeps a removal effectively immediate while stopping a
// busy dashboard issuing two database reads per click.
func resolvePermissions(d *deps.Deps) func(http.Handler) http.Handler {
	svc := rbac.NewService(d.Mongo)
	cache := newPermissionCache(permissionCacheTTL)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			scope, err := tenancy.FromContext(r.Context())
			if err != nil || scope.UserID == "" {
				// No caller resolved. Continue with nothing: the guards below
				// then refuse, rather than this middleware deciding.
				next.ServeHTTP(w, r)
				return
			}

			if set, ok := cache.get(scope.UserID); ok {
				next.ServeHTTP(w, r.WithContext(withPermissions(r.Context(), set)))
				return
			}

			assignment, err := svc.AssignmentFor(r.Context(), scope.UserID)
			if err != nil {
				// Fail closed. An unresolvable assignment means we cannot say
				// what this person may do, and the safe answer to that is
				// "nothing" — not "carry on".
				d.Log.Error("could not resolve permissions; denying",
					"user_id", scope.UserID, "error", err.Error())
				httpx.Error(w, http.StatusForbidden,
					"Your permissions could not be checked. Please sign in again.")
				return
			}

			cache.put(scope.UserID, assignment.Effective)
			next.ServeHTTP(w, r.WithContext(withPermissions(r.Context(), assignment.Effective)))
		})
	}
}

// requirePermission refuses a caller who lacks a permission.
//
// This is the enforcement. Requirement 7 also hides routes and buttons in the
// UI, and that is worth doing — but the client is under the user's control, so
// "the button was not rendered" is not a security boundary. A route protected
// only in the UI is an open route.
func requirePermission(resource rbac.Resource, action rbac.Action) func(http.Handler) http.Handler {
	needed := rbac.NewPermission(resource, action)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if permissionsFrom(r.Context()).Has(needed) {
				next.ServeHTTP(w, r)
				return
			}
			if isPlatformAdmin(r) {
				next.ServeHTTP(w, r)
				return
			}

			// A missing READ is a 404, not a 403. Requirement 7 says the route
			// should not render at all for someone without read — and a 403
			// confirms the resource exists, which is the difference between
			// "you may not see this church's giving" and "this church has
			// giving you may not see".
			if action == rbac.ActionRead {
				httpx.Error(w, http.StatusNotFound, "Not found")
				return
			}
			httpx.Error(w, http.StatusForbidden, "You do not have permission to do that.")
		})
	}
}

// isPlatformAdmin reports whether the caller is ALTAR OS support.
//
// requireRole has always added RoleSuperAdmin to every allowlist, for the
// reason stated there: the one list that forgot would lock support out during a
// live incident. requirePermission needs the same escape, or converting a route
// from one guard to the other silently removes it — and it removes MORE than it
// looks, because a platform admin belongs to no church, so there is no
// tenant-scoped role to resolve and they would hold nothing at all.
//
// Scoped exactly as requireRole scopes it, deliberately. requireRole reads the
// tenant scope first and answers 401 when there is none, so its SUPER_ADMIN
// bypass only ever applied to a platform admin whose token DOES carry a church
// — one who has picked a church to act in. A churchless platform admin is
// refused by both guards, which is the behaviour today and not something this
// change should quietly widen.
func isPlatformAdmin(r *http.Request) bool {
	scope, err := tenancy.FromContext(r.Context())
	return err == nil && scope.Role == RoleSuperAdmin
}

// permissionCacheTTL is how long a resolved permission set is reused.
//
// Ten seconds is the compromise: short enough that revoking access is
// effectively immediate from a person's point of view, long enough that a
// dashboard firing six requests to paint one screen does six cache hits rather
// than six database reads.
const permissionCacheTTL = 10 * time.Second

// permissionCache holds resolved sets briefly.
//
// Per-process, which is correct here rather than a compromise: it is a cache of
// a database read, not a rate limiter, so replicas holding independent copies
// only means each expires its own — no replica can be more stale than the TTL.
type permissionCache struct {
	mu      sync.RWMutex
	ttl     time.Duration
	entries map[string]cachedPermissions
}

type cachedPermissions struct {
	set     rbac.Set
	expires time.Time
}

func newPermissionCache(ttl time.Duration) *permissionCache {
	return &permissionCache{ttl: ttl, entries: map[string]cachedPermissions{}}
}

func (c *permissionCache) get(userID string) (rbac.Set, bool) {
	c.mu.RLock()
	entry, ok := c.entries[userID]
	c.mu.RUnlock()

	if !ok || time.Now().After(entry.expires) {
		return nil, false
	}
	return entry.set, true
}

func (c *permissionCache) put(userID string, set rbac.Set) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Bound the map. A church with a very large staff, or a long-running
	// process, would otherwise accumulate an entry per user who ever signed in
	// — small, but unbounded is unbounded. Clearing wholesale rather than
	// evicting individually because the TTL is seconds: everything in here is
	// nearly expired anyway.
	const maxEntries = 10_000
	if len(c.entries) >= maxEntries {
		c.entries = make(map[string]cachedPermissions, maxEntries/4)
	}

	c.entries[userID] = cachedPermissions{
		set:     set,
		expires: time.Now().Add(c.ttl),
	}
}
