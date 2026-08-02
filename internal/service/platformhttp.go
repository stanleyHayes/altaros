package service

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/church"
	"github.com/hayfordstanley/altar-os/internal/domain/platformsetting"
	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/money"
	"github.com/hayfordstanley/altar-os/internal/platform/payments/paystack"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// buildPlatform mounts the platform operator's own settings (Q-7).
func buildPlatform(d *deps.Deps) http.Handler { return standalone(platformRoutes(d)) }

// platformRoutes registers the platform dashboard's settings endpoints and the
// church-level giving flag.
//
// Two audiences with two different authorities, and keeping them in one file
// makes the boundary between them visible:
//
//   - The PLATFORM operator sets the commission rate and the provider's rate
//     card. Guarded by requirePlatformAdmin, which is a role check rather than
//     a permission — a church cannot be granted the ability to set the rate it
//     is charged, however its roles are configured, so there is no permission
//     that should ever grant this.
//   - A CHURCH sets who bears the payment fee for its own congregation.
//     Guarded by settings permissions, like everything else a church decides
//     about itself.
func platformRoutes(d *deps.Deps) routeSet {
	settings := platformsetting.NewService(d.Mongo)
	churches := church.NewService(d.Mongo)
	baseDomain := ""
	if d.Config != nil {
		baseDomain = d.Config.PublicBaseDomain
	}

	return func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(authenticated(d))
			r.Use(resolvePermissions(d))

			// --- the platform operator ---
			//
			// /admin/stats rather than /platform/stats, because that is the
			// path the admin app already calls. It was falling through to the
			// legacy TypeScript proxy and answering 502, so the operator
			// dashboard showed zeros for everything.
			r.With(requirePlatformAdmin()).
				Get("/admin/stats", handlePlatformStats(settings, d))
			r.With(requirePlatformAdmin()).
				Get("/admin/churches", handleAdminChurches(settings, d))
			r.With(requirePlatformAdmin()).
				Patch("/admin/churches/{id}/status", handleAdminChurchStatus(settings, d))
			r.With(requirePlatformAdmin()).
				Get("/admin/users", handleAdminUsers(settings, d))
			r.With(requirePlatformAdmin()).
				Get("/admin/health", handleAdminHealth(settings, d))
			r.With(requirePlatformAdmin()).
				Get("/admin/operations", handleAdminOperations(settings, d))
			r.With(requirePlatformAdmin()).
				Get("/admin/audit", handleAdminAudit(settings, d))

			r.With(requirePlatformAdmin()).
				Get("/platform/settings", handleGetPlatformSettings(settings))
			r.With(requirePlatformAdmin()).
				Put("/platform/settings", handleSetPlatformSettings(settings))

			// The backfill is a SEPARATE call from saving the rate, not a side
			// effect of it. Saving is one database write; this is one external
			// API call per church, and folding it into the save would make a
			// settings form time out on a platform with any real number of
			// churches — and leave the operator unable to tell whether the rate
			// saved, the backfill ran, or neither.
			r.With(requirePlatformAdmin()).
				Post("/platform/settings/backfill-commission", handleBackfillCommission(settings, d))

			// --- the church admin portal ---
			r.With(requirePermission(rbac.ResourceSettings, rbac.ActionRead)).
				Get("/church/giving-settings", handleGetGivingSettings(churches, settings))
			r.With(requirePermission(rbac.ResourceSettings, rbac.ActionUpdate)).
				Put("/church/giving-settings", handleSetGivingSettings(churches, settings))

			r.With(requirePermission(rbac.ResourceSettings, rbac.ActionRead)).
				Get("/church/registration-settings", handleGetRegistrationSettings(churches, baseDomain))
			r.With(requirePermission(rbac.ResourceSettings, rbac.ActionUpdate)).
				Put("/church/registration-settings", handleSetRegistrationSettings(churches, baseDomain))
		})
	}
}

