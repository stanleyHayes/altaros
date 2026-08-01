package customdomain

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/domain/church"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// Resolver looks up DNS. An interface so tests do not depend on the internet,
// and so a timeout can be enforced — a registrar's nameserver that never
// answers must not hold a request open.
type Resolver interface {
	LookupTXT(ctx context.Context, name string) ([]string, error)
}

// Service manages a church's custom domains.
type Service struct {
	// domains is tenant-scoped for everything a church does with its own.
	domains *mongodb.TenantCollection
	// byHostname is the same collection UNSCOPED, for the two paths that have
	// no tenant: resolving an inbound Host header, and answering the TLS ask
	// endpoint. Both are lookups BY the hostname, which is the thing being
	// authorised — a caller cannot use either to read anything but whether a
	// name they already named is served.
	byHostname *mongo.Collection
	churches   *church.Service
	resolver   Resolver
	now        func() time.Time
}

// NewService builds the custom-domain service.
func NewService(db *mongodb.DB) *Service {
	return &Service{
		domains:    db.Tenant(Collection),
		byHostname: db.Global(Collection),
		churches:   church.NewService(db),
		resolver:   &net.Resolver{},
		now:        time.Now,
	}
}

// WithResolver replaces DNS lookup. For tests.
func (s *Service) WithResolver(r Resolver) *Service {
	s.resolver = r
	return s
}

// EnsureIndexes creates the constraints custom domains depend on.
func (s *Service) EnsureIndexes(ctx context.Context) error {
	err := mongodb.EnsureIndexes(ctx, s.byHostname, []mongo.IndexModel{
		{
			// One hostname, one church, platform-wide. This is the constraint
			// that stops two churches claiming the same name — and it must be
			// GLOBAL rather than per-church, which makes it one of the few
			// indexes here that deliberately does not lead with churchId.
			Keys:    bson.D{{Key: "hostname", Value: 1}},
			Options: options.Index().SetName("uq_custom_hostname").SetUnique(true),
		},
		{
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "status", Value: 1},
			},
			Options: options.Index().SetName("church_domain_status"),
		},
	})
	if err != nil {
		return fmt.Errorf("customdomain: create indexes: %w", err)
	}
	return nil
}

// Claim registers a domain for the caller's church, unverified.
//
// Claiming is not serving. Nothing is issued and nothing resolves until the
// church proves ownership — see the package comment for why that order is the
// whole security property.
func (s *Service) Claim(ctx context.Context, rawHostname, baseDomain string) (*Domain, error) {
	hostname, err := NormaliseHostname(rawHostname)
	if err != nil {
		return nil, err
	}
	if IsReservedHostname(hostname, baseDomain) {
		return nil, fmt.Errorf("%w: %q", ErrHostnameReserved, hostname)
	}

	scope, err := tenancy.FromContext(ctx)
	if err != nil {
		return nil, err
	}

	// The plan gate (Q-12). Checked at claim rather than only at activation so
	// a church on the free tier is told immediately, rather than after adding
	// DNS records that will never be used.
	owner, err := s.churches.ByID(ctx, scope.ChurchID)
	if err != nil {
		return nil, err
	}
	if !owner.Entitled(church.FeatureCustomDomain) {
		return nil, ErrNotEntitled
	}

	existing, err := s.domains.CountDocuments(ctx, bson.M{})
	if err != nil {
		return nil, fmt.Errorf("customdomain: count: %w", err)
	}
	if existing >= maxDomainsPerChurch {
		return nil, ErrTooManyDomains
	}

	token, err := newVerificationToken()
	if err != nil {
		return nil, err
	}

	now := s.now().UTC()
	res, err := s.domains.InsertOne(ctx, bson.M{
		"hostname":          hostname,
		"status":            string(StatusPending),
		"verificationToken": token,
		"createdBy":         mongodb.ID(scope.UserID),
		"createdAt":         now,
		"updatedAt":         now,
	})
	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			// Deliberately does NOT say which church holds it. That would let
			// anyone with an account discover which churches use which domains.
			return nil, ErrHostnameTaken
		}
		return nil, fmt.Errorf("customdomain: claim: %w", err)
	}
	return s.byID(ctx, res.InsertedID.(bson.ObjectID))
}

