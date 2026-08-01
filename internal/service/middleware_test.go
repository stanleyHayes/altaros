package service

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"

	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
	"github.com/hayfordstanley/altar-os/internal/platform/token"
)

// newTestDeps builds just enough of Deps to exercise the HTTP middleware:
// a real token issuer backed by a dedicated Redis database.
func newTestDeps(t *testing.T) *deps.Deps {
	t.Helper()

	addr := os.Getenv("REDIS_ADDR")
	if addr == "" {
		addr = "127.0.0.1:6379"
	}
	rdb := redis.NewClient(&redis.Options{Addr: addr, DB: 13})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		testsupport.SkipOrFail(t, "Redis", err)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = rdb.FlushDB(c).Err()
		_ = rdb.Close()
	})

	issuer, err := token.NewIssuer(token.Options{
		Secret:     "test-secret-for-middleware-tests",
		Issuer:     "altar-os-test",
		AccessTTL:  15 * time.Minute,
		RefreshTTL: time.Hour,
		Redis:      rdb,
	})
	if err != nil {
		t.Fatalf("NewIssuer: %v", err)
	}

	return &deps.Deps{
		Config: &config.Config{ServiceName: "test", Env: config.Development},
		// deps.Build always sets a logger; the helper must too, or code that
		// legitimately logs panics on a nil *slog.Logger.
		Log:    slog.New(slog.NewTextHandler(io.Discard, nil)),
		Redis:  rdb,
		Tokens: issuer,
	}
}

// tokenFor mints an access token for an identity.
func tokenFor(t *testing.T, d *deps.Deps, id token.Identity) string {
	t.Helper()
	pair, err := d.Tokens.Issue(context.Background(), id)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	return pair.AccessToken
}

// scopeProbe reports the tenant scope the middleware installed.
func scopeProbe() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, err := tenancy.FromContext(r.Context())
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "no scope in context")
			return
		}
		httpx.JSON(w, http.StatusOK, scope)
	}
}

