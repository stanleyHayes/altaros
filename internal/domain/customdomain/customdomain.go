// Package customdomain lets a paid church serve its site from its own domain
// (WP-41, §13.2, Q-12).
//
// # Why this is a separate work package from subdomains
//
// `grace-chapel.altaros.com` costs nothing to add: one wildcard certificate
// covers every church, so onboarding the two-hundredth church issues nothing.
// `gracechapel.org` is its own registered domain and needs its own
// certificate. That is the only per-tenant operational cost on this platform
// that grows with customer count, which is why it is a paid-tier feature
// (Q-12) and why shipping subdomains was deliberately not allowed to commit us
// to it.
//
// # The property that matters most
//
// A domain is not served until its owner has PROVEN they own it.
//
// Without that proof, anyone can point DNS at this platform and have it issue a
// certificate for a name they do not control. That is not merely untidy: ACME
// allows 300 new orders per account per 3 hours (§13.2), so an attacker with a
// wildcard DNS zone can exhaust the platform's issuance budget and stop every
// legitimate church onboarding — and every attempt is attributed to us. The
// verification token below is what makes issuance something a church opts into
// for a name it holds, rather than something anyone can trigger.
package customdomain

import (
	"crypto/rand"
	"encoding/base32"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// Collection holding custom domains.
const Collection = "customDomains"

// Status is where a domain sits in its life.
type Status string

const (
	// StatusPending has been claimed and not yet proven.
	StatusPending Status = "pending"
	// StatusVerified has proven ownership; a certificate may be issued.
	StatusVerified Status = "verified"
	// StatusActive is verified AND serving.
	StatusActive Status = "active"
	// StatusSuspended was serving and is not, because the church's plan no
	// longer includes custom domains. Kept rather than deleted: a church that
	// resubscribes should not have to prove ownership again, and deleting the
	// record is how a support ticket becomes a re-verification.
	StatusSuspended Status = "suspended"
)

var (
	// ErrNotFound means no such domain for this church.
	ErrNotFound = errors.New("customdomain: not found")
	// ErrHostnameInvalid means the value is not a usable hostname.
	ErrHostnameInvalid = errors.New("customdomain: that is not a valid domain name")
	// ErrHostnameTaken means another church already claimed it.
	ErrHostnameTaken = errors.New("customdomain: that domain is already in use")
	// ErrHostnameReserved means the domain belongs to the platform.
	ErrHostnameReserved = errors.New("customdomain: that domain cannot be used")
	// ErrNotEntitled means the church's plan does not include custom domains.
	ErrNotEntitled = errors.New("customdomain: custom domains are not included in this plan")
	// ErrNotVerified means an operation needs proven ownership and has none.
	ErrNotVerified = errors.New("customdomain: ownership has not been verified yet")
	// ErrVerificationFailed means the DNS record was absent or did not match.
	ErrVerificationFailed = errors.New("customdomain: the verification record was not found")
	// ErrTooManyDomains means the church has reached its limit.
	ErrTooManyDomains = errors.New("customdomain: this church already has the maximum number of domains")
)

// maxDomainsPerChurch bounds how many a single church may claim.
//
// Three covers the real cases — the church's domain, a www variant, and an old
// domain being redirected — and stops one church consuming the platform's
// shared ACME issuance budget on its own.
const maxDomainsPerChurch = 3

// Domain is a hostname a church serves its site from.
type Domain struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`

	// Hostname is stored lowercased and without a trailing dot, because that is
	// the form a Host header arrives in and a lookup that has to normalise on
	// every request is a lookup that will eventually forget to.
	Hostname string `bson:"hostname" json:"hostname"`
	Status   Status `bson:"status"   json:"status"`

	// VerificationToken is what must appear in a TXT record to prove ownership.
	// Per domain, not per church: a church proving one domain must not thereby
	// be able to claim another.
	VerificationToken string `bson:"verificationToken" json:"verificationToken"`

	VerifiedAt  *time.Time `bson:"verifiedAt,omitempty"  json:"verifiedAt,omitempty"`
	ActivatedAt *time.Time `bson:"activatedAt,omitempty" json:"activatedAt,omitempty"`
	// LastCheckedAt and LastError make a failing verification diagnosable by
	// the church rather than by a support ticket. §13.2: issuance failures must
	// be visible and retryable, never silent.
	LastCheckedAt *time.Time `bson:"lastCheckedAt,omitempty" json:"lastCheckedAt,omitempty"`
	LastError     string     `bson:"lastError,omitempty"    json:"lastError,omitempty"`

	CreatedBy mongodb.ID `bson:"createdBy,omitempty" json:"createdBy,omitempty"`
	CreatedAt time.Time  `bson:"createdAt" json:"createdAt"`
	UpdatedAt time.Time  `bson:"updatedAt" json:"updatedAt"`
}

// Serving reports whether this domain should resolve to its church.
func (d *Domain) Serving() bool { return d != nil && d.Status == StatusActive }

// VerificationRecord is the DNS record a church must publish.
//
// A TXT record on a fixed subdomain rather than at the apex: a church's apex
// TXT records already hold SPF, DMARC and whatever their mail provider needed,
// and asking somebody to add one more there is asking them to edit a line that
// breaks their email if they get it wrong.
type VerificationRecord struct {
	Type  string `json:"type"`
	Name  string `json:"name"`
	Value string `json:"value"`
	// Instructions is what the church's registrar UI actually needs, in the
	// words a non-technical person can match against the form in front of them.
	Instructions string `json:"instructions"`
}

// verificationPrefix is the subdomain the TXT record lives on.
const verificationPrefix = "_altaros-verify"

// Record returns the DNS record proving ownership of this domain.
func (d *Domain) Record() VerificationRecord {
	return VerificationRecord{
		Type:  "TXT",
		Name:  verificationPrefix + "." + d.Hostname,
		Value: d.VerificationToken,
		Instructions: fmt.Sprintf(
			"In your domain provider's DNS settings, add a TXT record with the "+
				"name %q and the value %q. Some providers want only %q in the name "+
				"field. It can take a few minutes to take effect.",
			verificationPrefix+"."+d.Hostname, d.VerificationToken, verificationPrefix),
	}
}

// PointingRecord is where the church points the domain once verified.
type PointingRecord struct {
	Type         string `json:"type"`
	Name         string `json:"name"`
	Value        string `json:"value"`
	Instructions string `json:"instructions"`
}

// Pointing returns the record that sends traffic here.
//
// A CNAME to the church's own subdomain rather than an A record to an IP.
// An A record pins a customer's DNS to an address this platform cannot then
// change without every custom domain going dark; a CNAME means the platform can
// move, and the church never has to be asked to edit DNS again.
func Pointing(hostname, churchSlug, baseDomain string) PointingRecord {
	target := churchSlug + "." + baseDomain
	return PointingRecord{
		Type:  "CNAME",
		Name:  hostname,
		Value: target,
		Instructions: fmt.Sprintf(
			"Point %q at %q with a CNAME record. If your provider will not allow "+
				"a CNAME on the bare domain, use the www version and set a redirect "+
				"from the bare one — most providers call this domain forwarding.",
			hostname, target),
	}
}

// newVerificationToken generates a token for a TXT record.
//
// Base32 without padding: DNS TXT values are quoted strings and survive it
// intact, and it avoids the `/` and `+` of base64 that some registrar UIs
// mangle or reject. Uppercase-insensitive, so a church retyping it by hand
// from a support call still matches.
func newVerificationToken() (string, error) {
	buf := make([]byte, 20)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("customdomain: generate token: %w", err)
	}
	return "altaros-verify-" +
		strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf)), nil
}

// NormaliseHostname canonicalises a hostname and refuses what cannot be served.
func NormaliseHostname(raw string) (string, error) {
	host := strings.ToLower(strings.TrimSpace(raw))

	// People paste a URL when asked for a domain. Taking the host out of it is
	// friendlier than refusing, and unambiguous.
	host = strings.TrimPrefix(host, "https://")
	host = strings.TrimPrefix(host, "http://")
	if slash := strings.IndexByte(host, '/'); slash >= 0 {
		host = host[:slash]
	}
	// A trailing dot is a valid fully-qualified name and is not how a Host
	// header arrives, so it is stripped rather than refused.
	host = strings.TrimSuffix(host, ".")
	// A port is meaningless on a domain a church owns.
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}

	if host == "" {
		return "", fmt.Errorf("%w: it is empty", ErrHostnameInvalid)
	}
	if len(host) > 253 {
		return "", fmt.Errorf("%w: it is too long", ErrHostnameInvalid)
	}
	if net.ParseIP(host) != nil {
		return "", fmt.Errorf("%w: an IP address cannot hold a certificate for a "+
			"church's name", ErrHostnameInvalid)
	}
	// At least one dot: a single label is not a domain anyone can own.
	if !strings.Contains(host, ".") {
		return "", fmt.Errorf("%w: it needs a domain ending such as .org", ErrHostnameInvalid)
	}
	if strings.Contains(host, "*") {
		// A wildcard would let one church claim every subdomain of a name, and
		// wildcards need DNS-01 rather than the ownership check used here.
		return "", fmt.Errorf("%w: wildcards are not supported", ErrHostnameInvalid)
	}

	for _, label := range strings.Split(host, ".") {
		if label == "" {
			return "", fmt.Errorf("%w: it has an empty part", ErrHostnameInvalid)
		}
		if len(label) > 63 {
			return "", fmt.Errorf("%w: one part is too long", ErrHostnameInvalid)
		}
		if strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return "", fmt.Errorf("%w: a part may not start or end with a hyphen",
				ErrHostnameInvalid)
		}
		for _, r := range label {
			isAlnum := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
			if !isAlnum && r != '-' {
				return "", fmt.Errorf("%w: %q is not allowed in a domain name",
					ErrHostnameInvalid, string(r))
			}
		}
	}
	return host, nil
}

// IsReservedHostname refuses domains the platform must keep for itself.
//
// The platform's OWN domain above all. A church that claimed
// `api.altaros.com` as a "custom domain" would be handed the platform's API
// hostname — and unlike the subdomain slug list, this check has to catch the
// whole domain and everything under it.
func IsReservedHostname(host, baseDomain string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	base := strings.ToLower(strings.TrimSpace(baseDomain))
	if base != "" && (host == base || strings.HasSuffix(host, "."+base)) {
		// Every church already has a subdomain here, granted by the platform.
		// Claiming one as a customer domain would bypass that grant.
		return true
	}

	// Hostnames that mean something to software rather than to a church.
	switch host {
	case "localhost", "localhost.localdomain":
		return true
	}
	for _, suffix := range []string{
		// Reserved by RFC 2606 and RFC 6761 for testing and documentation;
		// nobody owns them, so nobody can prove they do.
		".localhost", ".local", ".test", ".example", ".invalid", ".internal",
		// Certificate authorities will not issue for these.
		".onion", ".arpa",
	} {
		if strings.HasSuffix(host, suffix) {
			return true
		}
	}
	return false
}
