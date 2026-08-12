package service

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/directory"
	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// The public directory on ALTAR OS's own marketing site.
//
// Two routes with no authentication at all, and they are the only ones in the
// product that answer a stranger with data from more than one church. That is
// the point of the feature and also the whole risk of it, so the safety lives
// in the domain: two independent opt-ins, both in the query, and response types
// that list their fields rather than embedding a Church or a Campaign.
//
// The rest of it is here: no path parameter reaches a query, nothing accepts a
// church id from the caller, and the only writes are made by a church about
// ITSELF through the authenticated group below.

func buildDirectory(d *deps.Deps) http.Handler { return standalone(directoryRoutes(d)) }

func directoryRoutes(d *deps.Deps) routeSet {
	baseHost := ""
	if d.Config != nil {
		baseHost = d.Config.PublicBaseDomain
	}
	svc := directory.NewService(d.Mongo, baseHost)

	return func(r chi.Router) {
		// Public. Deliberately no tenant, no token, and no parameters — there
		// is nothing a caller can vary, so there is nothing to get wrong.
		r.Get("/directory/churches", handleDirectoryChurches(svc))
		r.Get("/directory/campaigns", handleDirectoryCampaigns(svc))

		r.Group(func(r chi.Router) {
			r.Use(authenticated(d))
			r.Use(resolvePermissions(d))

			// A church's own listing. Being on a software company's homepage
			// is a decision about the church's public identity, so it needs
			// the permission that governs the church's own settings rather
			// than anything to do with finance.
			r.With(requirePermission(rbac.ResourceSettings, rbac.ActionRead)).
				Get("/directory/listing", handleGetListing(svc))
			r.With(requirePermission(rbac.ResourceSettings, rbac.ActionUpdate)).
				Put("/directory/listing", handleSetListing(svc))
		})
	}
}

func handleDirectoryChurches(svc *directory.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		churches, err := svc.Churches(r.Context())
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "Something went wrong.")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"churches": churches})
	}
}

func handleDirectoryCampaigns(svc *directory.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		campaigns, err := svc.Campaigns(r.Context(), time.Now().UTC())
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "Something went wrong.")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"campaigns": campaigns})
	}
}

// handleGetListing tells a church whether it is in the directory.
func handleGetListing(svc *directory.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, err := tenancy.FromContext(r.Context())
		if err != nil {
			httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
			return
		}
		listed, err := svc.Listed(r.Context(), scope.ChurchID)
		if err != nil {
			httpx.Error(w, http.StatusNotFound, "That church does not exist.")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"listed": listed})
	}
}

// handleSetListing records a church's decision about being listed.
//
// The church id comes from the SCOPE, never from the body or the path. This is
// a cross-tenant collection, and an id taken from the caller is how one church
// ends up editing another's listing — the one mistake this whole package is
// arranged to prevent.
func handleSetListing(svc *directory.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Listed bool `json:"listed"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		scope, err := tenancy.FromContext(r.Context())
		if err != nil {
			httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
			return
		}
		if err := svc.SetListed(r.Context(), scope.ChurchID, body.Listed); err != nil {
			httpx.Error(w, http.StatusNotFound, "That church does not exist.")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"listed": body.Listed})
	}
}
