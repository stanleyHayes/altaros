package service

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/event"
	"github.com/hayfordstanley/altar-os/internal/domain/member"
	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// buildEvent mounts events, RSVP and attendance (WP-21).
func buildEvent(d *deps.Deps) http.Handler { return standalone(eventRoutes(d)) }

// newEventService builds the event service with its member roster.
//
// Shared by the routes and by index creation so both agree on how it is
// constructed — an event service built without a roster silently stops checking
// that a check-in names a real member.
func newEventService(d *deps.Deps) *event.Service {
	return event.NewService(d.Mongo, member.NewService(d.Mongo, d.Events, d.Config.DataRegion))
}

// eventRoutes registers the event endpoints.
func eventRoutes(d *deps.Deps) routeSet {
	svc := newEventService(d)
	members := member.NewService(d.Mongo, d.Events, d.Config.DataRegion)

	return func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(authenticated(d))
			// Required: without it every requirePermission below reads an empty
			// set and refuses everyone.
			r.Use(resolvePermissions(d))

			// Reading the calendar is the one thing the Member role holds here,
			// and it is the reason the church's own people can open the app at
			// all. Every write below needs more.
			r.With(requirePermission(rbac.ResourceEvent, rbac.ActionRead)).
				Get("/events", handleListEvents(svc))
			// Mobile compatibility URLs. Go owns these explicitly so they no
			// longer fall through to the legacy Express query middleware.
			r.With(requirePermission(rbac.ResourceEvent, rbac.ActionRead)).
				Get("/events/church/{churchId}", handleMobileEvents(svc))
			r.Get("/events/rsvps/me", handleMyRSVPs(svc, members))
			r.Post("/events/rsvp", handleMobileRSVP(svc, members))
			// Static segments are registered before the {id} pattern so chi
			// matches them first; "upcoming" must never be read as an id.
			r.With(requirePermission(rbac.ResourceEvent, rbac.ActionRead)).
				Get("/events/upcoming", handleUpcomingEvents(svc))
			r.With(requirePermission(rbac.ResourceEvent, rbac.ActionRead)).
				Get("/events/code/{code}", handleEventByCode(svc))

			r.With(requirePermission(rbac.ResourceEvent, rbac.ActionCreate)).
				Post("/events", handleCreateEvent(svc))

			r.Route("/events/{id}", func(r chi.Router) {
				r.With(requirePermission(rbac.ResourceEvent, rbac.ActionRead)).
					Get("/", handleGetEvent(svc))
				r.With(requirePermission(rbac.ResourceEvent, rbac.ActionUpdate)).
					Patch("/", handleUpdateEvent(svc))
				r.With(requirePermission(rbac.ResourceEvent, rbac.ActionDelete)).
					Delete("/", handleDeleteEvent(svc))

				// Answering an invitation is something a member does for
				// THEMSELVES, so this carries no event permission — the Member
				// role deliberately holds only event:read, and requiring more
				// would mean a congregation that cannot RSVP to its own events.
				// Answering for somebody else is a different act and is checked
				// inside the handler.
				r.Post("/rsvp", handleRSVP(svc, members))
				r.With(requirePermission(rbac.ResourceEvent, rbac.ActionRead)).
					Get("/rsvps", handleListRSVPs(svc))

				// Check-in is event:update: an usher at the door is Staff or
				// holds a role built for it. A member cannot mark themselves
				// present, which is the entire point of an attendance record.
				r.With(requirePermission(rbac.ResourceEvent, rbac.ActionUpdate)).
					Post("/check-in", handleCheckIn(svc))
				r.With(requirePermission(rbac.ResourceEvent, rbac.ActionUpdate)).
					Post("/attendance/sync", handleSyncAttendance(svc))
				r.With(requirePermission(rbac.ResourceEvent, rbac.ActionRead)).
					Get("/attendance", handleListAttendance(svc))
			})
		})
	}
}

