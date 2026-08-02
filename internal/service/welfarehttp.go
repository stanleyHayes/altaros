package service

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/domain/welfare"
	"github.com/hayfordstanley/altar-os/internal/platform/audit"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/fieldcrypt"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// buildWelfare mounts pastoral care (WP-27).
func buildWelfare(d *deps.Deps) http.Handler { return standalone(welfareRoutes(d)) }

func newWelfareService(d *deps.Deps) *welfare.Service {
	// A nil cipher when no key is set. The service then REFUSES every write
	// rather than storing plaintext — see welfare.NewService.
	var crypto *fieldcrypt.Cipher
	if d.Config != nil && d.Config.WelfareKey != "" {
		if c, err := fieldcrypt.New(d.Config.WelfareKey); err == nil {
			crypto = c
		}
	}
	return welfare.NewService(d.Mongo, crypto, audit.NewLogger(d.Mongo))
}

// welfareRoutes registers pastoral care.
//
// Guarded by `welfare` permissions, which NO blanket role holds — the
// Administrator role is `AllExceptPastoral()`. That is what makes WP-27's
// acceptance criterion achievable at all: "a church admin without the welfare
// role cannot read case details via any endpoint."
//
// Every refusal is AUDITED before the response is written. That ordering is the
// point: the entry has to exist whether or not anybody is watching the
// response, and a church's answer to "did somebody go looking" is only as good
// as its record of the people who tried and could not.
func welfareRoutes(d *deps.Deps) routeSet {
	svc := newWelfareService(d)

	return func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(authenticated(d))
			r.Use(resolvePermissions(d))
			// Applies to every route below, including the ones that already
			// carry a requirePermission — belt and braces on the one resource
			// where a missing guard is a safeguarding disclosure.
			r.Use(auditWelfareDenials(svc))

			r.With(requirePermission(rbac.ResourceWelfare, rbac.ActionRead)).
				Get("/welfare/cases", handleWelfareQueue(svc))
			r.With(requirePermission(rbac.ResourceWelfare, rbac.ActionRead)).
				Get("/welfare/cases/{id}", handleWelfareCase(svc))

			r.With(requirePermission(rbac.ResourceWelfare, rbac.ActionCreate)).
				Post("/welfare/cases", handleOpenCase(svc))
			r.With(requirePermission(rbac.ResourceWelfare, rbac.ActionUpdate)).
				Post("/welfare/cases/{id}/notes", handleAddCaseNote(svc))
			r.With(requirePermission(rbac.ResourceWelfare, rbac.ActionUpdate)).
				Patch("/welfare/cases/{id}/status", handleSetCaseStatus(svc))
			r.With(requirePermission(rbac.ResourceWelfare, rbac.ActionUpdate)).
				Patch("/welfare/cases/{id}/assign", handleAssignCase(svc))
		})
	}
}

// auditWelfareDenials records anybody who reaches a welfare route without the
// permission.
//
// It sits ABOVE requirePermission rather than inside it, because
// requirePermission is shared by every domain and welfare is the only one where
// a refusal is itself a fact a church needs recorded. Checking here means the
// entry is written even if a route below is ever added without a guard.
func auditWelfareDenials(svc *welfare.Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if Can(r, rbac.ResourceWelfare, rbac.ActionRead) || isPlatformAdmin(r) {
				next.ServeHTTP(w, r)
				return
			}
			svc.Denied(r.Context(), chi.URLParam(r, "id"),
				"no welfare permission: "+r.Method+" "+r.URL.Path)

			// 404, not 403. A distinct "forbidden" confirms that a case exists
			// for a named person, which is most of what somebody fishing wants
			// to learn — and the person fishing here may be the one the case
			// is about being protected from.
			httpx.Error(w, http.StatusNotFound, "Not found")
		})
	}
}

func handleWelfareQueue(svc *welfare.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cases, err := svc.Queue(r.Context(),
			welfare.Status(r.URL.Query().Get("status")),
			r.URL.Query().Get("open") != "false")
		if err != nil {
			writeWelfareError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"cases":      cases,
			"categories": welfare.AllCategories,
			// Said explicitly, because a listing that quietly omits the
			// narrative looks like a bug rather than a decision.
			"note": "Case details are not included in a list. Open a case to " +
				"read it — each read is recorded.",
		})
	}
}

func handleWelfareCase(svc *welfare.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		found, err := svc.ByID(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			writeWelfareError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, found)
	}
}

func handleOpenCase(svc *welfare.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			MemberID    string `json:"memberId"`
			Category    string `json:"category"`
			Urgency     string `json:"urgency"`
			Summary     string `json:"summary"`
			Detail      string `json:"detail"`
			AmountMinor int64  `json:"amountMinor"`
			Currency    string `json:"currency"`
			AssignedTo  string `json:"assignedTo"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		created, err := svc.Open(r.Context(), welfare.Input{
			MemberID: body.MemberID, Category: welfare.Category(body.Category),
			Urgency: welfare.Urgency(body.Urgency), Summary: body.Summary,
			Detail: body.Detail, AmountMinor: body.AmountMinor,
			Currency: body.Currency, AssignedTo: body.AssignedTo,
		})
		if err != nil {
			writeWelfareError(w, err)
			return
		}
		httpx.JSON(w, http.StatusCreated, created)
	}
}

func handleAddCaseNote(svc *welfare.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Body string `json:"body"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		updated, err := svc.AddNote(r.Context(), chi.URLParam(r, "id"), body.Body)
		if err != nil {
			writeWelfareError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, updated)
	}
}

func handleSetCaseStatus(svc *welfare.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Status string `json:"status"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		updated, err := svc.SetStatus(r.Context(), chi.URLParam(r, "id"),
			welfare.Status(body.Status))
		if err != nil {
			writeWelfareError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, updated)
	}
}

func handleAssignCase(svc *welfare.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			MemberID string `json:"memberId"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		updated, err := svc.Assign(r.Context(), chi.URLParam(r, "id"), body.MemberID)
		if err != nil {
			writeWelfareError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, updated)
	}
}

func writeWelfareError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, welfare.ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "Not found")
	case errors.Is(err, welfare.ErrNotEncrypted):
		// 503, and it says why. A deployment with no welfare key cannot store
		// cases, and that is the correct behaviour rather than a bug — but the
		// person who hit it needs to know it is an operator's job, not theirs.
		httpx.Error(w, http.StatusServiceUnavailable,
			"Welfare cases cannot be stored until the platform's welfare "+
				"encryption key is configured. Nothing has been saved.")
	case errors.Is(err, welfare.ErrMemberRequired):
		httpx.Error(w, http.StatusBadRequest, "Say who this case is about.")
	case errors.Is(err, welfare.ErrSummaryRequired):
		httpx.Error(w, http.StatusBadRequest, "Write a short summary.")
	case errors.Is(err, welfare.ErrCategoryInvalid):
		httpx.Error(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, welfare.ErrStatusInvalid):
		httpx.Error(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, tenancy.ErrNoTenant):
		httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
	default:
		httpx.Error(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
	}
}
