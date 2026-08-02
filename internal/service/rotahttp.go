package service

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/member"
	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/domain/rota"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// buildRota mounts volunteer scheduling (WP-33).
func buildRota(d *deps.Deps) http.Handler { return standalone(rotaRoutes(d)) }

func newRotaService(d *deps.Deps) *rota.Service {
	return rota.NewService(d.Mongo, newEventService(d), newNotificationService(d))
}

// rotaRoutes registers scheduling.
//
// The split that matters here is between BUILDING a rota and ANSWERING one.
// Building is `event:update` — it is a leadership act over the service. But a
// volunteer answering their own assignment holds no event permission at all
// (the Member role has event:read and nothing else), so those routes carry no
// permission and check ownership in the handler instead. Requiring a permission
// there would mean a congregation that cannot decline a slot it was given.
func rotaRoutes(d *deps.Deps) routeSet {
	svc := newRotaService(d)
	members := member.NewService(d.Mongo, d.Events, d.Config.DataRegion)

	return func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(authenticated(d))
			r.Use(resolvePermissions(d))

			// --- building a rota ---
			r.With(requirePermission(rbac.ResourceEvent, rbac.ActionUpdate)).
				Post("/rota/assignments", handleAssign(svc))
			r.With(requirePermission(rbac.ResourceEvent, rbac.ActionUpdate)).
				Post("/rota/publish", handlePublishRota(svc))
			r.With(requirePermission(rbac.ResourceEvent, rbac.ActionRead)).
				Get("/rota/service", handleServiceRota(svc))
			r.With(requirePermission(rbac.ResourceEvent, rbac.ActionRead)).
				Get("/rota/open", handleOpenSlots(svc))

			// --- a volunteer's own rota ---
			//
			// No event permission, deliberately. See the note above.
			r.Get("/rota/mine", handleMyRota(svc, members))
			r.Post("/rota/assignments/{id}/respond", handleRespond(svc, members))
			r.Post("/rota/assignments/{id}/swap", handleRequestSwap(svc, members))
			r.Post("/rota/assignments/{id}/take", handleAcceptSwap(svc, members))
			r.Post("/rota/unavailability", handleBlockDates(svc, members))
		})
	}
}

// callerMemberID resolves the member record behind the signed-in account.
//
// Rota actions are about a PERSON, not an account, and most of a congregation
// has a member record while a handful of staff have a login and no member. An
// endpoint that used the user id directly would silently fail for exactly the
// volunteers it exists for.
func callerMemberID(r *http.Request, members *member.Service) (string, bool) {
	scope, err := callerScope(r)
	if err != nil {
		return "", false
	}
	found, err := members.ByUserID(r.Context(), scope.UserID)
	if err != nil {
		return "", false
	}
	return found.ID.Hex(), true
}

func occurrenceFrom(r *http.Request) (time.Time, bool) {
	raw := r.URL.Query().Get("occurrence")
	if raw == "" {
		return time.Time{}, false
	}
	parsed, err := time.Parse(time.RFC3339, raw)
	return parsed, err == nil
}