// requirePlatformAdmin refuses anyone who is not a platform operator.
//
// 404 rather than 403, matching requirePermission: a church admin poking at
// /platform/settings learns that the path exists and that they are not allowed
// there, which is more than they need. The endpoint simply is not there for
// them.
func requirePlatformAdmin() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !isPlatformAdmin(r) {
				httpx.Error(w, http.StatusNotFound, "Not found")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// --- the platform operator ----------------------------------------------------

func handlePlatformStats(svc *platformsetting.Service, d *deps.Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		stats, err := svc.StatsFor(r.Context(), d.Mongo)
		if err != nil {
			writePlatformError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, stats)
	}
}

// handleBackfillCommission writes the current commission onto every church's
// provider subaccount.
//
// Defaults to a DRY RUN. This writes a money-splitting parameter across every
// church on the platform, and an operator should be able to read the list
// before it happens — `?apply=true` is the deliberate second step.
func handleBackfillCommission(svc *platformsetting.Service, d *deps.Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		gateway := paystack.New(paystack.Config{
			SecretKey:                    d.Config.Paystack.SecretKey,
			WebhookSecret:                d.Config.Paystack.WebhookSecret,
			DefaultCommissionBasisPoints: platformsetting.DefaultCommissionBasisPoints,
		})

		apply := r.URL.Query().Get("apply") == "true"
		report, err := svc.BackfillCommission(r.Context(), d.Mongo, gateway, !apply)
		if err != nil {
			writePlatformError(w, err)
			return
		}

		// 200 even when some churches failed. The operation partially succeeded
		// and the report says exactly which — an error status would throw away
		// the record of the ones that worked, and the whole point of the report
		// is being able to finish the job.
		httpx.JSON(w, http.StatusOK, report)
	}
}

// startedAt is when this process came up, for the uptime the health page shows.
var startedAt = time.Now()

// adminPageParams reads page and limit. Named for this file rather than
// generically, because spiritualhttp.go already owns `pageParams`.
func adminPageParams(r *http.Request) (int, int) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	return page, limit
}

func handleAdminChurches(svc *platformsetting.Service, d *deps.Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		page, limit := adminPageParams(r)
		out, err := svc.Churches(r.Context(), d.Mongo, page, limit)
		if err != nil {
			writePlatformError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, out)
	}
}

func handleAdminChurchStatus(svc *platformsetting.Service, d *deps.Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			// A pointer, so an omitted field is not read as "deactivate". This
			// endpoint can take a church offline platform-wide; a malformed
			// body must not be able to do that by accident.
			IsActive *bool `json:"isActive"`
		}
		if err := decode(r, &body); err != nil || body.IsActive == nil {
			httpx.Error(w, http.StatusBadRequest, "Say whether the church should be active.")
			return
		}
		if err := svc.SetChurchActive(r.Context(), d.Mongo,
			chi.URLParam(r, "id"), *body.IsActive); err != nil {
			writePlatformError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"isActive": *body.IsActive})
	}
}

func handleAdminUsers(svc *platformsetting.Service, d *deps.Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		page, limit := adminPageParams(r)
		out, err := svc.Users(r.Context(), d.Mongo, page, limit,
			r.URL.Query().Get("role"), r.URL.Query().Get("search"))
		if err != nil {
			writePlatformError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, out)
	}
}

func handleAdminHealth(svc *platformsetting.Service, d *deps.Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		httpx.JSON(w, http.StatusOK, svc.HealthOf(r.Context(), d.Mongo, startedAt))
	}
}

func handleAdminOperations(svc *platformsetting.Service, d *deps.Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		out, err := svc.Operations(r.Context(), d.Mongo)
		if err != nil {
			writePlatformError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, out)
	}
}

func handleAdminAudit(svc *platformsetting.Service, d *deps.Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		page, limit := adminPageParams(r)
		out, err := svc.Audit(r.Context(), d.Mongo, page, limit)
		if err != nil {
			writePlatformError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, out)
	}
}

func handleGetPlatformSettings(svc *platformsetting.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		current, err := svc.Current(r.Context())
		if err != nil {
			writePlatformError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"settings": current,
			// Said in the response rather than left for the UI to remember,
			// because getting it wrong is a settlement dispute months later.
			// Corrected 2 Aug 2026 after measuring it. This said the opposite,
			// which is the intuitive reading and is wrong — see the note on
			// platformsetting's package comment.
			"note": "Changing this applies to every church immediately: the rate " +
				"is sent with each transaction, so the next gift taken anywhere " +
				"on the platform uses it. The figure stored with the payment " +
				"provider is separate and only governs payment links or " +
				"recurring plans created in the provider's own dashboard — use " +
				"the commission backfill to bring those into line.",
			"maxCommissionBasisPoints": platformsetting.MaxCommissionBasisPoints,
		})
	}
}

