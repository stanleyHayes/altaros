package service

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/church"
	"github.com/hayfordstanley/altar-os/internal/domain/customdomain"
	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/ratelimit"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// buildDomain mounts custom-domain management (WP-41).
func buildDomain(d *deps.Deps) http.Handler { return standalone(domainRoutes(d)) }

// domainRoutes registers custom-domain management and the TLS ask endpoint.
func domainRoutes(d *deps.Deps) routeSet {
	svc := customdomain.NewService(d.Mongo)

	return func(r chi.Router) {
		// The TLS ask endpoint. Called by the TLS terminator BEFORE it issues a
		// certificate for a hostname it has not seen, and it is what stops
		// anyone who points DNS at this platform from triggering issuance for a
		// name they do not own — which would burn the shared ACME budget (300
		// new orders per 3 hours) and stop every legitimate church onboarding.
		//
		// Unauthenticated by necessity: the caller is the TLS layer, before any
		// session exists. It leaks nothing a DNS lookup would not — the answer
		// is "is this name served here", for a name the caller already holds.
		r.With(throttle(d, ratelimit.PublicSite)).
			Get("/tls/allow", handleTLSAllow(svc))

		r.Group(func(r chi.Router) {
			r.Use(authenticated(d))
			r.Use(resolvePermissions(d))

			// Guarded by settings, the same authority as the CMS and the
			// church's own details: a custom domain is how the church is found.
			r.With(requirePermission(rbac.ResourceSettings, rbac.ActionRead)).
				Get("/domains", handleListDomains(svc, d))
			r.With(requirePermission(rbac.ResourceSettings, rbac.ActionCreate)).
				Post("/domains", handleClaimDomain(svc, d))

			r.Route("/domains/{id}", func(r chi.Router) {
				r.With(requirePermission(rbac.ResourceSettings, rbac.ActionRead)).
					Get("/", handleGetDomain(svc, d))
				// Verification is rate-limited on its own: it makes a DNS query
				// per call, and a church clicking "check again" impatiently
				// should not turn into a lookup storm against a registrar.
				r.With(
					requirePermission(rbac.ResourceSettings, rbac.ActionUpdate),
					throttle(d, ratelimit.VerifyDomain),
				).Post("/verify", handleVerifyDomain(svc, d))
				r.With(requirePermission(rbac.ResourceSettings, rbac.ActionUpdate)).
					Post("/restore", handleRestoreDomain(svc, d))
				r.With(requirePermission(rbac.ResourceSettings, rbac.ActionDelete)).
					Delete("/", handleReleaseDomain(svc))
			})
		})
	}
}

// handleTLSAllow answers whether a certificate may be issued for a hostname.
//
// The contract is deliberately minimal because that is what on-demand TLS
// expects: 200 means yes, anything else means no. Caddy's `ask` treats a
// non-2xx as a refusal, so a bug that makes this error out fails CLOSED — no
// certificate — rather than issuing for everything.
func handleTLSAllow(svc *customdomain.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// `domain` is the parameter name Caddy sends.
		hostname := r.URL.Query().Get("domain")
		if hostname == "" {
			hostname = r.URL.Query().Get("host")
		}
		if hostname == "" {
			http.Error(w, "no domain", http.StatusBadRequest)
			return
		}

		if !svc.MayIssueCertificate(r.Context(), hostname) {
			// 403 rather than 404: the name exists as a question, and the
			// answer is that we will not issue for it.
			http.Error(w, "not authorised for this domain", http.StatusForbidden)
			return
		}
		w.WriteHeader(http.StatusOK)
	}
}

// --- church-facing -----------------------------------------------------------

// domainView is a domain plus everything the church has to DO about it.
//
// The DNS records are computed rather than stored, and returned with every
// read: the single most common support question about a custom domain is "what
// exactly do I put in my registrar", and an answer that requires a second call
// is an answer somebody will get wrong.
type domainView struct {
	*customdomain.Domain
	Verification customdomain.VerificationRecord `json:"verification"`
	Pointing     customdomain.PointingRecord     `json:"pointing"`
	NextStep     string                          `json:"nextStep"`
}

func viewOf(domain *customdomain.Domain, churchSlug, baseDomain string) domainView {
	view := domainView{
		Domain:       domain,
		Verification: domain.Record(),
		Pointing:     customdomain.Pointing(domain.Hostname, churchSlug, baseDomain),
	}
	switch domain.Status {
	case customdomain.StatusPending:
		view.NextStep = "Add the verification record below to your domain provider, " +
			"then choose Verify. It can take a few minutes to take effect."
	case customdomain.StatusActive:
		view.NextStep = "This domain is live. If it does not load yet, check that " +
			"the CNAME record below is in place."
	case customdomain.StatusSuspended:
		view.NextStep = "This domain is paused because your plan no longer includes " +
			"custom domains. It will work again as soon as you upgrade — you will " +
			"not need to verify it a second time."
	default:
		view.NextStep = "Point your domain here with the CNAME record below."
	}
	return view
}