func call(handler http.Handler, method, path, bearer string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func decodeScope(t *testing.T, rec *httptest.ResponseRecorder) tenancy.Scope {
	t.Helper()
	var env struct {
		Success bool          `json:"success"`
		Data    tenancy.Scope `json:"data"`
		Message string        `json:"message"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode response %q: %v", rec.Body.String(), err)
	}
	return env.Data
}

// The middleware is the single place a request acquires a tenant, and the
// database wrapper refuses to build a query without one. This is that half.
func TestAuthenticatedInstallsTheCallersScope(t *testing.T) {
	d := newTestDeps(t)

	r := chi.NewRouter()
	r.Use(authenticated(d))
	r.Get("/probe", scopeProbe())

	access := tokenFor(t, d, token.Identity{
		UserID:         "user_1",
		ChurchID:       "church_a",
		OrganizationID: "org_1",
		Role:           RoleChurchAdmin,
	})

	rec := call(r, http.MethodGet, "/probe", access)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}

	scope := decodeScope(t, rec)
	if scope.ChurchID != "church_a" {
		t.Errorf("churchId = %q, want church_a", scope.ChurchID)
	}
	if scope.UserID != "user_1" {
		t.Errorf("userId = %q", scope.UserID)
	}
	if scope.Role != RoleChurchAdmin {
		t.Errorf("role = %q", scope.Role)
	}
	// A church admin sees exactly their own branch.
	if scope.CrossBranch {
		t.Error("a church admin must not have cross-branch reach")
	}
}

// An org admin may read sibling branches; a church admin may not. Getting this
// backwards is how one branch reads another's giving.
func TestCrossBranchReachIsRoleScoped(t *testing.T) {
	d := newTestDeps(t)
	r := chi.NewRouter()
	r.Use(authenticated(d))
	r.Get("/probe", scopeProbe())

	cases := []struct {
		role string
		want bool
	}{
		{RoleSuperAdmin, true},
		{RoleOrgAdmin, true},
		{RoleChurchAdmin, false},
		{RoleDeptLeader, false},
		{RoleMember, false},
	}
	for _, c := range cases {
		access := tokenFor(t, d, token.Identity{
			UserID: "u", ChurchID: "church_a", OrganizationID: "org_1", Role: c.role,
		})
		scope := decodeScope(t, call(r, http.MethodGet, "/probe", access))
		if scope.CrossBranch != c.want {
			t.Errorf("%s: crossBranch = %v, want %v", c.role, scope.CrossBranch, c.want)
		}
	}
}

// No token, a forged token, and an expired one are all one message: telling
// them apart tells an attacker which part of a forgery to fix.
func TestUnauthenticatedRequestsAreRefused(t *testing.T) {
	d := newTestDeps(t)
	r := chi.NewRouter()
	r.Use(authenticated(d))
	r.Get("/probe", scopeProbe())

	cases := []struct{ name, bearer string }{
		{"no token", ""},
		{"garbage", "not-a-jwt"},
		{"forged", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOiJhdHRhY2tlciJ9.wrong"},
	}
	for _, c := range cases {
		rec := call(r, http.MethodGet, "/probe", c.bearer)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s: status = %d, want 401", c.name, rec.Code)
		}
	}
}

// A refresh token must not open an authenticated route. Accepting either kind
// would make a long-lived refresh token a permanent API key.
func TestRefreshTokenIsNotAnAccessToken(t *testing.T) {
	d := newTestDeps(t)
	r := chi.NewRouter()
	r.Use(authenticated(d))
	r.Get("/probe", scopeProbe())

	pair, err := d.Tokens.Issue(context.Background(), token.Identity{
		UserID: "u", ChurchID: "church_a", Role: RoleChurchAdmin,
	})
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}

	rec := call(r, http.MethodGet, "/probe", pair.RefreshToken)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("a refresh token must not authenticate a request, got %d", rec.Code)
	}
}

// A revoked session must stop working immediately, and must say so clearly
// enough that the client knows to sign in again rather than retry.
func TestRevokedTokenIsRefused(t *testing.T) {
	d := newTestDeps(t)
	r := chi.NewRouter()
	r.Use(authenticated(d))
	r.Get("/probe", scopeProbe())

	access := tokenFor(t, d, token.Identity{
		UserID: "u", ChurchID: "church_a", Role: RoleChurchAdmin,
	})
	if rec := call(r, http.MethodGet, "/probe", access); rec.Code != http.StatusOK {
		t.Fatalf("the token should work before revocation, got %d", rec.Code)
	}

	if err := d.Tokens.Revoke(context.Background(), access); err != nil {
		t.Fatalf("Revoke: %v", err)
	}
	rec := call(r, http.MethodGet, "/probe", access)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("a revoked token must be refused, got %d", rec.Code)
	}
}

// A token with no church cannot be scoped, and scoping it to "everything" is
// exactly the bug the tenant wrapper exists to prevent.
func TestTokenWithoutAChurchIsRefused(t *testing.T) {
	d := newTestDeps(t)
	r := chi.NewRouter()
	r.Use(authenticated(d))
	r.Get("/probe", scopeProbe())

	access := tokenFor(t, d, token.Identity{UserID: "u", Role: RoleChurchAdmin})
	rec := call(r, http.MethodGet, "/probe", access)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403; a churchless token must not be scoped to everything", rec.Code)
	}
}

func TestRequireRoleAllowsAndRefuses(t *testing.T) {
	d := newTestDeps(t)
	r := chi.NewRouter()
	r.Use(authenticated(d))
	r.With(requireRole(RoleChurchAdmin, RoleOrgAdmin)).Get("/admin", scopeProbe())

	allowed := []string{RoleChurchAdmin, RoleOrgAdmin, RoleSuperAdmin}
	for _, role := range allowed {
		access := tokenFor(t, d, token.Identity{UserID: "u", ChurchID: "c", Role: role})
		if rec := call(r, http.MethodGet, "/admin", access); rec.Code != http.StatusOK {
			t.Errorf("%s should be allowed, got %d", role, rec.Code)
		}
	}

	refused := []string{RoleMember, RoleDeptLeader, "SOMETHING_ELSE", ""}
	for _, role := range refused {
		access := tokenFor(t, d, token.Identity{UserID: "u", ChurchID: "c", Role: role})
		if rec := call(r, http.MethodGet, "/admin", access); rec.Code != http.StatusForbidden {
			t.Errorf("%s should be refused, got %d", role, rec.Code)
		}
	}
}

// A platform admin is always permitted, so no allowlist can accidentally lock
// support out during a live incident.
func TestSuperAdminIsAlwaysPermitted(t *testing.T) {
	d := newTestDeps(t)
	r := chi.NewRouter()
	r.Use(authenticated(d))
	// An allowlist that deliberately omits SUPER_ADMIN.
	r.With(requireRole(RoleDeptLeader)).Get("/narrow", scopeProbe())

	access := tokenFor(t, d, token.Identity{UserID: "u", ChurchID: "c", Role: RoleSuperAdmin})
	if rec := call(r, http.MethodGet, "/narrow", access); rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

// Reaching a role check with no scope means the route was mounted without
// authenticated() — a wiring bug that must fail closed rather than open.
func TestRoleCheckWithoutAuthMiddlewareFailsClosed(t *testing.T) {
	r := chi.NewRouter()
	r.With(requireRole(RoleChurchAdmin)).Get("/oops", scopeProbe())

	if rec := call(r, http.MethodGet, "/oops", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

// Without this, an authenticated member could read anyone's giving by
// changing an id in the URL — the single most likely way this platform leaks
// data.
//
// Access to someone ELSE's record is now decided by a permission rather than a
// role name, which is what makes a church-invented Treasurer role work. The
// role column below only sets the platform-admin escape; everything else is
// driven by `holds`.
func TestSelfOr(t *testing.T) {
	cases := []struct {
		name             string
		role             string
		holds            []rbac.Permission
		callerID, target string
		resource         rbac.Resource
		action           rbac.Action
		want             bool
	}{
		{
			name: "own record, holding nothing at all",
			role: RoleMember, callerID: "u1", target: "u1",
			resource: rbac.ResourceFinance, action: rbac.ActionRead, want: true,
		},
		{
			name: "someone else's, holding nothing",
			role: RoleMember, callerID: "u1", target: "u2",
			resource: rbac.ResourceFinance, action: rbac.ActionRead, want: false,
		},
		{
			name:     "someone else's giving, holding finance:read",
			role:     RoleChurchAdmin,
			holds:    []rbac.Permission{rbac.NewPermission(rbac.ResourceFinance, rbac.ActionRead)},
			callerID: "u1", target: "u2",
			resource: rbac.ResourceFinance, action: rbac.ActionRead, want: true,
		},
		{
			// The narrowing this change makes, stated as a test rather than
			// left to be discovered: the Staff role that DEPARTMENT_LEADER maps
			// to holds member:read and NO finance permission, so a department
			// leader can read a member's record and not their giving. The old
			// role list answered yes to both.
			name:     "member:read does not open the giving history",
			role:     RoleDeptLeader,
			holds:    []rbac.Permission{rbac.NewPermission(rbac.ResourceMember, rbac.ActionRead)},
			callerID: "u1", target: "u2",
			resource: rbac.ResourceFinance, action: rbac.ActionRead, want: false,
		},
		{
			name:     "and the same person can still read the record itself",
			role:     RoleDeptLeader,
			holds:    []rbac.Permission{rbac.NewPermission(rbac.ResourceMember, rbac.ActionRead)},
			callerID: "u1", target: "u2",
			resource: rbac.ResourceMember, action: rbac.ActionRead, want: true,
		},
		{
			// Support keeps its way in, matching requireRole's bypass.
			name: "platform admin, holding nothing",
			role: RoleSuperAdmin, callerID: "u1", target: "u2",
			resource: rbac.ResourceFinance, action: rbac.ActionRead, want: true,
		},
		{
			name: "no role at all",
			role: "", callerID: "u1", target: "u2",
			resource: rbac.ResourceFinance, action: rbac.ActionRead, want: false,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			ctx := tenancy.WithScope(req.Context(), tenancy.Scope{
				ChurchID: "c", UserID: c.callerID, Role: c.role,
			})
			ctx = withPermissions(ctx, rbac.NewSet(c.holds...))
			req = req.WithContext(ctx)

			if got := selfOr(req, c.target, c.resource, c.action); got != c.want {
				t.Errorf("got %v, want %v", got, c.want)
			}
		})
	}
}

// A request with no scope at all must never be treated as self.
func TestSelfOrLeaderWithoutScopeIsRefused(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	if selfOr(req, "anyone", rbac.ResourceMember, rbac.ActionRead) {
		t.Fatal("an unscoped request must not pass the ownership check")
	}
	if selfOr(req, "", rbac.ResourceMember, rbac.ActionRead) {
		t.Fatal("an unscoped request must not match an empty target id")
	}
}

func TestBearerParsing(t *testing.T) {
	cases := []struct{ header, want string }{
		{"Bearer abc123", "abc123"},
		{"Bearer  spaced  ", "spaced"},
		{"bearer lowercase", ""}, // the scheme is case-sensitive per RFC 6750
		{"Basic abc123", ""},
		{"abc123", ""},
		{"", ""},
	}
	for _, c := range cases {
		if got := bearerFrom(c.header); got != c.want {
			t.Errorf("bearerFrom(%q) = %q, want %q", c.header, got, c.want)
		}
	}
}

// implementedNames is maintained by hand because building the real route sets
// needs a database connection. This keeps it honest: a service added to
// routeSets but not to the list would silently never mount on the gateway.
func TestImplementedListMatchesTheRouteSets(t *testing.T) {
	d := newTestDeps(t)
	// Deps with no Mongo would panic inside the service constructors, so this
	// asserts the reverse direction: every name claimed as implemented is
	// either the gateway or a real route set.
	_ = d

	claimed := map[string]bool{}
	for _, name := range Implemented() {
		claimed[name] = true
	}
	if !claimed["gateway"] {
		t.Error("the gateway must appear in Implemented()")
	}
	for _, name := range []string{
		"auth", "church", "member", "finance", "rbac", "invitation", "notification",
	} {
		if !claimed[name] {
			t.Errorf("%s serves real routes but is missing from Implemented()", name)
		}
	}

	// Every implemented name must also be a registered, runnable service.
	for name := range claimed {
		if _, err := Lookup(name); err != nil {
			t.Errorf("%s is claimed as implemented but is not in the registry", name)
		}
	}

	// And nothing still served by a placeholder may claim to be implemented.
	for _, name := range []string{"event", "communication", "ai"} {
		if claimed[name] {
			t.Errorf("%s is still a placeholder but claims to be implemented", name)
		}
	}
}

// Every service must be runnable on its own, which is what makes splitting one
// out a deploy-config change rather than a refactor (ADR-004).
func TestEveryRegisteredServiceIsRunnable(t *testing.T) {
	for _, name := range Names() {
		if _, err := Lookup(name); err != nil {
			t.Errorf("%s is listed but cannot be resolved: %v", name, err)
		}
	}
	if _, err := Lookup("not-a-service"); err == nil {
		t.Error("an unknown service should not resolve")
	}
}
