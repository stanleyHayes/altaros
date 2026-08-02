package service

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/church"
	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
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

			// The same set as full records — what the dashboard's church
			// picker reads. Ported from the legacy TypeScript API (WP-20);
			// it used to fall through to the proxy and 502.
			r.Get("/churches", handleListChurches(svc))

			// Creating a branch is an ORG-level act, guarded by the same role
			// check as listing a denomination's branches and for the same
			// reason given below: it is about organisational reach, and
			// `resource:action` cannot express that. A church admin creating
			// sibling churches inside their denomination is not a capability
			// anybody asked for.
			r.With(requireRole(RoleOrgAdmin)).
				Post("/churches", handleCreateChurch(svc))

			// Editing a church's own details is settings, not reach.
			r.With(resolvePermissions(d), requirePermission(rbac.ResourceSettings, rbac.ActionUpdate)).
				Put("/churches/{id}", handleUpdateChurch(svc))

			// The caller's own church, without needing to know its id.
			r.Get("/churches/current", handleCurrentChurch(svc))

			// A specific church, subject to the same visibility rule — this is
			// where an id from a URL would otherwise become a cross-branch read.
			r.Get("/churches/{id}", handleGetChurch(svc))

			// Deliberately still a ROLE check, and the only one left on the
			// platform after WP-36's sweep.
			//
			// Everything else moved to requirePermission so a church can invent
			// its own roles. This one cannot follow, because it does not ask a
			// capability question. Listing a denomination's branches is about
			// organisational REACH — whether the caller acts above a single
			// church — and `resource:action` has no way to say that. The nearest
			// permission, church:read, is held by every Administrator of every
			// branch, so converting it would let a single-branch admin enumerate
			// their whole denomination. That is a widening, not a migration.
			//
			// Scope already has a name here: tenancy.Scope.CrossBranch, set from
			// the same role, and VisibleChurchIDs is what actually decides which
			// branches come back. See §10 Q-14.
			r.Group(func(r chi.Router) {
				r.Use(requireRole(RoleOrgAdmin))
				r.Get("/organizations/{id}/branches", handleBranches(svc))
			})
		})
	}
}

// churchInput is the wire shape of a church.
type churchInput struct {
	Name     string `json:"name"`
	Slug     string `json:"slug"`
	Address  string `json:"address"`
	City     string `json:"city"`
	Country  string `json:"country"`
	Phone    string `json:"phone"`
	Email    string `json:"email"`
	Timezone string `json:"timezone"`
	Currency string `json:"currency"`
}

func (in churchInput) toDomain() church.Input {
	return church.Input{
		Name: in.Name, Slug: in.Slug, Address: in.Address, City: in.City,
		Country: in.Country, Phone: in.Phone, Email: in.Email,
		Timezone: in.Timezone, Currency: in.Currency,
	}
}

func handleListChurches(svc *church.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		churches, err := svc.Visible(r.Context())
		if err != nil {
			writeChurchError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, churches)
	}
}

func handleCreateChurch(svc *church.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body churchInput
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		created, err := svc.Create(r.Context(), body.toDomain())
		if err != nil {
			writeChurchError(w, err)
			return
		}
		httpx.JSON(w, http.StatusCreated, created)
	}
}

func handleUpdateChurch(svc *church.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body churchInput
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		updated, err := svc.Update(r.Context(), chi.URLParam(r, "id"), body.toDomain())
		if err != nil {
			writeChurchError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, updated)
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

	case errors.Is(err, church.ErrInvalidInput):
		httpx.Error(w, http.StatusBadRequest, err.Error())
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
