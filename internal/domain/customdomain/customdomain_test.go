package customdomain

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/domain/church"
	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

const baseDomain = "altaros.test"

// fakeResolver answers DNS from a map, so the tests do not depend on the
// internet and can put a wrong value in a record on purpose.
type fakeResolver struct {
	records map[string][]string
	err     error
}

func (f *fakeResolver) LookupTXT(_ context.Context, name string) ([]string, error) {
	if f.err != nil {
		return nil, f.err
	}
	values, ok := f.records[name]
	if !ok {
		return nil, errors.New("no such host")
	}
	return values, nil
}

type harness struct {
	svc      *Service
	dns      *fakeResolver
	db       *mongodb.DB
	ctx      context.Context
	churchID bson.ObjectID
}

// newHarness builds a service against a church on a given plan.
func newHarness(t *testing.T, plan string) *harness {
	t.Helper()

	connectCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	db, err := mongodb.Connect(connectCtx, config.MongoConfig{
		URI:            testsupport.MongoURI(),
		Database:       "altar_test_customdomain",
		ConnectTimeout: 5 * time.Second,
	})
	if err != nil {
		testsupport.SkipOrFail(t, "MongoDB", err)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = db.Database().Drop(c)
		_ = db.Close(c)
	})

	churchID := bson.NewObjectID()
	_, err = db.Global("churches").InsertOne(context.Background(), bson.M{
		"_id": churchID, "name": "Grace Chapel", "slug": "grace-chapel",
		"plan": plan, "isActive": true,
	})
	if err != nil {
		t.Fatalf("seed church: %v", err)
	}

	dns := &fakeResolver{records: map[string][]string{}}
	svc := NewService(db).WithResolver(dns)

	ctx := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: churchID.Hex(),
		UserID:   bson.NewObjectID().Hex(),
		Role:     "CHURCH_ADMIN",
	})
	if err := svc.EnsureIndexes(ctx); err != nil {
		t.Fatalf("EnsureIndexes: %v", err)
	}
	return &harness{svc: svc, dns: dns, db: db, ctx: ctx, churchID: churchID}
}

// publish makes the DNS record the church was told to add.
func (h *harness) publish(domain *Domain) {
	record := domain.Record()
	h.dns.records[record.Name] = []string{record.Value}
}

// --- the plan gate (Q-12) ----------------------------------------------------

// TestAFreeChurchCannotClaimADomain is Q-12's answer, asserted.
//
// Custom domains are paid-tier because each one needs its own certificate —
// the only per-tenant operational cost on this platform that grows with
// customer count.
func TestAFreeChurchCannotClaimADomain(t *testing.T) {
	h := newHarness(t, "free")

	_, err := h.svc.Claim(h.ctx, "gracechapel.org", baseDomain)
	if !errors.Is(err, ErrNotEntitled) {
		t.Fatalf("got %v, want ErrNotEntitled", err)
	}
}

func TestAPaidChurchCanClaimADomain(t *testing.T) {
	for _, plan := range []string{"basic", "pro", "enterprise"} {
		t.Run(plan, func(t *testing.T) {
			h := newHarness(t, plan)
			if _, err := h.svc.Claim(h.ctx, "gracechapel.org", baseDomain); err != nil {
				t.Fatalf("a %s church was refused: %v", plan, err)
			}
		})
	}
}

// A plan value nobody recognises must fail to the CHEAPEST tier. The other
// direction hands paid capabilities to a church because of a typo in a billing
// record, and unbilled certificate issuance is not the failure anyone notices.
func TestAnUnrecognisedPlanIsTreatedAsFree(t *testing.T) {
	for _, plan := range []string{"growth", "", "PRO ", "legacy-tier"} {
		t.Run(plan, func(t *testing.T) {
			h := newHarness(t, plan)
			_, err := h.svc.Claim(h.ctx, "gracechapel.org", baseDomain)

			// "PRO " with whitespace and case IS pro — normalisation is
			// deliberate. Everything unrecognised is free.
			if strings.EqualFold(strings.TrimSpace(plan), "pro") {
				if err != nil {
					t.Fatalf("%q should normalise to pro: %v", plan, err)
				}
				return
			}
			if !errors.Is(err, ErrNotEntitled) {
				t.Fatalf("plan %q = %v, want ErrNotEntitled", plan, err)
			}
		})
	}
}

