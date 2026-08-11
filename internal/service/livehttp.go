package service

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"path/filepath"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/live"
	"github.com/hayfordstanley/altar-os/internal/domain/member"
	"github.com/hayfordstanley/altar-os/internal/domain/plan"
	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/media"
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
				Post("/live/sessions/{id}/start", handleStartLiveSession(svc, d))
			// Recordings. A church's own past services, guarded by the same
			// permission that runs them — and deleted ones stay LISTED with
			// their expiry, so retention is visible rather than mysterious.
			r.With(requirePermission(rbac.ResourceEvent, rbac.ActionRead)).
				Get("/live/recordings", handleListRecordings(svc))
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
			Recording   bool   `json:"recording"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		out, err := svc.Schedule(r.Context(), live.ScheduleInput{
			Title: body.Title, Description: body.Description,
			Kind: live.Kind(body.Kind), CampaignID: body.CampaignID,
			Recording: body.Recording,
		})
		if err != nil {
			writeLiveError(w, err)
			return
		}
		httpx.JSON(w, http.StatusCreated, map[string]any{"session": out})
	}
}

func handleStartLiveSession(svc *live.Service, d *deps.Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, err := callerScope(r)
		if err != nil {
			writeLiveError(w, err)
			return
		}
		sessionID := chi.URLParam(r, "id")
		out, err := svc.Start(r.Context(), sessionID, scope.UserID)
		if err != nil {
			writeLiveError(w, err)
			return
		}

		var notice live.RecordingNotice
		if out.Recording {
			notice = beginRecording(r.Context(), svc, d, out, scope.UserID)
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"session": out, "recording": notice,
		})
	}
}

// beginRecording attaches a recorder to the live room.
//
// Failure to record does NOT stop the service. A congregation waiting for a
// pastor to appear must not be held up because a disk was full, and the notice
// returned here is what tells the church that the service is live but is not
// being captured — which is the one thing they cannot find out any other way.
func beginRecording(ctx context.Context, svc *live.Service, d *deps.Deps, session *live.Session, actorID string) live.RecordingNotice {
	dir := recordingDir(d)
	if dir == "" {
		slog.Warn("a service asked to be recorded but recording is not configured",
			"session", session.ID.Hex())
		return live.RecordingNotice{}
	}
	sfu := runningSFU()
	if sfu == nil {
		return live.RecordingNotice{}
	}
	room, err := sfu.Room(session.RoomID)
	if err != nil {
		slog.Warn("could not find the room to record",
			"session", session.ID.Hex(), "error", err)
		return live.RecordingNotice{}
	}

	recorder, err := media.NewRecorder(dir, session.ID.Hex())
	if err != nil {
		slog.Error("could not open a recorder", "session", session.ID.Hex(), "error", err)
		return live.RecordingNotice{}
	}
	video, _ := recorder.Paths()
	rec, err := svc.StartRecording(ctx, session.ID.Hex(), filepath.Base(video), actorID, 0)
	if err != nil {
		slog.Error("could not record that a recording started",
			"session", session.ID.Hex(), "error", err)
		_, _ = recorder.Close()
		return live.RecordingNotice{}
	}
	room.SetRecorder(recorder)

	slog.Info("recording a service",
		"session", session.ID.Hex(), "recording", rec.ID.Hex(),
		"delete_after", rec.DeleteAfter)
	return live.NoticeFor(session, &rec.DeleteAfter)
}

func handleEndLiveSession(svc *live.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sessionID := chi.URLParam(r, "id")

		// The recorder is closed BEFORE the room is torn down, so the files
		// are finished while the room still holds them. Closing the room
		// first would leave an IVF whose header was never rewritten — a file
		// that exists, has a size, and will not play.
		finishRecording(r.Context(), svc, sessionID)

		out, err := svc.End(r.Context(), sessionID)
		if err != nil {
			writeLiveError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"session": out})
	}
}

// finishRecording closes the recorder and records the outcome.
func finishRecording(ctx context.Context, svc *live.Service, sessionID string) {
	rec, err := svc.RecordingForSession(ctx, sessionID)
	if err != nil || rec.Status != live.RecordingActive {
		return
	}
	sfu := runningSFU()
	if sfu == nil {
		return
	}
	session, err := svc.SessionByID(ctx, sessionID)
	if err != nil {
		return
	}
	room, err := sfu.Room(session.RoomID)
	if err != nil {
		return
	}
	recorder := room.Recorder()
	if recorder == nil {
		return
	}

	bytes, closeErr := recorder.Close()
	room.SetRecorder(nil)
	if _, err := svc.FinishRecording(ctx, rec.ID.Hex(), bytes, closeErr != nil); err != nil {
		slog.Error("could not record how a recording finished",
			"recording", rec.ID.Hex(), "error", err)
	}
	if closeErr != nil {
		slog.Warn("a recording did not finish cleanly",
			"recording", rec.ID.Hex(), "error", closeErr)
	}
}

func handleLiveJoin(svc *live.Service, members *member.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		memberID, _, ok := callerIdentity(r, members)
		if !ok {
			httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
			return
		}
		sessionID := chi.URLParam(r, "id")
		grant, err := svc.Join(r.Context(), sessionID, memberID)
		if err != nil {
			writeLiveError(w, err)
			return
		}

		// The recording notice travels WITH the grant, in the same response,
		// before the client has connected anything.
		//
		// Act 843 makes a recorded service sensitive personal data, and a
		// notice that arrives after someone's camera is already on is not a
		// notice. Putting it in a settings page the church wrote once would be
		// the same failure with more steps.
		notice := live.RecordingNotice{}
		if session, err := svc.SessionByID(r.Context(), sessionID); err == nil {
			var keptUntil *time.Time
			if rec, err := svc.RecordingForSession(r.Context(), sessionID); err == nil {
				keptUntil = &rec.DeleteAfter
			}
			notice = live.NoticeFor(session, keptUntil)
		}

		// The grant carries the room token and the ICE servers. Handed out per
		// join rather than baked into the app, because managed TURN
		// credentials are short-lived and an app shipped with a static one
		// stops connecting the day they rotate.
		httpx.JSON(w, http.StatusOK, map[string]any{
			"grant": grant, "recording": notice,
		})
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

// handleListRecordings lists a church's recorded services.
func handleListRecordings(svc *live.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		recordings, err := svc.Recordings(r.Context())
		if err != nil {
			writeLiveError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"recordings": recordings,
			// Stated alongside the list so a church can see the rule it is
			// operating under without reading a policy document.
			"retention": map[string]any{
				"defaultDays": int(live.DefaultRetention.Hours() / 24),
				"maximumDays": int(live.MaxRetention.Hours() / 24),
			},
		})
	}
}
