package service

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/plan"
	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// The church's subscription to ALTAR OS.
//
// This is the SECOND money flow, and it is not the one the rest of finance
// handles. Giving is a member paying their church, where we are a processor
// taking a percentage and never holding the funds (ADR-002). A subscription is
// a church paying US, where we are the merchant and the church is our customer.
// ADR-009 keeps them apart, and the rule that matters most is the one that
// looks like a convenience: the subscription is never netted out of giving
// proceeds. Church money passing through our hands to settle our own invoice is
// exactly the custody Act 987 is about, and it would also mean a church's
// tithes silently paying a software bill.

func buildPlan(d *deps.Deps) http.Handler { return standalone(planRoutes(d)) }

// planRoutes registers the subscription.
func planRoutes(d *deps.Deps) routeSet {
	svc := plan.NewService(d.Mongo)

	return func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(authenticated(d))
			r.Use(resolvePermissions(d))

			// Reading the plan is a SETTINGS read, not a finance one: what a
			// church may do is an operational fact its staff need, and tying
			// it to the books would hide the streaming cap from the people
			// who run the services.
			r.With(requirePermission(rbac.ResourceSettings, rbac.ActionRead)).
				Get("/plan", handleGetPlan(svc))
			r.With(requirePermission(rbac.ResourceSettings, rbac.ActionRead)).
				Get("/plan/tiers", handleListTiers())

			// Changing the plan is a settings UPDATE — committing the church
			// to a monthly bill and to a different commission rate.
			r.With(requirePermission(rbac.ResourceSettings, rbac.ActionUpdate)).
				Post("/plan", handleSetPlan(svc))
		})
	}
}

// tierView is a tier as a church shopping for one sees it.
type tierView struct {
	Tier                  string `json:"tier"`
	Name                  string `json:"name"`
	MonthlyMinor          int64  `json:"monthlyMinor"`
	Currency              string `json:"currency"`
	Streaming             bool   `json:"streaming"`
	MaxConcurrentViewers  int    `json:"maxConcurrentViewers"`
	CommissionBasisPoints int64  `json:"commissionBasisPoints"`
}

func viewTier(e plan.Entitlement) tierView {
	return tierView{
		Tier: string(e.Tier), Name: e.Name,
		MonthlyMinor: e.MonthlyMinor, Currency: e.Currency,
		Streaming: e.Streaming, MaxConcurrentViewers: e.MaxConcurrentViewers,
		CommissionBasisPoints: e.CommissionBasisPoints,
	}
}

// handleListTiers is the price list.
func handleListTiers() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		out := make([]tierView, 0, len(plan.Catalogue))
		for _, e := range plan.Catalogue {
			out = append(out, viewTier(e))
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"tiers": out})
	}
}

// handleGetPlan returns what this church is on and what it may therefore do.
//
// The ENTITLEMENT is returned beside the subscription rather than leaving the
// client to derive it from the tier, because the two disagree on purpose when a
// church is suspended for non-payment: the tier still says Growth, and the
// entitlement says streaming is off. A client computing features from the tier
// name would show a church a Go Live button that the server refuses.
func handleGetPlan(svc *plan.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sub, err := svc.Current(r.Context())
		if err != nil {
			writePlanError(w, err)
			return
		}
		ent, err := svc.For(r.Context())
		if err != nil {
			writePlanError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"subscription": sub,
			"entitlement":  viewTier(ent),
			// What the tier WOULD grant if it were paid, so a suspended
			// church can be told what it is missing rather than shown a
			// stripped plan with no explanation.
			"tierGrants": viewTier(plan.EntitlementFor(sub.Tier)),
		})
	}
}

// handleSetPlan moves the church to another tier.
//
// Refused for the mobile apps, deliberately, and this is the enforcement rather
// than a note in a document. App Store Guideline 3.1.1 requires digital
// subscriptions sold inside an iOS app to go through Apple's in-app purchase
// and Apple's 30%; 3.1.3 forbids the app from even pointing at the web price.
// Donations are exempt — that is why giving and one-tap stay in the app — but a
// software subscription is not, and an app that sells one outside IAP is
// removed, not warned.
//
// The header check stops OUR apps, which is the actual risk: a rejected build
// costs a release cycle. It is not a security control and cannot be — a
// determined caller omits the header. But the people this needs to stop are us,
// shipping a tier screen into the mobile bundle by accident, and for that it
// works.
func handleSetPlan(svc *plan.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if isMobileClient(r) {
			httpx.Error(w, http.StatusForbidden,
				"Plans are managed on the web dashboard.")
			return
		}
		var body struct {
			Tier string `json:"tier"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		scope, _ := tenancy.FromContext(r.Context())
		sub, err := svc.SetTier(r.Context(), plan.Tier(body.Tier), scope.UserID)
		if err != nil {
			writePlanError(w, err)
			return
		}
		ent, err := svc.For(r.Context())
		if err != nil {
			writePlanError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"subscription": sub, "entitlement": viewTier(ent),
		})
	}
}

// isMobileClient reports whether the request came from one of our apps.
//
// The mobile client sets X-Altar-Client on every request. Absence means web or
// an unknown caller, and is treated as web — the header exists to identify our
// own app, not to authenticate anybody.
func isMobileClient(r *http.Request) bool {
	c := strings.ToLower(strings.TrimSpace(r.Header.Get("X-Altar-Client")))
	return c == "ios" || c == "android" || c == "mobile"
}

func writePlanError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, plan.ErrTierUnknown):
		httpx.Error(w, http.StatusBadRequest, "That plan is not one we offer.")
	case errors.Is(err, plan.ErrNotEntitled):
		// 402 rather than 403: nothing is wrong with who they are, and the
		// fix is a plan change rather than a permission.
		httpx.Error(w, http.StatusPaymentRequired, "Your plan does not include that.")
	default:
		httpx.Error(w, http.StatusInternalServerError, "Something went wrong.")
	}
}
