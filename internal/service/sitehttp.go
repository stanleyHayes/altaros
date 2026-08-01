package service

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/domain/site"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/ratelimit"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// buildSite mounts the church website and its CMS (WP-40).
func buildSite(d *deps.Deps) http.Handler { return standalone(siteRoutes(d)) }

// siteRoutes registers the CMS editor and the public renderer's data source.
//
// Two audiences on one router, and the split between them is the point:
//
//   - The EDITOR is a signed-in staff member, guarded by `settings` permissions
//     — a church website is part of how the church presents itself, which is
//     the same authority as changing its name or its giving details.
//   - The PUBLIC endpoints have no session at all. They are scoped by the HOST
//     (WP-39), serve PUBLISHED content only, and there is no parameter that can
//     make them return a draft.
func siteRoutes(d *deps.Deps) routeSet {
	svc := site.NewService(d.Mongo)

	return func(r chi.Router) {
		// --- the public site ---
		//
		// No authenticated(), deliberately: a visitor reading service times has
		// no account. The church comes from the Host header, and the tenant
		// scope is derived from it rather than from a token.
		r.With(throttle(d, ratelimit.PublicSite)).
			Get("/site/pages", handlePublicPages(svc))
		r.With(throttle(d, ratelimit.PublicSite)).
			Get("/site/pages/{slug}", handlePublicPage(svc))
		r.With(throttle(d, ratelimit.PublicSite)).
			Get("/site/home", handlePublicHome(svc))

		// --- the editor ---
		r.Group(func(r chi.Router) {
			r.Use(authenticated(d))
			r.Use(resolvePermissions(d))

			// The block library, so the editor's "add a section" menu comes
			// from the server rather than a hard-coded copy that drifts.
			r.With(requirePermission(rbac.ResourceSettings, rbac.ActionRead)).
				Get("/site/blocks", handleBlockLibrary())

			r.With(requirePermission(rbac.ResourceSettings, rbac.ActionRead)).
				Get("/site/admin/pages", handleListPages(svc))
			r.With(requirePermission(rbac.ResourceSettings, rbac.ActionCreate)).
				Post("/site/admin/pages", handleCreatePage(svc))

			r.Route("/site/admin/pages/{id}", func(r chi.Router) {
				r.With(requirePermission(rbac.ResourceSettings, rbac.ActionRead)).
					Get("/", handleGetPage(svc))
				r.With(requirePermission(rbac.ResourceSettings, rbac.ActionUpdate)).
					Put("/", handleUpdatePage(svc))
				r.With(requirePermission(rbac.ResourceSettings, rbac.ActionDelete)).
					Delete("/", handleDeletePage(svc))

				// The draft: what the editor is working on, never public.
				r.With(requirePermission(rbac.ResourceSettings, rbac.ActionRead)).
					Get("/draft", handleGetDraft(svc))
				r.With(requirePermission(rbac.ResourceSettings, rbac.ActionUpdate)).
					Put("/draft/blocks", handleSetBlocks(svc))

				// Publishing is an UPDATE rather than its own permission.
				// Splitting "may edit" from "may publish" is a real workflow
				// some churches want, and inventing a permission for it before
				// one asks is how a permission model becomes unusable.
				r.With(requirePermission(rbac.ResourceSettings, rbac.ActionUpdate)).
					Post("/publish", handlePublish(svc))
				r.With(requirePermission(rbac.ResourceSettings, rbac.ActionUpdate)).
					Post("/unpublish", handleUnpublish(svc))
				r.With(requirePermission(rbac.ResourceSettings, rbac.ActionRead)).
					Get("/versions", handleVersions(svc))
				r.With(requirePermission(rbac.ResourceSettings, rbac.ActionUpdate)).
					Post("/rollback", handleRollback(svc))
			})

			r.With(requirePermission(rbac.ResourceSettings, rbac.ActionRead)).
				Get("/site/admin/theme", handleGetTheme(svc))
			r.With(requirePermission(rbac.ResourceSettings, rbac.ActionUpdate)).
				Put("/site/admin/theme", handleSetTheme(svc))
		})
	}
}

// --- the public site -------------------------------------------------------

// publicScope derives a tenant scope from the resolved host.
//
// This is the join between WP-39 and WP-40, and the one place a request gets a
// church without a token. Everything it reaches is published content — the
// service's Render has no parameter that could return a draft — so a Host
// header cannot be used to read anything the public could not already see by
// visiting the site.
func publicScope(r *http.Request) (*http.Request, bool) {
	found, ok := hostChurchFrom(r.Context())
	if !ok {
		return r, false
	}
	scope := tenancy.Scope{ChurchID: found.ID}
	return r.WithContext(tenancy.WithScope(r.Context(), scope)), true
}