func handleMobileEvents(svc *event.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, err := callerScope(r)
		if err != nil || chi.URLParam(r, "churchId") != scope.ChurchID {
			httpx.Error(w, http.StatusForbidden, "You cannot view another church's events.")
			return
		}
		handleListEvents(svc)(w, r)
	}
}

func handleMyRSVPs(svc *event.Service, members *member.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		self, err := members.ByUserID(r.Context(), callerUserID(r))
		if err != nil {
			httpx.Error(w, http.StatusConflict, "Your account is not linked to a member record yet.")
			return
		}
		raw := strings.TrimSpace(r.URL.Query().Get("eventIds"))
		ids := []string{}
		if raw != "" {
			ids = strings.Split(raw, ",")
		}
		items, err := svc.MemberRSVPs(r.Context(), self.ID.Hex(), ids)
		if err != nil {
			writeEventError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, items)
	}
}

func handleMobileRSVP(svc *event.Service, members *member.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			EventID string `json:"eventId"`
			Status  string `json:"status"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		self, err := members.ByUserID(r.Context(), callerUserID(r))
		if err != nil {
			httpx.Error(w, http.StatusConflict, "Your account is not linked to a member record yet.")
			return
		}
		item, err := svc.Respond(r.Context(), body.EventID, self.ID.Hex(), event.RSVPStatus(body.Status))
		if err != nil {
			writeEventError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, item)
	}
}

// eventInput is the wire shape of an event.
type eventInput struct {
	Title          string     `json:"title"`
	Description    string     `json:"description"`
	Location       string     `json:"location"`
	StartDate      *time.Time `json:"startDate"`
	EndDate        *time.Time `json:"endDate"`
	RecurrenceRule string     `json:"recurrenceRule"`
	Capacity       int        `json:"capacity"`
}

func (in eventInput) toDomain() event.Input {
	out := event.Input{
		Title:          in.Title,
		Description:    in.Description,
		Location:       in.Location,
		RecurrenceRule: in.RecurrenceRule,
		Capacity:       in.Capacity,
	}
	if in.StartDate != nil {
		out.StartDate = *in.StartDate
	}
	if in.EndDate != nil {
		out.EndDate = *in.EndDate
	}
	return out
}

func handleListEvents(svc *event.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		filter := event.Filter{}
		if raw := r.URL.Query().Get("from"); raw != "" {
			if parsed, err := time.Parse(time.RFC3339, raw); err == nil {
				filter.From = parsed
			}
		}
		if raw := r.URL.Query().Get("to"); raw != "" {
			if parsed, err := time.Parse(time.RFC3339, raw); err == nil {
				filter.To = parsed
			}
		}
		if raw := r.URL.Query().Get("limit"); raw != "" {
			if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil {
				filter.Limit = parsed
			}
		}

		events, err := svc.List(r.Context(), filter)
		if err != nil {
			writeEventError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"events": events})
	}
}

func handleUpcomingEvents(svc *event.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit := 5
		if raw := r.URL.Query().Get("limit"); raw != "" {
			if parsed, err := strconv.Atoi(raw); err == nil {
				limit = parsed
			}
		}
		occurrences, err := svc.Upcoming(r.Context(), limit)
		if err != nil {
			writeEventError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"events": occurrences})
	}
}

func handleGetEvent(svc *event.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		found, err := svc.ByID(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			writeEventError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, found)
	}
}

// handleEventByCode resolves the code an usher's device presents.
//
// The response deliberately carries the event only. An usher scanning into a
// door app needs to know which service they are checking people into; the
// attendance list is a separate, separately-permissioned request.
func handleEventByCode(svc *event.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		found, err := svc.ByCheckInCode(r.Context(), chi.URLParam(r, "code"))
		if err != nil {
			writeEventError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, found)
	}
}

func handleCreateEvent(svc *event.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body eventInput
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		created, err := svc.Create(r.Context(), body.toDomain())
		if err != nil {
			writeEventError(w, err)
			return
		}
		httpx.JSON(w, http.StatusCreated, created)
	}
}

func handleUpdateEvent(svc *event.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body eventInput
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		updated, err := svc.Update(r.Context(), chi.URLParam(r, "id"), body.toDomain())
		if err != nil {
			writeEventError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, updated)
	}
}

func handleDeleteEvent(svc *event.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := svc.Delete(r.Context(), chi.URLParam(r, "id")); err != nil {
			writeEventError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"deleted": true})
	}
}

// handleRSVP records an answer.
//
// Two callers share this route and they are NOT equivalent:
//
//   - a member answering for themselves, which needs no event permission;
//   - leadership answering on somebody's behalf (phone calls to the elderly are
//     how a real RSVP list gets filled), which needs event:update.
//
// The distinction is enforced here rather than by the router, because the
// router cannot see whose id is in the body.
func handleRSVP(svc *event.Service, members *member.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Status   string `json:"status"`
			MemberID string `json:"memberId"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}

		self, err := members.ByUserID(r.Context(), callerUserID(r))
		selfID := ""
		if err == nil {
			selfID = self.ID.Hex()
		}

		memberID := body.MemberID
		if memberID == "" {
			memberID = selfID
		}
		if memberID == "" {
			// The caller has a login but no member record. Told plainly,
			// because "no member found" on an RSVP button is baffling.
			httpx.Error(w, http.StatusConflict,
				"Your account is not linked to a member record yet, so we cannot "+
					"record your response. Ask your church office to link it.")
			return
		}
		if memberID != selfID && !Can(r, rbac.ResourceEvent, rbac.ActionUpdate) {
			httpx.Error(w, http.StatusForbidden,
				"You can only respond for yourself.")
			return
		}

		rsvp, err := svc.Respond(r.Context(),
			chi.URLParam(r, "id"), memberID, event.RSVPStatus(body.Status))
		if err != nil {
			writeEventError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, rsvp)
	}
}

