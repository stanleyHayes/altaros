package service

import (
	"context"
	"errors"
	"html"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/hayfordstanley/altar-os/internal/domain/church"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
)

// Host-based tenant resolution (WP-39, §13.1).
//
//	grace-chapel.altaros.com  → Grace Chapel's public site
//	app.altaros.com           → the shared sign-in
//	api.altaros.com           → this gateway
//
// This is how a church's own site knows whose it is, and it is deliberately
// SEPARATE from the tenant scope a signed-in request carries. A visitor to a
// church's public site has no session at all — they are reading a service time
// off a page — so `authenticated` cannot be what establishes the church here.
//
// It is also deliberately NOT authorisation. Resolving the host tells the
// renderer which church's PUBLIC content to show. Anything private still goes
// through authenticated + requirePermission, because a Host header is supplied
// by the caller and trusting it for anything else would make every church's
// data one curl flag away.

// hostChurchKey carries the church resolved from the Host header.
type hostChurchKey struct{}

// HostChurch is the public identity of the church a request was addressed to.
//
// Only the fields a public page needs. Not the whole church record: this is
// attached to unauthenticated requests, and a struct that happens to carry the
// church's bank details is one careless handler away from publishing them.
type HostChurch struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Slug string `json:"slug"`
}

// hostChurchFrom returns the church a request was addressed to.
func hostChurchFrom(ctx context.Context) (HostChurch, bool) {
	c, ok := ctx.Value(hostChurchKey{}).(HostChurch)
	return c, ok
}

// withHostChurch attaches a resolved church to a request.
func withHostChurch(ctx context.Context, c HostChurch) context.Context {
	return context.WithValue(ctx, hostChurchKey{}, c)
}

// SubdomainOf extracts a church slug from a Host header.
//
// Returns "" when the host is not a church subdomain — the apex, a platform
// subdomain, an IP address, or a host under some other domain entirely. The
// caller decides what that means; this only reports what it sees.
func SubdomainOf(host, base string) string {
	// Strip the port. A Host header carries one in development (:8080) and
	// whenever a non-standard port is used, and `grace.altaros.com:8080` must
	// resolve the same as `grace.altaros.com`.
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	host = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(host), "."))
	base = strings.ToLower(strings.TrimSpace(base))
	if host == "" || base == "" {
		return ""
	}

	// An IP address is never a church subdomain, and treating one as a slug
	// would make 127.0.0.1 look like a church called "127".
	if net.ParseIP(host) != nil {
		return ""
	}

	suffix := "." + base
	if !strings.HasSuffix(host, suffix) {
		return ""
	}
	label := strings.TrimSuffix(host, suffix)

	// Exactly one label. `a.b.altaros.com` is not a church — accepting it would
	// let a wildcard certificate's coverage decide routing, and `*.altaros.com`
	// does not cover two levels anyway.
	if label == "" || strings.Contains(label, ".") {
		return ""
	}
	return label
}

// tenantFromHost resolves the Host header to a church and attaches it.
//
// Unknown subdomains do NOT 404 from the router. A visitor typed a church's
// name, possibly off a bulletin, and a bare 404 tells them nothing about what
// went wrong — they get a branded page that says which name did not resolve.
//
// A platform subdomain (`app`, `api`) and the apex pass through untouched, so
// the same binary can serve the gateway and the public sites.
func tenantFromHost(d *deps.Deps) func(http.Handler) http.Handler {
	svc := church.NewService(d.Mongo)
	cache := newHostCache(hostCacheTTL)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			slug := SubdomainOf(r.Host, d.Config.PublicBaseDomain)
			if slug == "" || church.IsReservedSlug(slug) {
				// Not a church subdomain. The platform's own hosts are reserved
				// slugs by construction, which is what makes this one check
				// rather than two lists that can disagree.
				next.ServeHTTP(w, r)
				return
			}

			if resolved, ok := cache.get(slug); ok {
				if !resolved.found {
					writeUnknownChurch(w, r, slug)
					return
				}
				next.ServeHTTP(w, r.WithContext(withHostChurch(r.Context(), resolved.church)))
				return
			}

			found, err := svc.ByPublicSlug(r.Context(), slug)
			if err != nil {
				if errors.Is(err, church.ErrNotFound) {
					// Cached as ABSENT too. Without this, a bot walking
					// subdomains puts one database read on every request, and
					// the misses are the cheap half of that traffic to serve.
					cache.put(slug, hostResolution{})
					writeUnknownChurch(w, r, slug)
					return
				}
				d.Log.Error("could not resolve a church from the host",
					"host", r.Host, "slug", slug, "error", err.Error())
				// Fail as "unknown" rather than 500: the visitor cannot act on
				// either, and a branded page is the better of the two.
				writeUnknownChurch(w, r, slug)
				return
			}

			resolved := HostChurch{ID: found.ID.Hex(), Name: found.Name, Slug: found.Slug}
			cache.put(slug, hostResolution{found: true, church: resolved})
			next.ServeHTTP(w, r.WithContext(withHostChurch(r.Context(), resolved)))
		})
	}
}

