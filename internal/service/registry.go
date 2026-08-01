// Package service maps a service name to the routes it serves.
//
// Per ADR-004 the eight services from the spec are separate modules with their
// own boundaries, but they compile into a single binary selected with
// -service. Splitting one out later is a deploy-config change (run the same
// image with a different flag), never a refactor.
package service

import (
	"fmt"
	"net/http"
	"sort"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
)

// Builder returns the routes a service mounts under /api/v1.
type Builder func(d *deps.Deps) http.Handler

// routeSet registers a service's endpoints onto a router.
//
// Services expose this rather than a finished http.Handler so the gateway can
// compose several onto one router. chi permits only one Mount per path, so
// mounting each service at "/" panics on the second — and composing at the
// route level is better anyway: the resulting router knows every path, so an
// unmatched request 404s once instead of falling through a chain of handlers
// that each believe they own the root.
type routeSet func(r chi.Router)

// standalone turns a route set into the handler a single service serves when
// run alone with -service=<name>.
func standalone(rs routeSet) http.Handler {
	r := chi.NewRouter()
	rs(r)
	return r
}

// routeSets are the services with real endpoints, in mount order.
func routeSets(d *deps.Deps) map[string]routeSet {
	return map[string]routeSet{
		"auth":         authRoutes(d),
		"church":       churchRoutes(d),
		"rbac":         rbacRoutes(d),
		"invitation":   invitationRoutes(d),
		"member":       memberRoutes(d),
		"finance":      financeRoutes(d),
		"notification": notificationRoutes(d),
	}
}

// registry is the full set of runnable services.
//
// Populated in init() rather than as a composite literal: buildGateway calls
// Names(), which reads registry, and Go rejects that as an initialization
// cycle when the map is initialized statically.
var registry map[string]Builder

func init() {
	registry = map[string]Builder{
		"gateway":       buildGateway,
		"auth":          buildAuth,
		"member":        buildMember,
		"finance":       buildFinance,
		"church":        buildChurch,
		"rbac":          buildRBAC,
		"invitation":    buildInvitation,
		"event":         placeholder("event", "events, RSVP, QR check-in, attendance"),
		"communication": placeholder("communication", "broadcast + targeted messaging"),
		"ai":            placeholder("ai", "sermon assistant, member insights, prayer chat"),
		"notification":  buildNotification,
	}
}

// Names lists every runnable service, sorted for stable help output.
func Names() []string {
	names := make([]string, 0, len(registry))
	for name := range registry {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// Lookup resolves a service by name.
func Lookup(name string) (Builder, error) {
	b, ok := registry[name]
	if !ok {
		return nil, fmt.Errorf("unknown service %q (available: %v)", name, Names())
	}
	return b, nil
}

// buildGateway fronts the platform, mounting every implemented service so the
// frontends have a single origin to talk to.
//
// Per ADR-004 this is a deploy-time composition, not an architectural one:
// each service below is independently runnable with -service=<name>, and
// splitting one out is a config change rather than a refactor. Running them
// together until traffic justifies otherwise avoids operating eight
// deployments before the first paying church.
func buildGateway(d *deps.Deps) http.Handler {
	r := chi.NewRouter()

	// Host-based tenancy (WP-39). Mounted FIRST and outside every other group,
	// because it must run for unauthenticated requests to a church's public
	// site — a visitor reading service times has no session to scope from.
	//
	// A no-op unless PUBLIC_BASE_DOMAIN is set, which is why a local gateway on
	// localhost:8080 is unaffected: there are no subdomains to resolve.
	if d.Config != nil && d.Config.PublicBaseDomain != "" {
		r.Use(tenantFromHost(d))
	}

	// What church this request was addressed to. The public site renderer reads
	// it, and it is also how an operator confirms a subdomain resolves without
	// needing a browser.
	r.Get("/site/church", handleHostChurch())

	r.Get("/", func(w http.ResponseWriter, _ *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]any{
			"service":  "gateway",
			"services": Names(),
			"mounted":  Implemented(),
			"region":   d.Config.DataRegion,
		})
	})

	// Registered in sorted order so the resulting route table is the same on
	// every boot, which makes a routing difference between two deployments
	// visible rather than dependent on map iteration.
	sets := routeSets(d)
	names := make([]string, 0, len(sets))
	for name := range sets {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		sets[name](r)
	}

	// Anything the Go services do not serve goes to the legacy TypeScript API.
	// Registered last so a Go route always wins: the day a domain is ported,
	// its routes shadow the proxy and no client changes.
	//
	// Built once and shared: the proxy owns a connection pool, and constructing
	// it per handler would give the two paths separate pools to the same
	// upstream.
	legacy := legacyProxy(d)
	r.NotFound(legacy.ServeHTTP)
	r.MethodNotAllowed(legacy.ServeHTTP)
	return r
}

// implementedNames lists the services serving real domain routes, as opposed
// to the placeholders still awaiting their work package.
//
// A plain list rather than a key set of routeSets: building the route sets
// constructs live services against the database, so asking "which services
// exist" must not require a connection.
var implementedNames = []string{"auth", "church", "finance", "gateway", "invitation", "member", "notification", "rbac"}

// Implemented lists the services with real routes, sorted. The gateway is
// included because it serves its own index.
func Implemented() []string {
	names := make([]string, len(implementedNames))
	copy(names, implementedNames)
	sort.Strings(names)
	return names
}

// placeholder is a service that boots and reports itself but serves no domain
// routes yet. It exists so the topology is real and runnable from day one;
// each is replaced as its work package lands.
func placeholder(name, responsibility string) Builder {
	return func(_ *deps.Deps) http.Handler {
		r := chi.NewRouter()
		r.Get("/", func(w http.ResponseWriter, _ *http.Request) {
			httpx.JSON(w, http.StatusOK, map[string]any{
				"service":        name,
				"responsibility": responsibility,
				"status":         "not implemented",
			})
		})
		return r
	}
}
