package service

import (
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/ratelimit"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// throttle limits a route by caller.
//
// Applied to the unauthenticated surface, where the caller is an IP address
// and there is nothing else to key on. Authenticated routes use throttleUser,
// which keys on the account and therefore survives an attacker changing IP.
func throttle(d *deps.Deps, rule ratelimit.Rule) func(http.Handler) http.Handler {
	limiter := ratelimit.New(d.Redis)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// middleware.RealIP has already resolved X-Forwarded-For, so
			// RemoteAddr is the client rather than the ingress.
			identity := ratelimit.IdentityFromAddr(r.RemoteAddr)

			if !allow(w, r, d, limiter, rule, identity) {
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// throttleUser limits an authenticated route by account.
//
// Keying on the account rather than the address is what makes this useful
// behind a NAT: an entire church office shares one public IP, and a per-IP
// limit there throttles the whole staff because one person held a key down.
func throttleUser(d *deps.Deps, rule ratelimit.Rule) func(http.Handler) http.Handler {
	limiter := ratelimit.New(d.Redis)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			identity := ratelimit.IdentityFromAddr(r.RemoteAddr)
			if scope, err := tenancy.FromContext(r.Context()); err == nil && scope.UserID != "" {
				identity = "user:" + scope.UserID
			}

			if !allow(w, r, d, limiter, rule, identity) {
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// allow checks the rule and writes the refusal if there is one.
func allow(
	w http.ResponseWriter,
	r *http.Request,
	d *deps.Deps,
	limiter *ratelimit.Limiter,
	rule ratelimit.Rule,
	identity string,
) bool {
	decision, err := limiter.Allow(r.Context(), rule, identity)
	if err != nil {
		// Redis is unreachable, and the limiter allowed the request. Refusing
		// instead would lock every church out of the platform over a cache
		// outage, which is worse than temporarily losing the ceiling — the
		// same call the event deduper makes. Logged so the gap is visible
		// rather than assumed.
		d.Log.Warn("rate limiting unavailable; request allowed unthrottled",
			slog.String("rule", rule.Name),
			slog.String("error", err.Error()))
		return true
	}

	w.Header().Set("X-RateLimit-Limit", strconv.FormatInt(rule.Limit, 10))
	w.Header().Set("X-RateLimit-Remaining", strconv.FormatInt(decision.Remaining, 10))

	if decision.Allowed {
		return true
	}

	seconds := int(decision.RetryAfter.Seconds())
	if seconds < 1 {
		seconds = 1
	}
	w.Header().Set("Retry-After", strconv.Itoa(seconds))

	d.Log.Warn("rate limit exceeded",
		slog.String("rule", rule.Name),
		slog.String("path", r.URL.Path),
		// The identity is a bare IP or an account id, never a credential.
		slog.String("identity", identity))

	httpx.Error(w, http.StatusTooManyRequests,
		"Too many attempts. Try again in "+humanise(decision.RetryAfter)+".")
	return false
}

// humanise renders a wait a person can act on. "Try again in 900 seconds" is
// technically accurate and reads as a machine talking to itself.
func humanise(d time.Duration) string {
	switch {
	case d < time.Minute:
		return "a moment"
	case d < 2*time.Minute:
		return "a minute"
	case d < time.Hour:
		return strconv.Itoa(int(d.Minutes())) + " minutes"
	default:
		return "an hour"
	}
}
