package transport

import "strings"

// truncate bounds a provider's response body before it reaches a log line.
//
// Every transport logs what a provider said back when a send fails, because
// "SMS failed" without the provider's own words is not diagnosable. But a
// provider having a bad day can return an HTML error page, and a few of those
// per second turns the log into the outage.
//
// It lived in the Africa's Talking transport until that was removed; it is
// shared by email, push and Arkesel, so it now sits on its own rather than
// inside whichever transport happens to survive next.
func truncate(b []byte) string {
	const limit = 300
	s := strings.TrimSpace(string(b))
	if len(s) > limit {
		return s[:limit] + "…"
	}
	return s
}
