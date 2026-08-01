package service

import (
	"html"
	"net/http"
	"strings"

	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
)

// writeUnknownChurch answers a subdomain that resolves to no church.
//
// §13.1: "an unknown subdomain gets a branded 'no such church' page, not a 404
// from the router — the visitor typed a church name, and a raw 404 tells them
// nothing." Somebody read `grace-chaple.altaros.com` off a bulletin and typed
// it; the useful answer names what did not resolve so they can see the typo.
//
// Still a 404 status, because that is what it is. The status is for crawlers
// and caches; the body is for the person.
func writeUnknownChurch(w http.ResponseWriter, r *http.Request, slug string) {
	if wantsJSON(r) {
		httpx.Error(w, http.StatusNotFound,
			"No church is using the address "+slug+".")
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	// Never cached. A church that signs up tomorrow gets this address, and a
	// cached "no such church" would outlive their onboarding at every proxy
	// between here and the visitor.
	w.Header().Set("Cache-Control", "no-store")
	// The page reflects a caller-supplied host back to the browser, so the
	// escaping below is doing real work — but a CSP means a mistake in it is
	// not also a script execution.
	w.Header().Set("Content-Security-Policy",
		"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusNotFound)

	// html.EscapeString, not a template: the slug comes from the Host header,
	// which is entirely caller-controlled. Reflecting it raw is a stored-XSS
	// vector aimed at whoever follows a crafted link.
	_, _ = w.Write([]byte(unknownChurchPage(html.EscapeString(slug))))
}

// wantsJSON reports whether the caller is an API client rather than a browser.
//
// A church's public site serves both: the page a visitor reads, and the fetches
// the page itself makes. An HTML error body returned to a fetch() surfaces as a
// JSON parse failure three layers away from the actual problem.
func wantsJSON(r *http.Request) bool {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		return true
	}
	accept := r.Header.Get("Accept")
	// Checked in this order deliberately: a browser sends
	// `text/html,...,*/*;q=0.8`, which contains both, and HTML must win.
	if strings.Contains(accept, "text/html") {
		return false
	}
	return strings.Contains(accept, "application/json")
}

// unknownChurchPage renders the branded page.
//
// Inline styles and no assets on purpose. This page is served for a host that
// resolves to nothing, so there is no church whose stylesheet could be loaded —
// and a page that fails to render because its CSS 404'd is worse than a plain
// one. It also has to work when the platform's own asset host is unreachable,
// which is exactly the sort of incident that produces unresolvable hosts.
func unknownChurchPage(escapedSlug string) string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>No church at this address</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh;
    display: grid; place-items: center; padding: 24px;
    font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #faf9f7; color: #1a1a1a;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #131211; color: #f0eeec; }
    .card { background: #1c1a19; border-color: #2e2b29; }
    .addr { background: #131211; border-color: #34302d; }
    .muted { color: #a09a95; }
  }
  .card {
    max-width: 34rem; width: 100%;
    background: #fff; border: 1px solid #e8e4e0; border-radius: 18px;
    padding: 40px 36px; text-align: center;
  }
  h1 { margin: 0 0 12px; font-size: 1.5rem; font-weight: 650; letter-spacing: -0.02em; }
  p { margin: 0 0 16px; }
  .muted { color: #6b6560; font-size: 0.9375rem; }
  .addr {
    display: inline-block; margin: 4px 0 20px;
    padding: 8px 14px; border: 1px solid #e8e4e0; border-radius: 10px;
    background: #faf9f7;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.9375rem; word-break: break-all;
  }
  .mark { font-size: 2rem; line-height: 1; margin-bottom: 16px; }
</style>
</head>
<body>
  <main class="card">
    <div class="mark" aria-hidden="true">⛪</div>
    <h1>No church at this address</h1>
    <p class="muted">Nothing is using</p>
    <div class="addr">` + escapedSlug + `</div>
    <p class="muted">
      Church addresses are usually the church's name with hyphens, like
      <strong>grace-chapel</strong>. Check the spelling against your bulletin
      or ask the church office.
    </p>
  </main>
</body>
</html>`
}
