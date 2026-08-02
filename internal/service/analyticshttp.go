package service

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/analytics"
	"github.com/hayfordstanley/altar-os/internal/domain/church"
	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// buildAnalytics mounts the reporting endpoints (WP-25).
func buildAnalytics(d *deps.Deps) http.Handler { return standalone(analyticsRoutes(d)) }

// analyticsRoutes registers reports.
//
// Guarded by `report` permissions rather than by the permission of whatever the
// report is ABOUT, and that distinction is deliberate. A giving trend is a
// finance question, an attendance trend is an event question, and engagement is
// both — so guarding each by its subject would mean the dashboard's summary
// page needed three permissions and would half-render for anyone holding two.
//
// `report:read` is a single, grantable answer to "may this person see summary
// figures about the church". It deliberately does NOT imply the underlying
// detail: holding it shows a total, not the list of who gave what.
func analyticsRoutes(d *deps.Deps) routeSet {
	svc := analytics.NewService(d.Mongo)
	churches := church.NewService(d.Mongo)

	return func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(authenticated(d))
			r.Use(resolvePermissions(d))

			r.With(requirePermission(rbac.ResourceReport, rbac.ActionRead)).
				Get("/analytics/giving", handleGivingTrend(svc))
			r.With(requirePermission(rbac.ResourceReport, rbac.ActionRead)).
				Get("/analytics/attendance", handleAttendanceTrend(svc))
			r.With(requirePermission(rbac.ResourceReport, rbac.ActionRead)).
				Get("/analytics/engagement", handleEngagement(svc))

			// Cross-branch consolidation, and the ONLY endpoint that crosses a
			// tenant boundary for a church-side caller. It is a separate path
			// rather than a `?scope=` flag on the others because that is what
			// Q-14 concluded: the tenant wrapper must not quietly widen, so
			// crossing branches has to be a call somebody made on purpose.
			//
			// requireRole, not requirePermission, for the reason WP-11 gives:
			// this is about organisational REACH, and `resource:action` cannot
			// express it. The nearest permission, report:read, is held by every
			// branch administrator.
			r.With(requireRole(RoleOrgAdmin)).
				Get("/analytics/consolidated", handleConsolidated(svc, churches))
		})
	}
}

// rangeFrom reads the window from the query string.
//
// A malformed date WIDENS to the default rather than failing, matching the
// existing behaviour of the finance report filters: somebody typing in a date
// box should get a report, not a 400.
func rangeFrom(r *http.Request) analytics.Range {
	out := analytics.Range{Grain: analytics.Grain(r.URL.Query().Get("grain"))}
	if raw := r.URL.Query().Get("from"); raw != "" {
		if parsed, err := time.Parse(time.RFC3339, raw); err == nil {
			out.From = parsed
		}
	}
	if raw := r.URL.Query().Get("to"); raw != "" {
		if parsed, err := time.Parse(time.RFC3339, raw); err == nil {
			out.To = parsed
		}
	}
	return out
}

func handleGivingTrend(svc *analytics.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		trend, err := svc.GivingTrend(r.Context(), rangeFrom(r))
		if err != nil {
			writeAnalyticsError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, trend)
	}
}

func handleAttendanceTrend(svc *analytics.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		trend, err := svc.AttendanceTrend(r.Context(), rangeFrom(r))
		if err != nil {
			writeAnalyticsError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, trend)
	}
}

func handleEngagement(svc *analytics.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		days, _ := strconv.Atoi(r.URL.Query().Get("days"))
		out, err := svc.EngagementFor(r.Context(), days)
		if err != nil {
			writeAnalyticsError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, out)
	}
}

func handleConsolidated(svc *analytics.Service, churches *church.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		out, err := svc.ConsolidatedGiving(r.Context(), churches, rangeFrom(r))
		if err != nil {
			writeAnalyticsError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, out)
	}
}

func writeAnalyticsError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, analytics.ErrRangeInvalid):
		httpx.Error(w, http.StatusBadRequest, "The end of the range has to be after the start.")
	case errors.Is(err, analytics.ErrRangeTooWide):
		httpx.Error(w, http.StatusBadRequest,
			"That is more history than one report can cover. Narrow it to three years or less.")
	case errors.Is(err, analytics.ErrScopeForbidden):
		// 403 rather than an empty consolidation. A denomination of one branch
		// asking for a consolidated view has asked for something that does not
		// exist, and answering with their own figures dressed as a
		// consolidation is the version that misleads.
		httpx.Error(w, http.StatusForbidden,
			"There is only one church here, so there is nothing to consolidate.")
	case errors.Is(err, tenancy.ErrNoTenant):
		httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
	default:
		httpx.Error(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
	}
}
