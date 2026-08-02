package service

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/member"
	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/domain/spiritual"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
)

func buildSpiritual(d *deps.Deps) http.Handler { return standalone(spiritualRoutes(d)) }

func spiritualRoutes(d *deps.Deps) routeSet {
	svc := spiritual.NewService(d.Mongo)
	members := member.NewService(d.Mongo, d.Events, d.Config.DataRegion)
	return func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(authenticated(d))
			r.Use(resolvePermissions(d))
			r.Get("/spiritual/devotional/today", handleTodayDevotional(svc))
			r.Get("/spiritual/devotionals", handleDevotionals(svc))
			r.Get("/spiritual/sermons", handleSermons(svc))
			r.Get("/spiritual/sermons/{id}", handleSermon(svc))
			r.With(requirePermission(rbac.ResourcePrayer, rbac.ActionRead)).
				Get("/spiritual/prayer-requests", handlePrayers(svc))
			r.With(requirePermission(rbac.ResourcePrayer, rbac.ActionCreate)).
				Post("/spiritual/prayer-requests", handleCreatePrayer(svc, members))
			r.With(requirePermission(rbac.ResourcePrayer, rbac.ActionCreate)).
				Post("/spiritual/prayer-requests/{id}/pray", handlePray(svc))
		})
	}
}

func pageParams(r *http.Request) (int, int) {
	p, _ := strconv.Atoi(r.URL.Query().Get("page")); if p < 1 { p = 1 }
	l, _ := strconv.Atoi(r.URL.Query().Get("limit")); if l < 1 { l = 20 }; if l > 50 { l = 50 }
	return p, l
}

func handleTodayDevotional(s *spiritual.Service) http.HandlerFunc { return func(w http.ResponseWriter, r *http.Request) {
	item, err := s.Today(r.Context()); if err != nil { writeSpiritualError(w, err); return }
	httpx.JSON(w, http.StatusOK, item)
} }

func handleDevotionals(s *spiritual.Service) http.HandlerFunc { return func(w http.ResponseWriter, r *http.Request) {
	p, l := pageParams(r); items, total, err := s.Devotionals(r.Context(), p, l)
	if err != nil { writeSpiritualError(w, err); return }
	httpx.JSON(w, http.StatusOK, map[string]any{"devotionals": items, "total": total})
} }

func handleSermons(s *spiritual.Service) http.HandlerFunc { return func(w http.ResponseWriter, r *http.Request) {
	p, l := pageParams(r); items, total, err := s.Sermons(r.Context(), p, l, r.URL.Query().Get("series"))
	if err != nil { writeSpiritualError(w, err); return }
	httpx.JSON(w, http.StatusOK, map[string]any{"sermons": items, "total": total})
} }

func handleSermon(s *spiritual.Service) http.HandlerFunc { return func(w http.ResponseWriter, r *http.Request) {
	item, err := s.Sermon(r.Context(), chi.URLParam(r, "id")); if err != nil { writeSpiritualError(w, err); return }
	httpx.JSON(w, http.StatusOK, item)
} }

func handlePrayers(s *spiritual.Service) http.HandlerFunc { return func(w http.ResponseWriter, r *http.Request) {
	p, l := pageParams(r); items, total, err := s.Prayers(r.Context(), p, l)
	if err != nil { writeSpiritualError(w, err); return }
	httpx.JSON(w, http.StatusOK, map[string]any{"requests": items, "total": total})
} }

func handleCreatePrayer(s *spiritual.Service, members *member.Service) http.HandlerFunc { return func(w http.ResponseWriter, r *http.Request) {
	var body struct { Title string `json:"title"`; Description string `json:"description"`; IsAnonymous bool `json:"isAnonymous"` }
	if err := decode(r, &body); err != nil { httpx.Error(w, http.StatusBadRequest, "Malformed request body"); return }
	m, err := members.ByUserID(r.Context(), callerUserID(r)); if err != nil { writeSpiritualError(w, spiritual.ErrMemberRequired); return }
	item, err := s.CreatePrayer(r.Context(), spiritual.PrayerInput{Title: body.Title, Description: body.Description, IsAnonymous: body.IsAnonymous, MemberID: m.ID.Hex(), AuthorName: m.FullName()})
	if err != nil { writeSpiritualError(w, err); return }
	httpx.JSON(w, http.StatusCreated, item)
} }

func handlePray(s *spiritual.Service) http.HandlerFunc { return func(w http.ResponseWriter, r *http.Request) {
	item, err := s.Pray(r.Context(), chi.URLParam(r, "id")); if err != nil { writeSpiritualError(w, err); return }
	httpx.JSON(w, http.StatusOK, map[string]any{"requestId": item.ID.Hex(), "prayerCount": item.PrayerCount})
} }

func writeSpiritualError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, spiritual.ErrNotFound): httpx.Error(w, http.StatusNotFound, "That spiritual resource is not available.")
	case errors.Is(err, spiritual.ErrInvalidInput): httpx.Error(w, http.StatusBadRequest, "Check the prayer title and description.")
	case errors.Is(err, spiritual.ErrMemberRequired): httpx.Error(w, http.StatusConflict, "Your account is not linked to a member record yet.")
	default:
		_ = strings.Builder{} // keep response deliberately free of internal database details
		httpx.Error(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
	}
}