// A DEACTIVATED church is entitled to nothing, whatever it pays. Without this,
// a church that is switched off keeps its domain resolving and the platform
// keeps renewing a certificate for it.
func TestADeactivatedChurchIsNotEntitled(t *testing.T) {
	h := newHarness(t, "pro")
	_, err := h.db.Global("churches").UpdateByID(h.ctx, h.churchID,
		bson.M{"$set": bson.M{"isActive": false}})
	if err != nil {
		t.Fatalf("deactivate: %v", err)
	}

	if _, err := h.svc.Claim(h.ctx, "gracechapel.org", baseDomain); err == nil {
		t.Fatal("a deactivated church claimed a domain")
	}
}

// --- ownership ---------------------------------------------------------------

// TestADomainDoesNotServeUntilOwnershipIsProven is the property the whole
// package exists for.
//
// Without it, anyone can point DNS at this platform and have a certificate
// issued for a name they do not control — which exhausts the shared ACME
// budget and stops every legitimate church onboarding.
func TestADomainDoesNotServeUntilOwnershipIsProven(t *testing.T) {
	h := newHarness(t, "pro")

	domain, err := h.svc.Claim(h.ctx, "gracechapel.org", baseDomain)
	if err != nil {
		t.Fatalf("Claim: %v", err)
	}
	if domain.Status != StatusPending {
		t.Fatalf("a fresh claim is %q, want pending", domain.Status)
	}

	// Claimed but not proven: it must not resolve and must not authorise a
	// certificate.
	if _, err := h.svc.ChurchFor(h.ctx, "gracechapel.org"); !errors.Is(err, ErrNotFound) {
		t.Error("an unverified domain resolved to a church")
	}
	if h.svc.MayIssueCertificate(h.ctx, "gracechapel.org") {
		t.Fatal("an unverified domain authorised certificate issuance — anyone " +
			"pointing DNS here could burn the platform's ACME budget")
	}

	// Verification fails while the record is absent.
	if _, err := h.svc.Verify(h.ctx, domain.ID.Hex()); !errors.Is(err, ErrVerificationFailed) {
		t.Fatalf("Verify with no record = %v, want ErrVerificationFailed", err)
	}

	// Publish the record and verify.
	h.publish(domain)
	verified, err := h.svc.Verify(h.ctx, domain.ID.Hex())
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if verified.Status != StatusActive {
		t.Fatalf("status after verification = %q, want active", verified.Status)
	}
	if !h.svc.MayIssueCertificate(h.ctx, "gracechapel.org") {
		t.Error("a verified domain should authorise issuance")
	}
	churchID, err := h.svc.ChurchFor(h.ctx, "gracechapel.org")
	if err != nil || churchID != h.churchID.Hex() {
		t.Errorf("ChurchFor = %q, %v; want the owning church", churchID, err)
	}
}

// A record with the WRONG value must not verify — otherwise the check is
// "is there any TXT record", which every domain with SPF already satisfies.
func TestAWrongTokenDoesNotVerify(t *testing.T) {
	h := newHarness(t, "pro")
	domain, _ := h.svc.Claim(h.ctx, "gracechapel.org", baseDomain)

	record := domain.Record()
	h.dns.records[record.Name] = []string{
		"v=spf1 include:_spf.google.com ~all",
		"altaros-verify-somebodyelsestoken",
	}

	if _, err := h.svc.Verify(h.ctx, domain.ID.Hex()); !errors.Is(err, ErrVerificationFailed) {
		t.Fatalf("got %v, want ErrVerificationFailed", err)
	}
}

