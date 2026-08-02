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

// routeBuilders are the services with real endpoints.
//
// The values are UNAPPLIED functions on purpose. Applying one constructs live
// services against the database, so this map can be read for its names without
// a connection — which is what lets Implemented() derive from the same source
// the gateway mounts from, rather than from a second list somebody has to
// remember to update. A service that appears in one and not the other is
// invisible until a client 404s, and that has already happened once here.
func routeBuilders() map[string]func(*deps.Deps) routeSet {
	return map[string]func(*deps.Deps) routeSet{
		"auth":          authRoutes,
		"church":        churchRoutes,
		"rbac":          rbacRoutes,
		"invitation":    invitationRoutes,
		"member":        memberRoutes,
		"finance":       financeRoutes,
		"notification":  notificationRoutes,
		"site":          siteRoutes,
		"domain":        domainRoutes,
		"event":         eventRoutes,
		"platform":      platformRoutes,
		"analytics":     analyticsRoutes,
		"rota":          rotaRoutes,
		"media":         mediaRoutes,
		"welfare":       welfareRoutes,
		"communication": communicationRoutes,
		"spiritual":     spiritualRoutes,
		"social":        socialRoutes,
	}
}

// routeSets builds every service's routes, in mount order.
func routeSets(d *deps.Deps) map[string]routeSet {
	built := make(map[string]routeSet, len(routeBuilders()))
	for name, build := range routeBuilders() {
		built[name] = build(d)
	}
	return built
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
		"site":          buildSite,
		"domain":        buildDomain,
		"platform":      buildPlatform,
		"analytics":     buildAnalytics,
		"rota":          buildRota,
		"media":         buildMedia,
		"welfare":       buildWelfare,
		"event":         buildEvent,
		"spiritual":     buildSpiritual,
		"communication": buildCommunication,
		"social":        buildSocial,
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

	// Host-based tenancy (WP-39) is NOT applied here. cmd/altar wraps the whole
	// root router with it, which covers this router, the readiness endpoints and
	// the NotFound handler that serves a church's public site. Applying it again
	// here would run the resolution twice per request against two separate
	// caches — the same answer, paid for twice.

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

// Implemented lists the services with real routes, sorted. The gateway is
// included because it serves its own index.
//
// Derived from routeBuilders rather than hand-listed, so it cannot disagree
// with what the gateway actually mounts.
func Implemented() []string {
	builders := routeBuilders()
	names := make([]string, 0, len(builders)+1)
	for name := range builders {
		names = append(names, name)
	}
	names = append(names, "gateway")
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
