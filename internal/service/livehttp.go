package service

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/live"
	"github.com/hayfordstanley/altar-os/internal/domain/member"
	"github.com/hayfordstanley/altar-os/internal/domain/plan"
	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// buildLive mounts live services.
func buildLive(d *deps.Deps) http.Handler { return standalone(liveRoutes(d)) }

// liveRoutes registers streaming.
//
// The guard split follows the same rule as the feed: STARTING a service is
// running the church, so it needs a permission. WATCHING one is being a member
// of the congregation, so it needs none — putting the join behind a permission
// would mean a church had to grant its own members the right to attend.
func liveRoutes(d *deps.Deps) routeSet {
	plans := plan.NewService(d.Mongo)
	svc := live.NewService(d.Mongo, plans, mediaServerFor(d))
	members := member.NewService(d.Mongo, d.Events, d.Config.DataRegion)

	return func(r chi.Router) {
		// The media signalling channel. OUTSIDE the auth middleware because a
		// browser cannot set an Authorization header when opening a WebSocket;
		// its credential is the room grant in the query string, which is why
		// grants are narrow and short-lived rather than session tokens.
		r.Get("/live/signal", handleLiveSignal(d))

		r.Group(func(r chi.Router) {
			r.Use(authenticated(d))
			r.Use(resolvePermissions(d))

			// --- what the congregation does ---
			r.Get("/live/sessions", handleLiveSessions(svc))
			r.Post("/live/sessions/{id}/join", handleLiveJoin(svc, members))
			r.Post("/live/sessions/{id}/leave", handleLiveLeave(svc, members))
			// Heartbeat keeps a seat. Without it a dropped connection holds
			// one until the service ends and the room fills with ghosts.
			r.Post("/live/sessions/{id}/heartbeat", handleLiveHeartbeat(svc, members))

			// --- what the church does ---
			r.With(requirePermission(rbac.ResourceEvent, rbac.ActionCreate)).
				Post("/live/sessions", handleCreateLiveSession(svc))
			r.With(requirePermission(rbac.ResourceEvent, rbac.ActionUpdate)).
				Post("/live/sessions/{id}/start", handleStartLiveSession(svc))
			r.With(requirePermission(rbac.ResourceEvent, rbac.ActionUpdate)).
				Post("/live/sessions/{id}/end", handleEndLiveSession(svc))
		})
	}
}

func handleLiveSessions(svc *live.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		out, err := svc.Sessions(r.Context())
		if err != nil {
			writeLiveError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"sessions": out, "total": len(out)})
	}
}

func handleCreateLiveSession(svc *live.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Title       string `json:"title"`
			Description string `json:"description"`
			Kind        string `json:"kind"`
			CampaignID  string `json:"campaignId"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		out, err := svc.Schedule(r.Context(), live.ScheduleInput{
			Title: body.Title, Description: body.Description,
			Kind: live.Kind(body.Kind), CampaignID: body.CampaignID,
		})
		if err != nil {
			writeLiveError(w, err)
			return
		}
		httpx.JSON(w, http.StatusCreated, map[string]any{"session": out})
	}
}

func handleStartLiveSession(svc *live.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, err := callerScope(r)
		if err != nil {
			writeLiveError(w, err)
			return
		}
		out, err := svc.Start(r.Context(), chi.URLParam(r, "id"), scope.UserID)
		if err != nil {
			writeLiveError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"session": out})
	}
}

func handleEndLiveSession(svc *live.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		out, err := svc.End(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			writeLiveError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"session": out})
	}
}

func handleLiveJoin(svc *live.Service, members *member.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		memberID, _, ok := callerIdentity(r, members)
		if !ok {
			httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
			return
		}
		grant, err := svc.Join(r.Context(), chi.URLParam(r, "id"), memberID)
		if err != nil {
			writeLiveError(w, err)
			return
		}
		// The grant carries the room token and the ICE servers. Handed out per
		// join rather than baked into the app, because managed TURN
		// credentials are short-lived and an app shipped with a static one
		// stops connecting the day they rotate.
		httpx.JSON(w, http.StatusOK, map[string]any{"grant": grant})
	}
}

func handleLiveLeave(svc *live.Service, members *member.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		memberID, _, ok := callerIdentity(r, members)
		if !ok {
			httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
			return
		}
		if err := svc.Leave(r.Context(), chi.URLParam(r, "id"), memberID); err != nil {
			writeLiveError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"left": true})
	}
}

func handleLiveHeartbeat(svc *live.Service, members *member.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		memberID, _, ok := callerIdentity(r, members)
		if !ok {
			httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
			return
		}
		if err := svc.Heartbeat(r.Context(), chi.URLParam(r, "id"), memberID); err != nil {
			writeLiveError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func writeLiveError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, live.ErrSessionNotFound):
		httpx.Error(w, http.StatusNotFound, "That service does not exist.")
	case errors.Is(err, live.ErrNotLive):
		httpx.Error(w, http.StatusConflict, "That service is not live.")
	case errors.Is(err, live.ErrFull):
		// 409 rather than 403: nothing is wrong with this person, the room is
		// simply full, and the client should say so rather than "denied".
		httpx.Error(w, http.StatusConflict,
			"This service is full. Your church can raise the limit on its plan.")
	case errors.Is(err, live.ErrNotEntitled):
		httpx.Error(w, http.StatusPaymentRequired,
			"Live services are not included in your church's plan.")
	case errors.Is(err, live.ErrMediaNotConfigured):
		httpx.Error(w, http.StatusServiceUnavailable,
			"Live streaming is not switched on for this server yet.")
	case errors.Is(err, live.ErrTitleRequired):
		httpx.Error(w, http.StatusBadRequest, "Give the service a name.")
	case errors.Is(err, tenancy.ErrNoTenant):
		httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
	default:
		httpx.Error(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
	}
}