// Registrars quote values, add whitespace, and people retype tokens by hand
// off a support call. The token has 160 bits of entropy, so tolerating that
// costs nothing and removes a class of "it says it's there" support tickets.
func TestVerificationToleratesHowRegistrarsStoreValues(t *testing.T) {
	// Each mangles the real token the way a registrar or a person would.
	mangles := map[string]func(string) string{
		"as issued":         func(tok string) string { return tok },
		"quoted":            func(tok string) string { return `"` + tok + `"` },
		"padded":            func(tok string) string { return "  " + tok + "  " },
		"retyped in caps":   strings.ToUpper,
		"quoted and padded": func(tok string) string { return ` "` + tok + `" ` },
	}

	for name, mangle := range mangles {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t, "pro")
			domain, _ := h.svc.Claim(h.ctx, "gracechapel.org", baseDomain)
			record := domain.Record()

			stored := mangle(record.Value)
			if name != "as issued" && stored == record.Value {
				t.Fatalf("the test did not actually mangle the token: %q", stored)
			}
			h.dns.records[record.Name] = []string{stored}

			if _, err := h.svc.Verify(h.ctx, domain.ID.Hex()); err != nil {
				t.Fatalf("a record stored as %q was refused: %v", stored, err)
			}
		})
	}
}

// A failed verification says WHY, so the church can fix it without a support
// ticket. §13.2: issuance failures must be visible and retryable, never silent.
func TestAFailedVerificationRecordsWhy(t *testing.T) {
	h := newHarness(t, "pro")
	domain, _ := h.svc.Claim(h.ctx, "gracechapel.org", baseDomain)

	_, _ = h.svc.Verify(h.ctx, domain.ID.Hex())

	after, err := h.svc.ByID(h.ctx, domain.ID.Hex())
	if err != nil {
		t.Fatalf("ByID: %v", err)
	}
	if after.LastError == "" {
		t.Error("a failed verification should record why")
	}
	if after.LastCheckedAt == nil {
		t.Error("a failed verification should record when it was checked")
	}
}

// --- what cannot be claimed --------------------------------------------------

// The platform's own domain above all: a church claiming api.altaros.com as a
// "custom domain" would be handed the platform's API hostname.
func TestThePlatformsOwnDomainCannotBeClaimed(t *testing.T) {
	h := newHarness(t, "pro")

	for _, hostname := range []string{
		"altaros.test", "api.altaros.test", "anything.altaros.test",
		"grace-chapel.altaros.test",
	} {
		if _, err := h.svc.Claim(h.ctx, hostname, baseDomain); !errors.Is(err, ErrHostnameReserved) {
			t.Errorf("Claim(%q) = %v, want ErrHostnameReserved", hostname, err)
		}
	}
}

// No certificate authority will issue for these, so claiming one produces a
// domain that can never be served. What matters is that each is REFUSED; which
// refusal depends on whether it is even shaped like a domain — `localhost` has
// no dot and fails that check first, which is correct and not worth forcing
// into one error.
func TestHostnamesThatCannotHoldACertificate(t *testing.T) {
	h := newHarness(t, "pro")

	for _, hostname := range []string{
		"localhost", "church.local", "church.test", "site.invalid",
		"example.internal", "abcd.onion", "host.arpa",
	} {
		_, err := h.svc.Claim(h.ctx, hostname, baseDomain)
		if err == nil {
			t.Errorf("Claim(%q) succeeded — no CA will issue for it, so it could "+
				"never be served", hostname)
			continue
		}
		if !errors.Is(err, ErrHostnameReserved) && !errors.Is(err, ErrHostnameInvalid) {
			t.Errorf("Claim(%q) = %v, want a refusal", hostname, err)
		}
	}
}