func handleListRSVPs(svc *event.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rsvps, err := svc.RSVPs(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			writeEventError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"rsvps": rsvps})
	}
}

// handleCheckIn records one person at the door.
func handleCheckIn(svc *event.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			MemberID    string     `json:"memberId"`
			Method      string     `json:"method"`
			CheckedInAt *time.Time `json:"checkedInAt"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}

		in := event.CheckIn{
			MemberID: body.MemberID,
			Method:   event.CheckInMethod(body.Method),
		}
		if body.CheckedInAt != nil {
			in.CheckedInAt = *body.CheckedInAt
		}

		created, err := svc.CheckIn(r.Context(), chi.URLParam(r, "id"), in)
		if err != nil {
			writeEventError(w, err)
			return
		}
		// 200 either way. A second scan of the same person is not a conflict to
		// resolve, it is the same fact arriving twice — and an usher holding a
		// queue of people should never be shown an error for it.
		httpx.JSON(w, http.StatusOK, map[string]any{
			"recorded":         created,
			"alreadyCheckedIn": !created,
		})
	}
}

// handleSyncAttendance lands an offline queue (§8.3).
//
// The response separates recorded from duplicate deliberately: a device that
// resends after losing signal mid-sync must be able to tell a successful first
// attempt from a successful retry, and an usher shown "200 recorded" twice
// reasonably concludes the register is now wrong.
func handleSyncAttendance(svc *event.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			// A POINTER, so an absent flag is distinguishable from an explicit
			// false. A plain bool would make every device that does not send
			// the field look like a live scanner, and the difference is the
			// only record of why a check-in is timestamped hours before it
			// arrived.
			Offline *bool `json:"offline"`
			// Occurrence names which staging of a recurring event this queue
			// belongs to. Omitted by a device syncing during the service; sent
			// by an administrator typing up an older register.
			Occurrence *time.Time `json:"occurrence"`
			CheckIns   []struct {
				MemberID    string     `json:"memberId"`
				Method      string     `json:"method"`
				CheckedInAt *time.Time `json:"checkedInAt"`
			} `json:"checkIns"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		if len(body.CheckIns) > maxSyncBatch {
			httpx.Error(w, http.StatusRequestEntityTooLarge,
				"That is too many check-ins in one go. Send them in batches of "+
					strconv.Itoa(maxSyncBatch)+".")
			return
		}

		batch := make([]event.CheckIn, 0, len(body.CheckIns))
		for _, row := range body.CheckIns {
			in := event.CheckIn{
				MemberID: row.MemberID,
				Method:   event.CheckInMethod(row.Method),
			}
			if row.CheckedInAt != nil {
				in.CheckedInAt = *row.CheckedInAt
			}
			batch = append(batch, in)
		}

		// Offline defaults to true. This endpoint exists for a queue captured
		// without connectivity, and a device that omits the flag is far more
		// likely to be one of those than a live scanner — which has a
		// single-check-in endpoint of its own.
		offline := true
		if body.Offline != nil {
			offline = *body.Offline
		}

		req := event.SyncRequest{
			EventID:  chi.URLParam(r, "id"),
			CheckIns: batch,
			Offline:  offline,
		}
		if body.Occurrence != nil {
			req.Occurrence = *body.Occurrence
		}

		result, err := svc.Sync(r.Context(), req)
		if err != nil {
			writeEventError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, result)
	}
}

