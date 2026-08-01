package service

import (
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
)

// legacyProxy forwards requests the Go services do not serve to the legacy
// TypeScript API.
//
// This is the strangler-fig half of the migration, and it is what makes the
// cutover safe. Without it the frontends would have to know which domains have
// been ported and split their traffic across two origins — so every work
// package would mean a coordinated frontend release, and any mistake would
// show up as a broken screen rather than a failed deploy. With it there is one
// origin from the client's point of view, and a domain moves from TypeScript
// to Go the moment its routes appear above this handler.
//
// One token authenticates against both because the Go access token carries the
// `id` and `churchId` claims the TypeScript middleware reads, and both APIs
// share JWT_SECRET (see the shim on token.Claims). That coupling is deliberate
// and temporary: it disappears with the legacy API at WP-20.
//
// If no legacy URL is configured, the gateway simply 404s unported paths,
// which is the correct behaviour once the legacy API is gone.
func legacyProxy(d *deps.Deps) http.Handler {
	target := strings.TrimSpace(d.Config.LegacyAPIURL)
	if target == "" {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			httpx.Error(w, http.StatusNotFound, "No such endpoint")
		})
	}

	upstream, err := url.Parse(target)
	if err != nil {
		d.Log.Error("legacy API URL is not a valid URL; unported routes will 404",
			slog.String("url", target), slog.String("error", err.Error()))
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			httpx.Error(w, http.StatusNotFound, "No such endpoint")
		})
	}

	proxy := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(upstream)
			// Preserve the caller's Host so the legacy API builds correct
			// absolute URLs (password reset links, pagination) rather than
			// pointing them at its own internal address.
			pr.Out.Host = pr.In.Host
			pr.SetXForwarded()
		},
		// A short timeout: this is an in-datacentre hop, and a slow legacy
		// request holding a gateway connection open is how one struggling
		// service takes the whole platform down.
		Transport: &http.Transport{
			ResponseHeaderTimeout: 25 * time.Second,
			IdleConnTimeout:       90 * time.Second,
			MaxIdleConnsPerHost:   32,
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			d.Log.Error("legacy API unreachable",
				slog.String("path", r.URL.Path), slog.String("error", err.Error()))
			// 502, not 500: the fault is upstream, and saying so lets the
			// client retry rather than treating it as a permanent failure.
			httpx.Error(w, http.StatusBadGateway,
				"That part of the service is temporarily unavailable.")
		},
	}

	d.Log.Info("forwarding unported routes to the legacy API",
		slog.String("upstream", upstream.String()))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// chi's Mount routes on its own internal path but leaves r.URL.Path as
		// the client sent it, so the /api/v1 prefix is normally still there.
		// Restoring it unconditionally produced /api/v1/api/v1/events; adding
		// it only when absent keeps this correct whether the gateway is
		// mounted at that prefix or served at the root.
		if !strings.HasPrefix(r.URL.Path, LegacyPathPrefix) {
			r.URL.Path = LegacyPathPrefix + r.URL.Path
		}
		proxy.ServeHTTP(w, r)
	})
}

// LegacyPathPrefix is the prefix the gateway mounts services under, and which
// the legacy API also serves.
const LegacyPathPrefix = "/api/v1"