func handlePublicPage(svc *site.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scoped, ok := publicScope(r)
		if !ok {
			httpx.Error(w, http.StatusNotFound, "No church is served at this address.")
			return
		}
		page, err := svc.Render(scoped.Context(), chi.URLParam(r, "slug"))
		if err != nil {
			writeSiteError(w, err)
			return
		}
		writePublicPage(w, page)
	}
}

func handlePublicHome(svc *site.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scoped, ok := publicScope(r)
		if !ok {
			httpx.Error(w, http.StatusNotFound, "No church is served at this address.")
			return
		}
		page, err := svc.Render(scoped.Context(), "")
		if err != nil {
			writeSiteError(w, err)
			return
		}
		writePublicPage(w, page)
	}
}

// writePublicPage answers with caching a church site actually benefits from.
//
// A church page changes when somebody publishes, which is rarely. A short
// public cache with a long stale-while-revalidate means the congregation is
// served from the edge and a publish still reaches them in a minute — and it
// means a Sunday-morning traffic spike does not reach the database at all.
func writePublicPage(w http.ResponseWriter, page *site.RenderedPage) {
	w.Header().Set("Cache-Control", "public, max-age=60, stale-while-revalidate=600")
	if page.PublishedAt != nil {
		w.Header().Set("Last-Modified", page.PublishedAt.UTC().Format(http.TimeFormat))
	}
	httpx.JSON(w, http.StatusOK, page)
}

func handlePublicPages(svc *site.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scoped, ok := publicScope(r)
		if !ok {
			httpx.Error(w, http.StatusNotFound, "No church is served at this address.")
			return
		}
		// The home page carries the navigation, and the navigation is the only
		// list the public needs. Serving the full page list would expose
		// unpublished addresses.
		page, err := svc.Render(scoped.Context(), "")
		if err != nil {
			writeSiteError(w, err)
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=60, stale-while-revalidate=600")
		httpx.JSON(w, http.StatusOK, map[string]any{"nav": page.Nav})
	}
}

// --- the editor ------------------------------------------------------------

func handleBlockLibrary() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]any{
			"blocks": site.BlockLibrary(),
			// Said here rather than left for a rejected save to explain.
			"note": "Sections that read your church's own records stay up to " +
				"date on their own — you never re-type an event.",
		})
	}
}

func handleListPages(svc *site.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pages, err := svc.Pages(r.Context())
		if err != nil {
			writeSiteError(w, err)
			return
		}

		// The editor needs to know which pages have unpublished work — that is
		// the single most useful thing on a page list and it is derived, not
		// stored.
		type pageView struct {
			*site.Page
			Published        bool `json:"published"`
			UnpublishedEdits bool `json:"unpublishedEdits"`
		}
		out := make([]pageView, 0, len(pages))
		for i := range pages {
			out = append(out, pageView{
				Page:             &pages[i],
				Published:        pages[i].IsPublished(),
				UnpublishedEdits: pages[i].HasUnpublishedChanges(),
			})
		}
		httpx.JSON(w, http.StatusOK, out)
	}
}

type pageBody struct {
	Slug           string `json:"slug"`
	Title          string `json:"title"`
	SEODescription string `json:"seoDescription"`
	InNav          bool   `json:"inNav"`
	NavOrder       int    `json:"navOrder"`
}

func (b pageBody) input() site.PageInput {
	return site.PageInput{
		Slug: b.Slug, Title: b.Title, SEODescription: b.SEODescription,
		InNav: b.InNav, NavOrder: b.NavOrder,
	}
}

func handleCreatePage(svc *site.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body pageBody
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		page, err := svc.CreatePage(r.Context(), body.input())
		if err != nil {
			writeSiteError(w, err)
			return
		}
		httpx.JSON(w, http.StatusCreated, page)
	}
}

func handleGetPage(svc *site.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		page, err := svc.PageByID(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			writeSiteError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, page)
	}
}

func handleUpdatePage(svc *site.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body pageBody
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		page, err := svc.UpdatePage(r.Context(), chi.URLParam(r, "id"), body.input())
		if err != nil {
			writeSiteError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, page)
	}
}