func handleAssign(svc *rota.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			EventID      string     `json:"eventId"`
			OccurrenceAt *time.Time `json:"occurrenceAt"`
			Role         string     `json:"role"`
			MemberID     string     `json:"memberId"`
			Force        bool       `json:"force"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		in := rota.AssignInput{
			EventID: body.EventID, Role: body.Role,
			MemberID: body.MemberID, Force: body.Force,
		}
		if body.OccurrenceAt != nil {
			in.OccurrenceAt = *body.OccurrenceAt
		}

		created, err := svc.Assign(r.Context(), in)
		if err != nil {
			writeRotaError(w, err)
			return
		}
		httpx.JSON(w, http.StatusCreated, created)
	}
}

func handlePublishRota(svc *rota.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			EventID      string     `json:"eventId"`
			OccurrenceAt *time.Time `json:"occurrenceAt"`
		}
		if err := decode(r, &body); err != nil || body.OccurrenceAt == nil {
			httpx.Error(w, http.StatusBadRequest, "Say which service to publish.")
			return
		}
		published, err := svc.Publish(r.Context(), body.EventID, *body.OccurrenceAt)
		if err != nil {
			writeRotaError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"published": published})
	}
}

func handleServiceRota(svc *rota.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		at, ok := occurrenceFrom(r)
		if !ok {
			httpx.Error(w, http.StatusBadRequest,
				"Say which service, as ?occurrence=2026-08-09T09:00:00Z.")
			return
		}
		out, err := svc.ForService(r.Context(), r.URL.Query().Get("eventId"), at)
		if err != nil {
			writeRotaError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, out)
	}
}

func handleOpenSlots(svc *rota.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		open, err := svc.OpenSlots(r.Context(), time.Time{})
		if err != nil {
			writeRotaError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"open": open})
	}
}

func handleMyRota(svc *rota.Service, members *member.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		memberID, ok := callerMemberID(r, members)
		if !ok {
			httpx.Error(w, http.StatusConflict,
				"Your account is not linked to a member record yet, so we cannot "+
					"show your rota. Ask your church office to link it.")
			return
		}
		mine, err := svc.Mine(r.Context(), memberID, time.Time{})
		if err != nil {
			writeRotaError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"assignments": mine})
	}
}

func handleRespond(svc *rota.Service, members *member.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Accept *bool  `json:"accept"`
			Note   string `json:"note"`
		}
		if err := decode(r, &body); err != nil || body.Accept == nil {
			httpx.Error(w, http.StatusBadRequest, "Say whether you can serve.")
			return
		}
		memberID, ok := callerMemberID(r, members)
		if !ok {
			httpx.Error(w, http.StatusConflict, "Your account is not linked to a member record.")
			return
		}
		out, err := svc.Respond(r.Context(), chi.URLParam(r, "id"), memberID, *body.Accept, body.Note)
		if err != nil {
			writeRotaError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, out)
	}
}

func handleRequestSwap(svc *rota.Service, members *member.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Note string `json:"note"`
		}
		_ = decode(r, &body)
		memberID, ok := callerMemberID(r, members)
		if !ok {
			httpx.Error(w, http.StatusConflict, "Your account is not linked to a member record.")
			return
		}
		out, err := svc.RequestSwap(r.Context(), chi.URLParam(r, "id"), memberID, body.Note)
		if err != nil {
			writeRotaError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, out)
	}
}

func handleAcceptSwap(svc *rota.Service, members *member.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		memberID, ok := callerMemberID(r, members)
		if !ok {
			httpx.Error(w, http.StatusConflict, "Your account is not linked to a member record.")
			return
		}
		out, err := svc.AcceptSwap(r.Context(), chi.URLParam(r, "id"), memberID)
		if err != nil {
			writeRotaError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, out)
	}
}

func handleBlockDates(svc *rota.Service, members *member.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			From   *time.Time `json:"from"`
			To     *time.Time `json:"to"`
			Reason string     `json:"reason"`
		}
		if err := decode(r, &body); err != nil || body.From == nil || body.To == nil {
			httpx.Error(w, http.StatusBadRequest, "Say which dates you are away.")
			return
		}
		memberID, ok := callerMemberID(r, members)
		if !ok {
			httpx.Error(w, http.StatusConflict, "Your account is not linked to a member record.")
			return
		}
		out, err := svc.BlockDates(r.Context(), memberID, *body.From, *body.To, body.Reason)
		if err != nil {
			writeRotaError(w, err)
			return
		}
		httpx.JSON(w, http.StatusCreated, out)
	}
}

func writeRotaError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, rota.ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "That assignment does not exist.")
	case errors.Is(err, rota.ErrRoleRequired):
		httpx.Error(w, http.StatusBadRequest, "Say which role they are serving in.")
	case errors.Is(err, rota.ErrMemberRequired):
		httpx.Error(w, http.StatusBadRequest, "Choose a volunteer.")
	case errors.Is(err, rota.ErrOccurrenceRequired):
		httpx.Error(w, http.StatusBadRequest, "Say which service this is for.")
	case errors.Is(err, rota.ErrNotAnOccurrence):
		httpx.Error(w, http.StatusBadRequest,
			"That service does not happen at that time. Check the date against "+
				"the service's schedule.")
	case errors.Is(err, rota.ErrDoubleBooked):
		httpx.Error(w, http.StatusConflict,
			"They are already serving in another role at that service.")
	case errors.Is(err, rota.ErrAlreadyAssigned):
		httpx.Error(w, http.StatusConflict, "They already have that role for this service.")
	case errors.Is(err, rota.ErrUnavailable):
		// 409 with the override named, because the team leader may well have
		// spoken to them and needs to know the door is not closed.
		httpx.Error(w, http.StatusConflict,
			"They have marked themselves unavailable then. Send it again with "+
				"\"force\": true if you have arranged it with them.")
	case errors.Is(err, rota.ErrNotYours):
		httpx.Error(w, http.StatusForbidden, "You can only answer for yourself.")
	case errors.Is(err, rota.ErrNotOpen):
		httpx.Error(w, http.StatusConflict,
			"Somebody else has already taken that slot.")
	case errors.Is(err, tenancy.ErrNoTenant):
		httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
	default:
		httpx.Error(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
	}
}