func handleSetPlatformSettings(svc *platformsetting.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			// Pointers, so "not sent" and "set to zero" are different. A
			// launch partner on 0% commission is a real configuration.
			CommissionBasisPoints *int64  `json:"commissionBasisPoints"`
			DefaultFeeBearer      *string `json:"defaultFeeBearer"`
			ProviderFees          map[string]struct {
				BasisPoints     int64 `json:"basisPoints"`
				FlatMinor       int64 `json:"flatMinor"`
				CapMinor        int64 `json:"capMinor"`
				WaiveBelowMinor int64 `json:"waiveBelowMinor"`
			} `json:"providerFees"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}

		update := platformsetting.Update{
			CommissionBasisPoints: body.CommissionBasisPoints,
			DefaultFeeBearer:      body.DefaultFeeBearer,
			ActorID:               callerUserID(r),
		}
		if body.ProviderFees != nil {
			update.ProviderFees = make(map[string]money.FeeSchedule, len(body.ProviderFees))
			for channel, schedule := range body.ProviderFees {
				update.ProviderFees[channel] = money.FeeSchedule{
					BasisPoints:     schedule.BasisPoints,
					FlatMinor:       schedule.FlatMinor,
					CapMinor:        schedule.CapMinor,
					WaiveBelowMinor: schedule.WaiveBelowMinor,
				}
			}
		}

		saved, err := svc.Save(r.Context(), update)
		if err != nil {
			writePlatformError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"settings": saved})
	}
}

// --- the church admin portal ---------------------------------------------------

// givingSettingsView is what a church sees about its own giving configuration.
//
// It carries the RESOLVED bearer as well as the church's own choice, because
// "not set" and "set to giver" look identical to a toggle and mean different
// things: one follows the platform if the platform changes, the other does not.
type givingSettingsView struct {
	// FeeBearer is this church's explicit choice. Empty means it follows the
	// platform default.
	FeeBearer string `json:"feeBearer,omitempty"`
	// Effective is what actually applies today.
	Effective money.FeeBearer `json:"effectiveFeeBearer"`
	// PlatformDefault is what applies when the church makes no choice.
	PlatformDefault money.FeeBearer `json:"platformDefaultFeeBearer"`
	// Explanation is the sentence to show beside the toggle.
	Explanation string `json:"explanation"`
	// Example prices a representative gift both ways, so the person choosing
	// sees the consequence rather than a label.
	Example map[string]any `json:"example"`
}

func givingSettingsFor(ch *church.Church, current *platformsetting.Settings) givingSettingsView {
	effective := current.DefaultFeeBearer
	if ch.FeeBearer != "" {
		effective = money.NormaliseFeeBearer(ch.FeeBearer)
	}

	currency := ch.Currency
	if currency == "" {
		currency = "GHS"
	}
	// A hundred of whatever the church settles in — a round number somebody
	// can check against their own arithmetic.
	sample := money.Amount{Minor: 10000, Currency: currency}
	schedule := current.FeeFor(money.ChannelMobileMoney)

	view := givingSettingsView{
		FeeBearer:       ch.FeeBearer,
		Effective:       effective,
		PlatformDefault: current.DefaultFeeBearer,
		Example: map[string]any{
			"ifGiverPays":  money.QuoteFee(sample, schedule, money.BearerGiver),
			"ifChurchPays": money.QuoteFee(sample, schedule, money.BearerChurch),
		},
	}

	if effective == money.BearerGiver {
		view.Explanation = "Givers pay the payment charge on top of their gift, " +
			"so your church receives the full amount. They see the charge before " +
			"they confirm."
	} else {
		view.Explanation = "Your church covers the payment charge, so givers pay " +
			"exactly the amount they choose and your settlement is reduced by the " +
			"charge."
	}
	if schedule.IsZero() {
		view.Explanation += " No payment charge is configured yet, so this makes " +
			"no difference to what givers pay today."
	}
	return view
}

func handleGetGivingSettings(churches *church.Service, settings *platformsetting.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, err := callerScope(r)
		if err != nil {
			httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
			return
		}
		ch, err := churches.ByID(r.Context(), scope.ChurchID)
		if err != nil {
			writePlatformError(w, err)
			return
		}
		current, err := settings.Current(r.Context())
		if err != nil {
			writePlatformError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, givingSettingsFor(ch, current))
	}
}

func handleSetGivingSettings(churches *church.Service, settings *platformsetting.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			// A pointer so an omitted field leaves the setting alone, and an
			// explicit "" clears it back to following the platform.
			FeeBearer *string `json:"feeBearer"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		scope, err := callerScope(r)
		if err != nil {
			httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
			return
		}

		updated, err := churches.SetGivingSettings(r.Context(), scope.ChurchID,
			church.GivingSettings{FeeBearer: body.FeeBearer})
		if err != nil {
			writePlatformError(w, err)
			return
		}
		current, err := settings.Current(r.Context())
		if err != nil {
			writePlatformError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, givingSettingsFor(updated, current))
	}
}

