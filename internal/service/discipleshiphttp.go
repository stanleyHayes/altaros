package service

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/discipleship"
	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// buildDiscipleship mounts the follow-up pipeline (WP-34).
func buildDiscipleship(d *deps.Deps) http.Handler { return standalone(discipleshipRoutes(d)) }

// discipleshipRoutes registers the journey and its follow-up.
//
// Guarded by `member` permissions rather than a resource of its own: a
// discipleship record IS a fact about a member, and a church that trusts
// somebody to read the membership roll is not making a second decision when it
// lets them see that a visitor came last Sunday. Adding a resource here would
// mean every existing church needed another backfill for no gain.
//
// The one exception is a volunteer's OWN task list, which is ownership rather
// than a permission — the same rule that lets a member read their own receipt.
func discipleshipRoutes(d *deps.Deps) routeSet {
	svc := discipleship.NewService(d.Mongo)

	return func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(authenticated(d))
			r.Use(resolvePermissions(d))

			r.With(requirePermission(rbac.ResourceMember, rbac.ActionRead)).
				Get("/discipleship/journeys/{memberId}", handleJourney(svc))
			r.With(requirePermission(rbac.ResourceMember, rbac.ActionUpdate)).
				Post("/discipleship/journeys", handleRecordStage(svc))

			// Ownership-checked inside the handler: a volunteer reads their
			// own list without holding member:read over the congregation.
			r.Get("/discipleship/tasks", handleListTasks(svc))

			r.Post("/discipleship/tasks/{id}/touch", handleTouchTask(svc))
			r.Post("/discipleship/tasks/{id}/close", handleCloseTask(svc))
			r.With(requirePermission(rbac.ResourceMember, rbac.ActionUpdate)).
				Post("/discipleship/tasks/{id}/reassign", handleReassignTask(svc))
		})
	}
}

func handleJourney(svc *discipleship.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		journey, err := svc.JourneyFor(r.Context(), chi.URLParam(r, "memberId"))
		if err != nil {
			writeDiscipleshipError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"journey": journey})
	}
}

func handleRecordStage(svc *discipleship.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			MemberID   string `json:"memberId"`
			Stage      string `json:"stage"`
			Source     string `json:"source"`
			Note       string `json:"note"`
			AssigneeID string `json:"assigneeId"`
			At         string `json:"at"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		scope, err := callerScope(r)
		if err != nil {
			writeDiscipleshipError(w, err)
			return
		}

		in := discipleship.RecordInput{
			MemberID:   body.MemberID,
			Stage:      discipleship.Stage(body.Stage),
			Source:     body.Source,
			Note:       body.Note,
			AssigneeID: body.AssigneeID,
			ActorID:    scope.UserID,
		}
		if body.At != "" {
			// A church records Sunday's visitors on Tuesday, so the SLA has to
			// be able to run from when they actually came.
			at, err := time.Parse(time.RFC3339, body.At)
			if err != nil {
				if at, err = time.Parse("2006-01-02", body.At); err != nil {
					httpx.Error(w, http.StatusBadRequest,
						"That date could not be read. Use YYYY-MM-DD.")
					return
				}
			}
			in.At = at
		}

		out, err := svc.Record(r.Context(), in)
		if err != nil {
			writeDiscipleshipError(w, err)
			return
		}
		httpx.JSON(w, http.StatusCreated, out)
	}
}

func handleListTasks(svc *discipleship.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		assignee := r.URL.Query().Get("assigneeId")
		if !selfOr(r, assignee, rbac.ResourceMember, rbac.ActionRead) {
			httpx.Error(w, http.StatusForbidden,
				"You do not have access to the church's follow-up list.")
			return
		}

		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		out, err := svc.Tasks(r.Context(), discipleship.TaskFilter{
			AssigneeID:  assignee,
			Status:      discipleship.TaskStatus(r.URL.Query().Get("status")),
			OpenOnly:    r.URL.Query().Get("open") == "true",
			OverdueOnly: r.URL.Query().Get("overdue") == "true",
			Limit:       limit,
		})
		if err != nil {
			writeDiscipleshipError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"data": out, "total": len(out)})
	}
}

func handleTouchTask(svc *discipleship.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, err := callerScope(r)
		if err != nil {
			writeDiscipleshipError(w, err)
			return
		}
		task, err := svc.Touch(r.Context(), chi.URLParam(r, "id"), scope.UserID)
		if err != nil {
			writeDiscipleshipError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"task": task})
	}
}

func handleCloseTask(svc *discipleship.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Status  string `json:"status"`
			Outcome string `json:"outcome"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		scope, err := callerScope(r)
		if err != nil {
			writeDiscipleshipError(w, err)
			return
		}
		task, err := svc.Close(r.Context(), discipleship.CloseInput{
			TaskID:  chi.URLParam(r, "id"),
			Status:  discipleship.TaskStatus(body.Status),
			Outcome: body.Outcome,
			ActorID: scope.UserID,
		})
		if err != nil {
			writeDiscipleshipError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"task": task})
	}
}

func handleReassignTask(svc *discipleship.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			AssigneeID string `json:"assigneeId"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		task, err := svc.Reassign(r.Context(), chi.URLParam(r, "id"), body.AssigneeID)
		if err != nil {
			writeDiscipleshipError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"task": task})
	}
}

func writeDiscipleshipError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, discipleship.ErrJourneyNotFound):
		httpx.Error(w, http.StatusNotFound, "That member is not on the pipeline yet.")
	case errors.Is(err, discipleship.ErrTaskNotFound):
		httpx.Error(w, http.StatusNotFound, "That follow-up does not exist.")
	case errors.Is(err, discipleship.ErrMemberRequired):
		httpx.Error(w, http.StatusBadRequest, "Say which member this is about.")
	case errors.Is(err, discipleship.ErrStageInvalid):
		httpx.Error(w, http.StatusBadRequest, "That stage is not recognised.")
	case errors.Is(err, discipleship.ErrNoOwner):
		httpx.Error(w, http.StatusBadRequest,
			"Choose who is responsible for this follow-up.")
	case errors.Is(err, discipleship.ErrAlreadyClosed):
		httpx.Error(w, http.StatusConflict, "That follow-up is already closed.")
	case errors.Is(err, discipleship.ErrOutcomeRequired):
		httpx.Error(w, http.StatusBadRequest, "Say what happened when you close this.")
	case errors.Is(err, tenancy.ErrNoTenant):
		httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
	default:
		httpx.Error(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
	}
}
