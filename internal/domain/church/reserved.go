package church

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// Subdomains a church may not take (WP-39, §13.1).
//
// Under ADR-007 a church's slug IS its subdomain, so this is a routing decision
// rather than a naming one: a church legitimately called "Apostolic Prayer
// International" must not be able to take `api`.
//
// This list MIRRORS packages/shared-types/src/reserved-slugs.ts, which is
// canonical because both writers already share that package. The mirror is
// checked by TestReservedSlugsMatchTheSharedList, which reads that file and
// fails if the two disagree — WP-35 is the reason that test exists rather than
// a comment asking people to remember.
var reservedSlugs = map[string]bool{
	// Platform surfaces named in §13.1.
	"admin": true, "api": true, "app": true, "assets": true, "auth": true,
	"blog": true, "cdn": true, "checkout": true, "dashboard": true, "dev": true,
	"docs": true, "ftp": true, "help": true, "internal": true, "login": true,
	"mail": true, "my": true, "pay": true, "secure": true, "smtp": true,
	"staging": true, "static": true, "status": true, "support": true,
	"test": true, "www": true,

	// Mail and certificate validation. A church holding one of these can
	// receive address-validation mail for the parent domain, which is how
	// domain ownership is proved — an account-takeover surface, not a tidiness
	// one.
	"abuse": true, "administrator": true, "hostmaster": true,
	"postmaster": true, "root": true, "ssl": true, "sysadmin": true,
	"webmaster": true,

	// Reserved for platform expansion. Cheap to hold now, impossible to
	// reclaim once a church has printed one on its bulletins.
	"account": true, "accounts": true, "billing": true, "cms": true,
	"console": true, "email": true, "events": true, "files": true,
	"give": true, "giving": true, "graphql": true, "img": true,
	"media": true, "metrics": true, "mobile": true, "ns1": true, "ns2": true,
	"portal": true, "public": true, "sms": true, "sso": true, "track": true,
	"web": true, "webhook": true, "webhooks": true,
}

var (
	// ErrSlugReserved means the slug belongs to the platform.
	ErrSlugReserved = errors.New("church: that name is reserved by the platform")
	// ErrSlugInvalid means the slug is not a usable subdomain label.
	ErrSlugInvalid = errors.New("church: that name cannot be used as a web address")
)

// slugPattern is the DNS label rule, not a preference.
//
// A subdomain label is lowercase alphanumerics and hyphens, and may not start
// or end with a hyphen. Anything else is not a name a browser can reach, so
// accepting it would store a church that cannot be visited.
var slugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

// maxSlugLength is the DNS limit for a single label.
const maxSlugLength = 63

// minSlugLength keeps one- and two-character subdomains available to the
// platform, and stops a church taking something indistinguishable from a typo.
const minSlugLength = 3

// IsReservedSlug reports whether a slug belongs to the platform.
//
// Normalised first, because DNS is case-insensitive: refusing `api` while
// allowing `API` reserves nothing at all.
func IsReservedSlug(slug string) bool {
	return reservedSlugs[strings.ToLower(strings.TrimSpace(slug))]
}

// ValidateSlug checks that a slug is a usable, unreserved subdomain.
//
// Called at church CREATION and at rename. Refusing later is not equivalent: a
// church that has already put `api.altaros.com` on its bulletins cannot simply
// be renamed, and the platform cannot route around it.
func ValidateSlug(slug string) error {
	normalised := strings.ToLower(strings.TrimSpace(slug))

	if len(normalised) < minSlugLength {
		return fmt.Errorf("%w: it must be at least %d characters", ErrSlugInvalid, minSlugLength)
	}
	if len(normalised) > maxSlugLength {
		return fmt.Errorf("%w: it must be %d characters or fewer", ErrSlugInvalid, maxSlugLength)
	}
	if !slugPattern.MatchString(normalised) {
		return fmt.Errorf("%w: use letters, numbers and hyphens only", ErrSlugInvalid)
	}
	if IsReservedSlug(normalised) {
		return fmt.Errorf("%w: %q", ErrSlugReserved, normalised)
	}
	return nil
}

// ReservedSlugs returns the reserved list, sorted, for the drift test and for
// telling a church what it cannot have.
func ReservedSlugs() []string {
	out := make([]string, 0, len(reservedSlugs))
	for slug := range reservedSlugs {
		out = append(out, slug)
	}
	return out
}