// registrationSettingsView is what a church sees about who may join it.
//
// It states the RISK alongside the setting rather than leaving it to
// documentation, because the person deciding is a church administrator and the
// question — "should anyone be able to make an account here?" — has a
// non-obvious answer that depends on what an account actually grants.
type registrationSettingsView struct {
	SelfSignupEnabled bool   `json:"selfSignupEnabled"`
	Explanation       string `json:"explanation"`
	// JoinURL is where a self-registering member goes. Returned because the
	// first thing a church asks after turning this on is where to send people.
	JoinURL string `json:"joinUrl,omitempty"`
}

func registrationSettingsFor(ch *church.Church, baseDomain string) registrationSettingsView {
	view := registrationSettingsView{SelfSignupEnabled: ch.SelfSignupOpen()}

	if view.SelfSignupEnabled {
		view.Explanation = "Anyone with your church's address can create an " +
			"account. New accounts can see your events and prayer wall — nothing " +
			"about members, giving or settings — and must confirm their phone " +
			"number before they can sign in. Turn this off to add people by " +
			"invitation only."
		if baseDomain != "" && ch.Slug != "" {
			view.JoinURL = "https://" + ch.Slug + "." + baseDomain + "/register"
		}
	} else {
		view.Explanation = "Only people you invite can create an account. " +
			"Anyone else trying to register is told to ask your office for an " +
			"invitation."
	}
	return view
}

func handleGetRegistrationSettings(churches *church.Service, baseDomain string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, err := callerScope(r)
		if err != nil {
			httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
			return
		}
		ch, err := churches.ByID(r.Context(), scope.ChurchID)
		if err != nil {
			writePlatformError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, registrationSettingsFor(ch, baseDomain))
	}
}

func handleSetRegistrationSettings(churches *church.Service, baseDomain string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			// A pointer so an omitted field leaves the setting alone rather
			// than silently closing registration.
			SelfSignupEnabled *bool `json:"selfSignupEnabled"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		scope, err := callerScope(r)
		if err != nil {
			httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
			return
		}

		updated, err := churches.SetRegistrationSettings(r.Context(), scope.ChurchID,
			church.RegistrationSettings{SelfSignupEnabled: body.SelfSignupEnabled})
		if err != nil {
			writePlatformError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, registrationSettingsFor(updated, baseDomain))
	}
}

func writePlatformError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, platformsetting.ErrChurchNotFound):
		httpx.Error(w, http.StatusNotFound, "That church does not exist.")
	case errors.Is(err, platformsetting.ErrInvalidRate):
		httpx.Error(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, platformsetting.ErrInvalidFee):
		httpx.Error(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, church.ErrInvalidInput):
		httpx.Error(w, http.StatusBadRequest,
			"Choose whether the giver or the church covers the payment charge.")
	case errors.Is(err, church.ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "Church not found")
	case errors.Is(err, church.ErrForbidden):
		httpx.Error(w, http.StatusForbidden, "You do not have permission to do that.")
	case errors.Is(err, tenancy.ErrNoTenant):
		httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
	default:
		httpx.Error(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
	}
}