// Verify checks the DNS TXT record and activates the domain if it matches.
//
// Called when a church says "I've added the record". Idempotent: verifying an
// already-active domain re-checks and succeeds, which is what makes a support
// instruction of "click verify again" safe rather than destructive.
func (s *Service) Verify(ctx context.Context, id string) (*Domain, error) {
	domain, err := s.ByID(ctx, id)
	if err != nil {
		return nil, err
	}

	scope, err := tenancy.FromContext(ctx)
	if err != nil {
		return nil, err
	}
	owner, err := s.churches.ByID(ctx, scope.ChurchID)
	if err != nil {
		return nil, err
	}
	// Re-checked here as well as at claim: a church whose plan lapsed between
	// claiming and verifying must not complete the process.
	if !owner.Entitled(church.FeatureCustomDomain) {
		return nil, ErrNotEntitled
	}

	// A short deadline of its own. A registrar's nameserver that never answers
	// would otherwise hold this request until the caller's timeout, and this is
	// a button a person clicks and waits on.
	lookupCtx, cancel := context.WithTimeout(ctx, dnsTimeout)
	defer cancel()

	record := domain.Record()
	values, lookupErr := s.resolver.LookupTXT(lookupCtx, record.Name)

	now := s.now().UTC()
	if lookupErr != nil {
		// A missing record and a broken nameserver are the same thing to the
		// church — "we could not find it" — but the underlying error is stored
		// so support can tell them apart without reproducing it.
		return s.recordFailure(ctx, domain, now,
			fmt.Sprintf("lookup failed: %v", lookupErr))
	}

	if !containsToken(values, domain.VerificationToken) {
		return s.recordFailure(ctx, domain, now,
			fmt.Sprintf("found %d TXT record(s), none matching", len(values)))
	}

	// Verified. Activation is immediate — Q-12: "the moment a church activates,
	// they get their custom domain". There is no queue and no approval step,
	// because ownership is already proven and a human in that loop is a delay
	// with no decision in it.
	update := bson.M{
		"status":        string(StatusActive),
		"verifiedAt":    now,
		"activatedAt":   now,
		"lastCheckedAt": now,
		"updatedAt":     now,
	}
	if _, err := s.domains.UpdateOne(ctx, bson.M{"_id": domain.ID}, bson.M{
		"$set":   update,
		"$unset": bson.M{"lastError": ""},
	}); err != nil {
		return nil, fmt.Errorf("customdomain: activate: %w", err)
	}
	return s.ByID(ctx, id)
}

// dnsTimeout bounds a verification lookup.
const dnsTimeout = 5 * time.Second

func (s *Service) recordFailure(ctx context.Context, domain *Domain, now time.Time, reason string) (*Domain, error) {
	if _, err := s.domains.UpdateOne(ctx, bson.M{"_id": domain.ID}, bson.M{
		"$set": bson.M{
			"lastCheckedAt": now,
			"lastError":     reason,
			"updatedAt":     now,
		},
	}); err != nil {
		return nil, fmt.Errorf("customdomain: record failure: %w", err)
	}
	return nil, ErrVerificationFailed
}

// containsToken reports whether any TXT value matches.
//
// Trimmed and case-insensitive because a church may retype the token by hand
// from a support call, and some registrar UIs wrap the value in quotes or add
// whitespace of their own. The token has 160 bits of entropy, so tolerating
// case costs nothing.
func containsToken(values []string, token string) bool {
	want := strings.ToLower(strings.TrimSpace(token))
	for _, raw := range values {
		got := strings.ToLower(strings.Trim(strings.TrimSpace(raw), `"`))
		if got == want {
			return true
		}
	}
	return false
}

// Domains lists the caller church's domains.
func (s *Service) Domains(ctx context.Context) ([]Domain, error) {
	var out []Domain
	err := s.domains.Find(ctx, bson.M{}, &out,
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: 1}}))
	if err != nil {
		return nil, fmt.Errorf("customdomain: list: %w", err)
	}
	if out == nil {
		out = []Domain{}
	}
	return out, nil
}

// ByID returns one domain within the caller's church.
func (s *Service) ByID(ctx context.Context, id string) (*Domain, error) {
	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return nil, ErrNotFound
	}
	return s.byID(ctx, oid)
}

func (s *Service) byID(ctx context.Context, oid bson.ObjectID) (*Domain, error) {
	var domain Domain
	err := s.domains.FindOne(ctx, bson.M{"_id": oid}, &domain)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("customdomain: read: %w", err)
	}
	return &domain, nil
}

// Release removes a domain.
//
// Deleted rather than suspended, because this is the church saying they are
// done with it — and leaving the row would keep the hostname claimed against
// the unique index, so nobody else could ever use it.
func (s *Service) Release(ctx context.Context, id string) error {
	domain, err := s.ByID(ctx, id)
	if err != nil {
		return err
	}
	if _, err := s.domains.DeleteOne(ctx, bson.M{"_id": domain.ID}); err != nil {
		return fmt.Errorf("customdomain: release: %w", err)
	}
	return nil
}

// --- serving -----------------------------------------------------------------