func TestMalformedHostnamesAreRefused(t *testing.T) {
	h := newHarness(t, "pro")

	for _, hostname := range []string{
		"", "notadomain", "-leading.org", "trailing-.org", "spaces in.org",
		"under_score.org", "192.168.1.1", "*.gracechapel.org", "double..dot.org",
	} {
		if _, err := h.svc.Claim(h.ctx, hostname, baseDomain); !errors.Is(err, ErrHostnameInvalid) {
			t.Errorf("Claim(%q) = %v, want ErrHostnameInvalid", hostname, err)
		}
	}
}

// People paste a URL when asked for a domain.
func TestAPastedURLIsAccepted(t *testing.T) {
	for _, pasted := range []string{
		"https://gracechapel.org", "http://gracechapel.org/",
		"gracechapel.org.", "GraceChapel.org", " gracechapel.org ",
		"https://gracechapel.org/about",
	} {
		got, err := NormaliseHostname(pasted)
		if err != nil {
			t.Errorf("NormaliseHostname(%q) = %v", pasted, err)
			continue
		}
		if got != "gracechapel.org" {
			t.Errorf("NormaliseHostname(%q) = %q, want gracechapel.org", pasted, got)
		}
	}
}

// Two churches must not be able to claim one hostname — the unique index is
// global rather than per-church for exactly this.
func TestTwoChurchesCannotClaimOneDomain(t *testing.T) {
	h := newHarness(t, "pro")

	if _, err := h.svc.Claim(h.ctx, "gracechapel.org", baseDomain); err != nil {
		t.Fatalf("first claim: %v", err)
	}

	other := bson.NewObjectID()
	_, err := h.db.Global("churches").InsertOne(context.Background(), bson.M{
		"_id": other, "name": "Living Word", "slug": "living-word",
		"plan": "pro", "isActive": true,
	})
	if err != nil {
		t.Fatalf("seed second church: %v", err)
	}
	otherCtx := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: other.Hex(), UserID: bson.NewObjectID().Hex(),
	})

	if _, err := h.svc.Claim(otherCtx, "gracechapel.org", baseDomain); !errors.Is(err, ErrHostnameTaken) {
		t.Fatalf("got %v, want ErrHostnameTaken", err)
	}
}

func TestAChurchIsBoundedInHowManyDomainsItClaims(t *testing.T) {
	h := newHarness(t, "pro")

	for i, hostname := range []string{
		"gracechapel.org", "www.gracechapel.org", "grace.church",
	} {
		if _, err := h.svc.Claim(h.ctx, hostname, baseDomain); err != nil {
			t.Fatalf("claim %d (%s): %v", i+1, hostname, err)
		}
	}
	if _, err := h.svc.Claim(h.ctx, "one-too-many.org", baseDomain); !errors.Is(err, ErrTooManyDomains) {
		t.Fatalf("got %v, want ErrTooManyDomains", err)
	}
}

// --- plan changes -------------------------------------------------------------

// The other half of Q-12: a church that stops paying stops being served, or
// the platform keeps renewing a certificate for a customer it no longer has.
func TestADomainIsSuspendedWhenThePlanLapses(t *testing.T) {
	h := newHarness(t, "pro")

	domain, _ := h.svc.Claim(h.ctx, "gracechapel.org", baseDomain)
	h.publish(domain)
	if _, err := h.svc.Verify(h.ctx, domain.ID.Hex()); err != nil {
		t.Fatalf("Verify: %v", err)
	}

	// Downgrade.
	if _, err := h.db.Global("churches").UpdateByID(h.ctx, h.churchID,
		bson.M{"$set": bson.M{"plan": "free"}}); err != nil {
		t.Fatalf("downgrade: %v", err)
	}

	suspended, err := h.svc.SuspendUnentitled(h.ctx)
	if err != nil {
		t.Fatalf("SuspendUnentitled: %v", err)
	}
	if suspended != 1 {
		t.Fatalf("suspended %d domains, want 1", suspended)
	}

	if _, err := h.svc.ChurchFor(h.ctx, "gracechapel.org"); !errors.Is(err, ErrNotFound) {
		t.Error("a suspended domain still resolves")
	}
	if h.svc.MayIssueCertificate(h.ctx, "gracechapel.org") {
		t.Error("a suspended domain still authorises certificate renewal — that " +
			"is a recurring cost for a customer who stopped paying")
	}
}

