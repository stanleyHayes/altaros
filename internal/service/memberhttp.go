package service

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/member"
	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// buildMember mounts the member CRM routes (WP-12).
func buildMember(d *deps.Deps) http.Handler { return standalone(memberRoutes(d)) }

// memberRoutes registers the member CRM endpoints onto a router.
func memberRoutes(d *deps.Deps) routeSet {
	svc := member.NewService(d.Mongo, d.Events, d.Config.DataRegion)

	return func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(authenticated(d))
			// Required: without it every requirePermission below reads an empty
			// set and refuses everyone.
			r.Use(resolvePermissions(d))

			// Reading the congregation is a leadership action. A member
			// browsing the full directory is a data-protection problem, not a
			// feature.
			//
			// Guarded per VERB rather than as one group, because the group
			// allowlist gave reading and deleting the same weight: anyone who
			// could open the directory could also change a member's status.
			r.With(requirePermission(rbac.ResourceMember, rbac.ActionRead)).
				Get("/members", handleListMembers(svc))

			r.With(requirePermission(rbac.ResourceMember, rbac.ActionCreate)).
				Post("/members", handleCreateMember(svc))

			// Import is an UPSERT, not a create: a row whose normalised phone
			// matches an existing member updates that member (WP-12's dedupe is
			// the whole point of it). Guarding it with create alone lets someone
			// who may only add people rewrite the record of everyone already
			// there, by uploading a file. Both permissions, therefore.
			r.With(
				requirePermission(rbac.ResourceMember, rbac.ActionCreate),
				requirePermission(rbac.ResourceMember, rbac.ActionUpdate),
			).Post("/members/import", handleImportMembers(svc))

			r.With(requirePermission(rbac.ResourceMember, rbac.ActionUpdate)).
				Patch("/members/{id}/status", handleSetMemberStatus(svc))

			// A member may read their own record — ownership, checked in the
			// handler, not a permission over the congregation.
			r.Get("/members/{id}", handleGetMember(svc))
		})
	}
}

func handleListMembers(svc *member.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit := int64(100)
		if raw := r.URL.Query().Get("limit"); raw != "" {
			if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil {
				limit = parsed
			}
		}

		members, err := svc.List(r.Context(), member.Status(r.URL.Query().Get("status")), limit)
		if err != nil {
			writeMemberError(w, err)
			return
		}
		if members == nil {
			// An empty congregation is [], not null: the frontends map over
			// this directly and null crashes them.
			members = []member.Member{}
		}
		httpx.JSON(w, http.StatusOK, members)
	}
}

func handleGetMember(svc *member.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		if !selfOr(r, id, rbac.ResourceMember, rbac.ActionRead) {
			httpx.Error(w, http.StatusForbidden, "You do not have permission to do that.")
			return
		}
		m, err := svc.ByID(r.Context(), id)
		if err != nil {
			writeMemberError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, m)
	}
}

func handleCreateMember(svc *member.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			FirstName   string `json:"firstName"`
			LastName    string `json:"lastName"`
			Phone       string `json:"phone"`
			Email       string `json:"email"`
			Gender      string `json:"gender"`
			Status      string `json:"status"`
			HouseholdID string `json:"householdId"`
		}
		if err := decode(r, &req); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}

		created, err := svc.Create(r.Context(), member.Input{
			FirstName:   req.FirstName,
			LastName:    req.LastName,
			Phone:       req.Phone,
			Email:       req.Email,
			Gender:      req.Gender,
			Status:      member.Status(req.Status),
			HouseholdID: req.HouseholdID,
		})
		if err != nil {
			writeMemberError(w, err)
			return
		}
		httpx.JSON(w, http.StatusCreated, created)
	}
}

func handleImportMembers(svc *member.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Rows []struct {
				FirstName string `json:"firstName"`
				LastName  string `json:"lastName"`
				Phone     string `json:"phone"`
				Email     string `json:"email"`
				Gender    string `json:"gender"`
			} `json:"rows"`
		}
		if err := decode(r, &req); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		if len(req.Rows) == 0 {
			httpx.Error(w, http.StatusBadRequest, "No rows to import.")
			return
		}

		rows := make([]member.ImportRow, 0, len(req.Rows))
		for _, row := range req.Rows {
			rows = append(rows, member.ImportRow{
				FirstName: row.FirstName,
				LastName:  row.LastName,
				Phone:     row.Phone,
				Email:     row.Email,
				Gender:    row.Gender,
			})
		}

		result, err := svc.Import(r.Context(), rows)
		if err != nil {
			writeMemberError(w, err)
			return
		}
		// 200 rather than 201: a partial import is the normal outcome, and the
		// body carries the per-row failures the admin needs to fix.
		httpx.JSON(w, http.StatusOK, result)
	}
}

func handleSetMemberStatus(svc *member.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Status string `json:"status"`
		}
		if err := decode(r, &req); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		if err := svc.SetStatus(r.Context(), chi.URLParam(r, "id"), member.Status(req.Status)); err != nil {
			writeMemberError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"status": req.Status})
	}
}

func writeMemberError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, member.ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "Member not found")
	case errors.Is(err, member.ErrDuplicate):
		httpx.Error(w, http.StatusConflict, "A member with that phone number already exists.")
	case errors.Is(err, member.ErrNameRequired):
		httpx.Error(w, http.StatusBadRequest, "A first or last name is required.")
	case errors.Is(err, member.ErrInvalidStatus):
		httpx.Error(w, http.StatusBadRequest, "That status is not recognised.")
	case errors.Is(err, tenancy.ErrNoTenant):
		httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
	default:
		httpx.Error(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
	}
}