func handleDeletePage(svc *site.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := svc.DeletePage(r.Context(), chi.URLParam(r, "id")); err != nil {
			writeSiteError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"deleted": true})
	}
}

// handleGetDraft returns what the editor is working on.
//
// Calling this FORKS a new version when the current draft is live, which is
// what makes opening the editor safe: from that moment the edits are private,
// and the live site is untouched until publish.
func handleGetDraft(svc *site.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		version, err := svc.EditableVersion(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			writeSiteError(w, err)
			return
		}
		blocks, err := svc.BlocksOf(r.Context(), version.ID.Hex())
		if err != nil {
			writeSiteError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"version": version, "blocks": blocks})
	}
}

func handleSetBlocks(svc *site.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Blocks []struct {
				Type string         `json:"type"`
				Data map[string]any `json:"data"`
			} `json:"blocks"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}

		inputs := make([]site.BlockInput, 0, len(body.Blocks))
		for _, b := range body.Blocks {
			inputs = append(inputs, site.BlockInput{Type: site.BlockType(b.Type), Data: b.Data})
		}

		blocks, err := svc.SetBlocks(r.Context(), chi.URLParam(r, "id"), inputs)
		if err != nil {
			writeSiteError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"blocks": blocks})
	}
}

func handlePublish(svc *site.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Note string `json:"note"`
		}
		// A missing body is fine — the note is optional.
		_ = decode(r, &body)

		page, err := svc.Publish(r.Context(), chi.URLParam(r, "id"), body.Note)
		if err != nil {
			writeSiteError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"page": page,
			"note": "This is now live on your church's website.",
		})
	}
}

func handleUnpublish(svc *site.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		page, err := svc.Unpublish(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			writeSiteError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"page": page,
			"note": "This page is no longer on your website. Your edits are kept.",
		})
	}
}

func handleVersions(svc *site.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		versions, err := svc.Versions(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			writeSiteError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, versions)
	}
}

func handleRollback(svc *site.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			VersionID string `json:"versionId"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		page, err := svc.Rollback(r.Context(), chi.URLParam(r, "id"), body.VersionID)
		if err != nil {
			writeSiteError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"page": page,
			"note": "Your website has been restored to that version.",
		})
	}
}

func handleGetTheme(svc *site.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		theme, err := svc.Theme(r.Context())
		if err != nil {
			writeSiteError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, theme)
	}
}

func handleSetTheme(svc *site.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Palette    string `json:"palette"`
			Typography string `json:"typography"`
			Mode       string `json:"mode"`
			LogoURL    string `json:"logoUrl"`
			FaviconURL string `json:"faviconUrl"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		theme, err := svc.SetTheme(r.Context(), site.Theme{
			Palette: body.Palette, Typography: body.Typography, Mode: body.Mode,
			LogoURL: body.LogoURL, FaviconURL: body.FaviconURL,
		})
		if err != nil {
			writeSiteError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, theme)
	}
}

func writeSiteError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, site.ErrPageNotFound):
		httpx.Error(w, http.StatusNotFound, "That page does not exist.")

	case errors.Is(err, site.ErrVersionNotFound):
		httpx.Error(w, http.StatusNotFound, "That version does not exist.")

	case errors.Is(err, site.ErrSlugTaken):
		httpx.Error(w, http.StatusConflict, "You already have a page at that address.")

	case errors.Is(err, site.ErrSlugInvalid), errors.Is(err, site.ErrTitleRequired),
		errors.Is(err, site.ErrBlockType), errors.Is(err, site.ErrBlockData),
		errors.Is(err, site.ErrRichTextInvalid), errors.Is(err, site.ErrURLScheme),
		errors.Is(err, site.ErrURLInvalid):
		// The message names what is wrong and which section — an editor can
		// act on that, and none of it is sensitive: it is about content they
		// just typed.
		httpx.Error(w, http.StatusBadRequest, err.Error())

	case errors.Is(err, site.ErrNothingToPublish):
		httpx.Error(w, http.StatusConflict, "There are no changes to publish.")

	case errors.Is(err, site.ErrNotPublished):
		httpx.Error(w, http.StatusConflict, "That page is not on your website yet.")

	case errors.Is(err, site.ErrHomePageRequired):
		httpx.Error(w, http.StatusConflict,
			"Your site needs a home page. Edit this one instead of removing it.")

	case errors.Is(err, tenancy.ErrNoTenant):
		httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")

	default:
		httpx.Error(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
	}
}