// Resubscribing must not mean proving ownership again. That distinction is the
// difference between an upgrade and a support ticket.
func TestRestoringDoesNotRequireProvingOwnershipAgain(t *testing.T) {
	h := newHarness(t, "pro")

	domain, _ := h.svc.Claim(h.ctx, "gracechapel.org", baseDomain)
	h.publish(domain)
	_, _ = h.svc.Verify(h.ctx, domain.ID.Hex())

	_, _ = h.db.Global("churches").UpdateByID(h.ctx, h.churchID,
		bson.M{"$set": bson.M{"plan": "free"}})
	if _, err := h.svc.SuspendUnentitled(h.ctx); err != nil {
		t.Fatalf("SuspendUnentitled: %v", err)
	}

	// Still suspended while unentitled.
	if _, err := h.svc.Restore(h.ctx, domain.ID.Hex()); !errors.Is(err, ErrNotEntitled) {
		t.Fatalf("Restore while free = %v, want ErrNotEntitled", err)
	}

	// Upgrade again.
	_, _ = h.db.Global("churches").UpdateByID(h.ctx, h.churchID,
		bson.M{"$set": bson.M{"plan": "pro"}})

	// The DNS record is deliberately REMOVED, to prove restoring does not
	// re-check it.
	h.dns.records = map[string][]string{}

	restored, err := h.svc.Restore(h.ctx, domain.ID.Hex())
	if err != nil {
		t.Fatalf("Restore: %v", err)
	}
	if restored.Status != StatusActive {
		t.Fatalf("status = %q, want active", restored.Status)
	}
}

// --- tenancy ------------------------------------------------------------------

func TestAChurchCannotSeeAnothersDomains(t *testing.T) {
	h := newHarness(t, "pro")
	domain, _ := h.svc.Claim(h.ctx, "gracechapel.org", baseDomain)

	other := bson.NewObjectID()
	otherCtx := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: other.Hex(), UserID: bson.NewObjectID().Hex(),
	})

	if _, err := h.svc.ByID(otherCtx, domain.ID.Hex()); !errors.Is(err, ErrNotFound) {
		t.Errorf("another church read the domain: %v", err)
	}
	if err := h.svc.Release(otherCtx, domain.ID.Hex()); !errors.Is(err, ErrNotFound) {
		t.Errorf("another church released the domain: %v", err)
	}
	list, err := h.svc.Domains(otherCtx)
	if err != nil {
		t.Fatalf("Domains: %v", err)
	}
	if len(list) != 0 {
		t.Errorf("another church sees %d domains, want 0", len(list))
	}
}

// --- entitlements -------------------------------------------------------------

// The CMS is deliberately NOT gated: a free church still gets its subdomain
// site. Asserted so that changing it is a deliberate edit to this test rather
// than a silent product change.
func TestTheCMSIsAvailableOnEveryPlan(t *testing.T) {
	for _, plan := range church.AllPlans {
		if !plan.Includes(church.FeatureCMS) {
			t.Errorf("plan %q does not include the CMS; if that is intended, this "+
				"test is the place to say so", plan)
		}
	}
}

func TestOnlyPaidPlansIncludeCustomDomains(t *testing.T) {
	if church.PlanFree.Includes(church.FeatureCustomDomain) {
		t.Error("the free plan includes custom domains; each one costs a " +
			"certificate (Q-12)")
	}
	for _, plan := range []church.Plan{church.PlanBasic, church.PlanPro, church.PlanEnterprise} {
		if !plan.Includes(church.FeatureCustomDomain) {
			t.Errorf("paid plan %q does not include custom domains", plan)
		}
	}
}
