package service

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/church"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/ratelimit"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// buildChurch mounts the organization/branch routes (WP-11).
func buildChurch(d *deps.Deps) http.Handler { return standalone(churchRoutes(d)) }

// churchRoutes registers the hierarchy endpoints.
//
// The Go church service was built and tested in WP-11 and then left as a
// registry placeholder, so `VisibleChurchIDs` — the single place cross-branch
// reach is decided — had no caller outside its own tests. These routes are what
// make that decision reachable.
func churchRoutes(d *deps.Deps) routeSet {
	svc := church.NewService(d.Mongo)

	return func(r chi.Router) {
		// A church slug doubles as the member join code. Registration happens
		// before authentication, so expose only the three fields required to
		// confirm the destination and submit its opaque id to auth registration.
		// Unauthenticated, so this is an enumeration surface: a dictionary
		// attack over slugs builds the customer list, which §11.2 names as
		// competitively useful and, for a church in a hostile region, a safety
		// problem. The slug is public by design under ADR-007 — it is the
		// subdomain — so the endpoint is legitimate; the limit is what stops
		// enumerating every church on the platform being free.
		r.With(throttle(d, ratelimit.PublicLookup)).
			Get("/churches/slug/{slug}", handlePublicChurchBySlug(svc))

		r.Group(func(r chi.Router) {
			r.Use(authenticated(d))

			// Which churches this caller may see. An org admin gets every
			// branch in their denomination; a church admin gets exactly one.
			r.Get("/churches/visible", handleVisibleChurches(svc))

			// The caller's own church, without needing to know its id.
			r.Get("/churches/current", handleCurrentChurch(svc))

			// A specific church, subject to the same visibility rule — this is
			// where an id from a URL would otherwise become a cross-branch read.
			r.Get("/churches/{id}", handleGetChurch(svc))

			r.Group(func(r chi.Router) {
				r.Use(requireRole(RoleOrgAdmin))
				r.Get("/organizations/{id}/branches", handleBranches(svc))
			})
		})
	}
}

func handlePublicChurchBySlug(svc *church.Service) http.HandlerFunc {
	type publicChurch struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Slug string `json:"slug"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		ch, err := svc.ByPublicSlug(r.Context(), chi.URLParam(r, "slug"))
		if err != nil {
			writeChurchError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, publicChurch{
			ID: ch.ID.Hex(), Name: ch.Name, Slug: ch.Slug,
		})
	}
}

func handleVisibleChurches(svc *church.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ids, err := svc.VisibleChurchIDs(r.Context())
		if err != nil {
			writeChurchError(w, err)
			return
		}
		if ids == nil {
			ids = []string{}
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"churchIds": ids})
	}
}

func handleCurrentChurch(svc *church.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, err := callerScope(r)
		if err != nil {
			httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
			return
		}
		ch, err := svc.ByID(r.Context(), scope.ChurchID)
		if err != nil {
			writeChurchError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, ch)
	}
}

func handleGetChurch(svc *church.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")

		// CanAccessChurch is the check, not the tenant wrapper: churches are a
		// Global collection (a church cannot be scoped to itself), so without
		// this an authenticated member could read any church on the platform by
		// changing the id in the URL.
		if err := svc.CanAccessChurch(r.Context(), id); err != nil {
			writeChurchError(w, err)
			return
		}

		ch, err := svc.ByID(r.Context(), id)
		if err != nil {
			writeChurchError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, ch)
	}
}

func handleBranches(svc *church.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		branches, err := svc.BranchesOf(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			writeChurchError(w, err)
			return
		}
		if branches == nil {
			branches = []church.Church{}
		}
		httpx.JSON(w, http.StatusOK, branches)
	}
}

func writeChurchError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, church.ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "Church not found")

	case errors.Is(err, church.ErrForbidden):
		// 404, not 403. A 403 confirms the church exists, which lets anyone
		// with an account enumerate every church on the platform by id.
		httpx.Error(w, http.StatusNotFound, "Church not found")

	case errors.Is(err, tenancy.ErrNoTenant):
		httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")

	default:
		httpx.Error(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
	}
}