// maxSyncBatch bounds one reconcile.
//
// Comfortably above the 200 the acceptance criterion names, and low enough that
// a corrupt device cannot ask the server to hold an unbounded slice in memory.
const maxSyncBatch = 1000

func handleListAttendance(svc *event.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// ?occurrence= narrows a recurring event to one Sunday. Without it the
		// register for a weekly service is every Sunday it has ever run, which
		// is a report rather than a register.
		occurrence := time.Time{}
		if raw := r.URL.Query().Get("occurrence"); raw != "" {
			parsed, err := time.Parse(time.RFC3339, raw)
			if err != nil {
				httpx.Error(w, http.StatusBadRequest,
					"The occurrence must be a full timestamp, like 2026-08-02T09:00:00Z.")
				return
			}
			occurrence = parsed
		}

		records, err := svc.Attendance(r.Context(), chi.URLParam(r, "id"), occurrence)
		if err != nil {
			writeEventError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"attendance": records,
			"total":      len(records),
		})
	}
}

// callerUserID returns the acting user, or "" when unauthenticated.
func callerUserID(r *http.Request) string {
	scope, err := callerScope(r)
	if err != nil {
		return ""
	}
	return scope.UserID
}

func writeEventError(w http.ResponseWriter, err error) {
	var recurrence *event.ErrRecurrenceInvalid
	switch {
	case errors.Is(err, event.ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "That event does not exist.")
	case errors.Is(err, event.ErrCheckInCodeInvalid):
		httpx.Error(w, http.StatusNotFound, "That check-in code is not valid.")
	case errors.Is(err, event.ErrTitleRequired):
		httpx.Error(w, http.StatusBadRequest, "An event needs a title.")
	case errors.Is(err, event.ErrTimesInvalid):
		httpx.Error(w, http.StatusBadRequest,
			"Check the start and end times — an event has to end after it starts.")
	case errors.Is(err, event.ErrMemberRequired):
		httpx.Error(w, http.StatusBadRequest, "No member was named.")
	case errors.Is(err, event.ErrStatusInvalid):
		httpx.Error(w, http.StatusBadRequest,
			"That response is not recognised. Use GOING, MAYBE or NOT_GOING.")
	case errors.Is(err, event.ErrCapacityReached):
		httpx.Error(w, http.StatusConflict, "This event is full.")
	case errors.As(err, &recurrence):
		// The parse failure is passed through: "BYSETPOS is not supported yet"
		// tells whoever typed the rule what to change, and a generic message
		// tells them nothing.
		httpx.Error(w, http.StatusBadRequest, recurrence.Reason)
	case errors.Is(err, tenancy.ErrNoTenant):
		httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
	default:
		httpx.Error(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
	}
}
