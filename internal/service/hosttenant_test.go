package service

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/hayfordstanley/altar-os/internal/domain/church"
)

// SubdomainOf is where a routing mistake becomes a tenancy mistake, so its
// edges are worth naming individually.
func TestSubdomainOf(t *testing.T) {
	const base = "altaros.com"

	cases := []struct {
		host, want, why string
	}{
		{"grace-chapel.altaros.com", "grace-chapel", "the ordinary case"},
		{"GRACE-CHAPEL.ALTAROS.COM", "grace-chapel", "DNS is case-insensitive"},
		{"grace-chapel.altaros.com:8080", "grace-chapel", "a port must not change the answer"},
		{"grace-chapel.altaros.com.", "grace-chapel", "a fully-qualified name has a trailing dot"},
		{" grace-chapel.altaros.com ", "grace-chapel", "whitespace"},

		{"altaros.com", "", "the apex is not a church"},
		{"altaros.com:8080", "", "nor with a port"},
		{"", "", "an empty Host"},
		{"localhost:8080", "", "local development"},
		{"127.0.0.1:8080", "", "an IP address is not a church called 127"},
		{"[::1]:8080", "", "nor is an IPv6 address"},
		{"grace-chapel.example.com", "", "another domain entirely"},
		{"altaros.com.evil.test", "", "a domain that merely CONTAINS ours"},
		{"a.b.altaros.com", "", "two labels; a wildcard certificate covers one"},
		{".altaros.com", "", "an empty label"},

		// The suffix check must be on the DOT boundary. Without it,
		// `notaltaros.com` ends with `altaros.com` as a string and would
		// resolve to a church called "not".
		{"notaltaros.com", "", "a domain ending in ours but not under it"},
	}

	for _, c := range cases {
		t.Run(c.why, func(t *testing.T) {
			if got := SubdomainOf(c.host, base); got != c.want {
				t.Errorf("SubdomainOf(%q) = %q, want %q", c.host, got, c.want)
			}
		})
	}
}

// With no base domain configured there is no host-based tenancy at all, which
// is what keeps a local gateway on localhost:8080 working.
func TestSubdomainOfWithoutABaseDomainResolvesNothing(t *testing.T) {
	if got := SubdomainOf("grace-chapel.altaros.com", ""); got != "" {
		t.Errorf("got %q, want empty — an unset base domain must disable this", got)
	}
}

// The platform's own hosts must never resolve to a church, and the mechanism
// is the SAME reserved list that stops a church taking them at creation. Two
// lists would be two things to keep in agreement.
func TestPlatformHostsAreNotChurches(t *testing.T) {
	for _, host := range []string{"api", "app", "admin", "www", "cdn", "status"} {
		slug := SubdomainOf(host+".altaros.com", "altaros.com")
		if slug != host {
			t.Fatalf("SubdomainOf(%s) = %q; the test itself is wrong", host, slug)
		}
		if !church.IsReservedSlug(slug) {
			t.Errorf("%q is a platform host but not reserved, so a church could "+
				"take it and capture that hostname", slug)
		}
	}
}

// The unknown-church page reflects a caller-controlled Host back to a browser,
// so escaping it is doing real work rather than being tidy.
func TestTheUnknownChurchPageEscapesTheHost(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Accept", "text/html")

	writeUnknownChurch(rec, req, `<script>alert(1)</script>`)

	body := rec.Body.String()
	if strings.Contains(body, "<script>alert(1)</script>") {
		t.Fatal("the slug was reflected unescaped — that is XSS aimed at whoever " +
			"follows a crafted link")
	}
	if !strings.Contains(body, "&lt;script&gt;") {
		t.Error("the slug should still be SHOWN, escaped, so the visitor can see " +
			"what did not resolve")
	}
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

// A cached "no such church" would outlive the onboarding of the church that
// signs up tomorrow and takes that address.
func TestTheUnknownChurchPageIsNeverCached(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Accept", "text/html")

	writeUnknownChurch(rec, req, "grace-chaple")

	if cc := rec.Header().Get("Cache-Control"); !strings.Contains(cc, "no-store") {
		t.Errorf("Cache-Control = %q, want no-store", cc)
	}
}

// A fetch() from the church's own page must get JSON, not an HTML body that
// surfaces as a parse error three layers away.
func TestAnAPIClientGetsJSONAndAVisitorGetsAPage(t *testing.T) {
	cases := []struct {
		name, path, accept string
		wantHTML           bool
	}{
		{"a browser", "/", "text/html,application/xhtml+xml,*/*;q=0.8", true},
		{"a fetch", "/", "application/json", false},
		{"an api path", "/api/v1/anything", "*/*", false},
		// A browser's Accept contains both; HTML must win.
		{"a browser that also accepts json", "/", "text/html,application/json", true},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, c.path, nil)
			req.Header.Set("Accept", c.accept)

			writeUnknownChurch(rec, req, "grace-chaple")

			isHTML := strings.Contains(rec.Header().Get("Content-Type"), "text/html")
			if isHTML != c.wantHTML {
				t.Errorf("Content-Type = %q, wantHTML = %v",
					rec.Header().Get("Content-Type"), c.wantHTML)
			}
		})
	}
}

// Caching misses is what makes the cache bounded rather than a memory leak: a
// bot walking random subdomains adds an entry per guess.
func TestTheHostCacheRemembersMissesAndStaysBounded(t *testing.T) {
	cache := newHostCache(hostCacheTTL)

	cache.put("no-such-church", hostResolution{})
	resolution, ok := cache.get("no-such-church")
	if !ok {
		t.Fatal("a miss must be cached, or every bot request is a database read")
	}
	if resolution.found {
		t.Error("a cached miss must still report not-found")
	}

	for i := range 12_000 {
		cache.put(string(rune('a'+i%26))+string(rune('a'+i/26%26))+string(rune(i)), hostResolution{})
	}
	cache.mu.RLock()
	size := len(cache.entries)
	cache.mu.RUnlock()
	if size > 10_000 {
		t.Errorf("cache holds %d entries; it must be bounded", size)
	}
}