// ChurchFor resolves an inbound Host header to a church.
//
// Unscoped by necessity: a visitor arriving at gracechapel.org has no session
// and no tenant, and the hostname is the only thing identifying whose site to
// serve. ACTIVE only — a pending, suspended or unverified domain resolves to
// nothing, so a name that was claimed but never proven never serves anybody's
// content.
func (s *Service) ChurchFor(ctx context.Context, hostname string) (string, error) {
	host := strings.ToLower(strings.TrimSuffix(strings.TrimSpace(hostname), "."))
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	if host == "" {
		return "", ErrNotFound
	}

	var domain Domain
	err := s.byHostname.FindOne(ctx, bson.M{
		"hostname": host,
		"status":   string(StatusActive),
	}).Decode(&domain)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("customdomain: resolve host: %w", err)
	}
	return domain.ChurchID.String(), nil
}

// MayIssueCertificate answers the TLS ask endpoint.
//
// This is the single most important function in the package when on-demand TLS
// is used. Caddy calls it before issuing a certificate for a hostname it has
// not seen; without it, ANY name pointed at this platform triggers issuance,
// which burns the shared ACME budget (300 new orders per 3 hours) and is a
// denial of service against every church still onboarding.
//
// It says yes only for a domain that is ACTIVE — which means a church claimed
// it AND proved ownership by DNS. It deliberately does not verify DNS here:
// this is called on the TLS handshake path, and a nameserver lookup on that
// path makes every first connection as slow as the slowest registrar.
func (s *Service) MayIssueCertificate(ctx context.Context, hostname string) bool {
	churchID, err := s.ChurchFor(ctx, hostname)
	return err == nil && churchID != ""
}

// --- plan changes -------------------------------------------------------------

// SuspendUnentitled deactivates domains whose church no longer pays for them.
//
// The other half of Q-12. A church that stops paying keeps its custom domain
// resolving unless something takes it down, and that means the platform keeps
// renewing a certificate — a recurring cost for a customer who no longer
// exists. It is also the honest behaviour: the feature was in the paid tier.
//
// Suspended rather than deleted, so resubscribing does not mean proving
// ownership again. That distinction is the difference between an upgrade and a
// support ticket.
func (s *Service) SuspendUnentitled(ctx context.Context) (int, error) {
	cursor, err := s.byHostname.Find(ctx, bson.M{"status": string(StatusActive)})
	if err != nil {
		return 0, fmt.Errorf("customdomain: scan active domains: %w", err)
	}
	var active []Domain
	if err := cursor.All(ctx, &active); err != nil {
		return 0, fmt.Errorf("customdomain: read active domains: %w", err)
	}

	suspended := 0
	for _, domain := range active {
		// Each church is looked up in its own scope, because church.ByID is
		// tenant-scoped and this sweep has no tenant of its own.
		scoped := tenancy.WithScope(ctx, tenancy.Scope{ChurchID: domain.ChurchID.String()})
		owner, err := s.churches.ByID(scoped, domain.ChurchID.String())
		if err != nil {
			// A domain whose church is gone. Suspend it: serving a church that
			// no longer exists is worse than a domain that stops resolving.
			if !errors.Is(err, church.ErrNotFound) {
				return suspended, fmt.Errorf("customdomain: look up church: %w", err)
			}
		} else if owner.Entitled(church.FeatureCustomDomain) {
			continue
		}

		now := s.now().UTC()
		if _, err := s.byHostname.UpdateOne(ctx, bson.M{"_id": domain.ID}, bson.M{
			"$set": bson.M{
				"status":    string(StatusSuspended),
				"lastError": "This domain is paused because the church's plan no longer includes custom domains.",
				"updatedAt": now,
			},
		}); err != nil {
			return suspended, fmt.Errorf("customdomain: suspend: %w", err)
		}
		suspended++
	}
	return suspended, nil
}

// Restore reactivates a suspended domain whose church is entitled again.
//
// No re-verification: ownership was already proven and does not expire because
// somebody's billing lapsed.
func (s *Service) Restore(ctx context.Context, id string) (*Domain, error) {
	domain, err := s.ByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if domain.VerifiedAt == nil {
		return nil, ErrNotVerified
	}

	scope, err := tenancy.FromContext(ctx)
	if err != nil {
		return nil, err
	}
	owner, err := s.churches.ByID(ctx, scope.ChurchID)
	if err != nil {
		return nil, err
	}
	if !owner.Entitled(church.FeatureCustomDomain) {
		return nil, ErrNotEntitled
	}

	now := s.now().UTC()
	if _, err := s.domains.UpdateOne(ctx, bson.M{"_id": domain.ID}, bson.M{
		"$set":   bson.M{"status": string(StatusActive), "activatedAt": now, "updatedAt": now},
		"$unset": bson.M{"lastError": ""},
	}); err != nil {
		return nil, fmt.Errorf("customdomain: restore: %w", err)
	}
	return s.ByID(ctx, id)
}