// hostCacheTTL is how long a host→church resolution is reused.
//
// This lookup is on EVERY request to a public church site, including every
// image and stylesheet, so it cannot be a database read each time. Sixty
// seconds is the compromise: a church that renames or is deactivated stops
// resolving within a minute, which is fast enough for an operation nobody
// performs twice a day.
const hostCacheTTL = 60 * time.Second

type hostResolution struct {
	found  bool
	church HostChurch
}

type hostCache struct {
	mu      sync.RWMutex
	ttl     time.Duration
	entries map[string]hostCacheEntry
}

type hostCacheEntry struct {
	resolution hostResolution
	expires    time.Time
}

func newHostCache(ttl time.Duration) *hostCache {
	return &hostCache{ttl: ttl, entries: map[string]hostCacheEntry{}}
}

func (c *hostCache) get(slug string) (hostResolution, bool) {
	c.mu.RLock()
	entry, ok := c.entries[slug]
	c.mu.RUnlock()

	if !ok || time.Now().After(entry.expires) {
		return hostResolution{}, false
	}
	return entry.resolution, true
}

func (c *hostCache) put(slug string, resolution hostResolution) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Bounded. Caching misses is what makes this necessary rather than
	// theoretical: a bot walking random subdomains would otherwise add an entry
	// per guess and the map would grow without limit. Cleared wholesale because
	// the TTL is a minute — everything in here is nearly expired anyway.
	const maxEntries = 10_000
	if len(c.entries) >= maxEntries {
		c.entries = make(map[string]hostCacheEntry, maxEntries/4)
	}

	c.entries[slug] = hostCacheEntry{resolution: resolution, expires: time.Now().Add(c.ttl)}
}

// handleHostChurch reports which church this request was addressed to.
//
// The public site renderer's first call, and the endpoint an operator hits to
// confirm a subdomain resolves without opening a browser. Deliberately public:
// it returns the church's name and slug, which are already the subdomain and
// the printed join code.
func handleHostChurch() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		found, ok := hostChurchFrom(r.Context())
		if !ok {
			// Reached on the apex or a platform host, where there is no church
			// to report. Not an error — it is the correct answer for
			// api.altaros.com.
			httpx.JSON(w, http.StatusOK, map[string]any{
				"church": nil,
				"reason": "this host is not a church subdomain",
			})
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"church": found})
	}
}

// TenantFromHost is tenantFromHost for the root router (cmd/altar).
//
// Exported because host resolution has to run on EVERY path, not only under
// /api/v1: a visitor typing a church's address into a browser asks for "/", and
// that is the request that most needs to know whose site it is.
func TenantFromHost(d *deps.Deps) func(http.Handler) http.Handler {
	return tenantFromHost(d)
}

// PublicSiteFallback answers a request that matched no API route.
//
// On a church subdomain that is the church's public site. Until WP-40's
// renderer exists it is a holding page — but it is a holding page that proves
// the whole WP-39 chain in a browser: DNS to Host header to church.
//
// Anywhere else it is an ordinary 404, because it is one.
func PublicSiteFallback(d *deps.Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		found, ok := hostChurchFrom(r.Context())
		if !ok {
			// Not a church subdomain. tenantFromHost has already answered for
			// an UNKNOWN one, so reaching here means the apex or a platform
			// host asking for a path that does not exist.
			if wantsJSON(r) {
				httpx.Error(w, http.StatusNotFound, "Not found")
				return
			}
			http.NotFound(w, r)
			return
		}

		if wantsJSON(r) {
			httpx.Error(w, http.StatusNotFound, "Not found")
			return
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		// Short, not none: the holding page is the same for everyone, but it is
		// replaced by the real site at WP-40 and a long cache would outlive
		// that.
		w.Header().Set("Cache-Control", "public, max-age=60")
		w.Header().Set("Content-Security-Policy",
			"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(holdingPage(html.EscapeString(found.Name))))
	}
}

// holdingPage is what a church's subdomain serves until WP-40.
//
// Deliberately says the site is not built yet rather than pretending to be one.
// A church that has just been onboarded and points somebody at their address
// should see something that makes sense, not a blank page or a 404.
func holdingPage(escapedName string) string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>` + escapedName + `</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #faf9f7; color: #1a1a1a; text-align: center;
  }
  @media (prefers-color-scheme: dark) { body { background: #131211; color: #f0eeec; } }
  h1 { margin: 0 0 8px; font-size: 1.75rem; font-weight: 650; letter-spacing: -0.02em; }
  p { margin: 0; color: #6b6560; }
  @media (prefers-color-scheme: dark) { p { color: #a09a95; } }
</style>
</head>
<body>
  <main>
    <h1>` + escapedName + `</h1>
    <p>This church's website is being prepared.</p>
  </main>
</body>
</html>`
}