// churchContext reads the caller's church for slug and base domain.
func churchContext(r *http.Request, d *deps.Deps) (slug, base string) {
	base = ""
	if d.Config != nil {
		base = d.Config.PublicBaseDomain
	}
	scope, err := tenancy.FromContext(r.Context())
	if err != nil {
		return "", base
	}
	found, err := church.NewService(d.Mongo).ByID(r.Context(), scope.ChurchID)
	if err != nil {
		return "", base
	}
	return found.Slug, base
}

func handleListDomains(svc *customdomain.Service, d *deps.Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		domains, err := svc.Domains(r.Context())
		if err != nil {
			writeDomainError(w, err)
			return
		}
		slug, base := churchContext(r, d)

		out := make([]domainView, 0, len(domains))
		for i := range domains {
			out = append(out, viewOf(&domains[i], slug, base))
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"domains": out,
			"limit":   3,
		})
	}
}

func handleClaimDomain(svc *customdomain.Service, d *deps.Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Hostname string `json:"hostname"`
			Domain   string `json:"domain"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		hostname := body.Hostname
		if hostname == "" {
			hostname = body.Domain
		}

		base := ""
		if d.Config != nil {
			base = d.Config.PublicBaseDomain
		}
		domain, err := svc.Claim(r.Context(), hostname, base)
		if err != nil {
			writeDomainError(w, err)
			return
		}
		slug, _ := churchContext(r, d)
		httpx.JSON(w, http.StatusCreated, viewOf(domain, slug, base))
	}
}

func handleGetDomain(svc *customdomain.Service, d *deps.Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		domain, err := svc.ByID(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			writeDomainError(w, err)
			return
		}
		slug, base := churchContext(r, d)
		httpx.JSON(w, http.StatusOK, viewOf(domain, slug, base))
	}
}

func handleVerifyDomain(svc *customdomain.Service, d *deps.Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		domain, err := svc.Verify(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			writeDomainError(w, err)
			return
		}
		slug, base := churchContext(r, d)
		httpx.JSON(w, http.StatusOK, map[string]any{
			"domain": viewOf(domain, slug, base),
			"note": "Verified. Your website is now available at this address — " +
				"a certificate is issued the first time somebody visits.",
		})
	}
}

func handleRestoreDomain(svc *customdomain.Service, d *deps.Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		domain, err := svc.Restore(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			writeDomainError(w, err)
			return
		}
		slug, base := churchContext(r, d)
		httpx.JSON(w, http.StatusOK, viewOf(domain, slug, base))
	}
}

func handleReleaseDomain(svc *customdomain.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := svc.Release(r.Context(), chi.URLParam(r, "id")); err != nil {
			writeDomainError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"released": true})
	}
}

func writeDomainError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, customdomain.ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "That domain is not set up here.")

	case errors.Is(err, customdomain.ErrNotEntitled):
		// 402, not 403. The church may do this — they have the permission —
		// they simply are not on a plan that includes it, and a payment-shaped
		// answer is what tells the UI to offer an upgrade rather than an error.
		httpx.Error(w, http.StatusPaymentRequired,
			"Using your own domain is part of a paid plan. Upgrade and you can "+
				"add it straight away.")

	case errors.Is(err, customdomain.ErrHostnameTaken):
		// Deliberately does not say which church holds it.
		httpx.Error(w, http.StatusConflict,
			"That domain is already set up on ALTAR OS. If it is yours, contact "+
				"support and we will move it.")

	case errors.Is(err, customdomain.ErrHostnameReserved):
		httpx.Error(w, http.StatusBadRequest,
			"That domain cannot be used. Your church already has an address on "+
				"ours — this is for a domain you own yourself.")

	case errors.Is(err, customdomain.ErrHostnameInvalid):
		httpx.Error(w, http.StatusBadRequest, err.Error())

	case errors.Is(err, customdomain.ErrTooManyDomains):
		httpx.Error(w, http.StatusConflict,
			"You already have the maximum number of domains. Remove one first.")

	case errors.Is(err, customdomain.ErrVerificationFailed):
		httpx.Error(w, http.StatusConflict,
			"We could not find the verification record yet. DNS changes can take "+
				"a few minutes — check the record matches exactly, then try again.")

	case errors.Is(err, customdomain.ErrNotVerified):
		httpx.Error(w, http.StatusConflict,
			"This domain has not been verified yet.")

	case errors.Is(err, church.ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "Church not found")

	case errors.Is(err, tenancy.ErrNoTenant):
		httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")

	default:
		httpx.Error(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
	}
}
