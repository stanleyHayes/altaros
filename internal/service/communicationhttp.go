package service

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/communication"
	"github.com/hayfordstanley/altar-os/internal/domain/member"
	"github.com/hayfordstanley/altar-os/internal/domain/platformsetting"
	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/money"
	"github.com/hayfordstanley/altar-os/internal/platform/sms"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// buildCommunication mounts broadcast and targeted messaging (WP-22).
func buildCommunication(d *deps.Deps) http.Handler { return standalone(communicationRoutes(d)) }

// platformRates adapts the platform settings to what communication needs.
type platformRates struct{ settings *platformsetting.Service }

func (p *platformRates) MessagingRate(ctx context.Context, channel string) (money.Amount, bool, error) {
	current, err := p.settings.Current(ctx)
	if err != nil {
		// An unpriced channel, not an error. A settings read failing must not
		// stop a church seeing who a message reaches; the preview says the cost
		// is unavailable rather than showing zero.
		return money.Amount{}, false, nil
	}
	rate, ok := current.MessagingRate(channel)
	return rate, ok, nil
}

func newCommunicationService(d *deps.Deps) *communication.Service {
	return communication.NewService(d.Mongo, newNotificationService(d),
		&platformRates{settings: platformsetting.NewService(d.Mongo)})
}

// communicationRoutes registers the messaging endpoints.
//
// Everything here is `communication` permissions, with one deliberate split:
// composing and previewing is CREATE, and actually sending is UPDATE. They are
// separated because a church that wants a draft-and-approve workflow can then
// build one out of the permissions it already has, rather than asking for a
// feature — and because previewing an audience is a read of the congregation,
// while sending to it spends money.
func communicationRoutes(d *deps.Deps) routeSet {
	svc := newCommunicationService(d)
	members := member.NewService(d.Mongo, d.Events, d.Config.DataRegion)

	return func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(authenticated(d))
			r.Use(resolvePermissions(d))

			// Who a filter selects, and what it would cost. Non-mutating, and
			// the thing a composer calls on every keystroke — so it is guarded
			// by read rather than create.
			r.With(requirePermission(rbac.ResourceCommunication, rbac.ActionRead)).
				Post("/communication/preview", handlePreviewBroadcast(svc))

			// The segmentation of a body on its own, with no audience. Cheap
			// enough to call as somebody types, which is the point: the
			// character that triples the cost should be flagged while they can
			// still delete it.
			r.With(requirePermission(rbac.ResourceCommunication, rbac.ActionRead)).
				Post("/communication/measure", handleMeasureMessage())

			r.With(requirePermission(rbac.ResourceCommunication, rbac.ActionRead)).
				Get("/communication/campaigns", handleListCampaigns(svc))
			r.With(requirePermission(rbac.ResourceCommunication, rbac.ActionCreate)).
				Post("/communication/campaigns", handleCreateCampaign(svc))

			r.Route("/communication/campaigns/{id}", func(r chi.Router) {
				r.With(requirePermission(rbac.ResourceCommunication, rbac.ActionRead)).
					Get("/", handleGetCampaign(svc))
				// Sending is UPDATE, not CREATE: it is the act that spends the
				// church's money, and it is worth being able to grant one
				// without the other.
				r.With(requirePermission(rbac.ResourceCommunication, rbac.ActionUpdate)).
					Post("/send", handleSendCampaign(svc))
				r.With(requirePermission(rbac.ResourceCommunication, rbac.ActionUpdate)).
					Post("/cancel", handleCancelCampaign(svc))
			})

			r.With(requirePermission(rbac.ResourceCommunication, rbac.ActionRead)).
				Get("/communication/templates", handleListTemplates(svc))
			r.With(requirePermission(rbac.ResourceCommunication, rbac.ActionCreate)).
				Put("/communication/templates", handleSaveTemplate(svc))
			r.With(requirePermission(rbac.ResourceCommunication, rbac.ActionDelete)).
				Delete("/communication/templates/{id}", handleDeleteTemplate(svc))

			// Ministry membership, which is what targeting filters on. Guarded
			// by MEMBER update rather than communication: adding somebody to
			// the youth department is a change to their record, and whoever may
			// send messages is not automatically whoever may edit the
			// congregation.
			r.With(
				requirePermission(rbac.ResourceMember, rbac.ActionUpdate),
			).Put("/members/{id}/ministries", handleSetMinistries(members))
		})
	}
}

// filterInput is the wire shape of an audience filter.
type filterInput struct {
	Statuses      []string `json:"statuses"`
	DepartmentIDs []string `json:"departmentIds"`
	GroupIDs      []string `json:"groupIds"`
	Gender        string   `json:"gender"`
	Activity      string   `json:"activity"`
	ActivityDays  int      `json:"activityDays"`
	MemberIDs     []string `json:"memberIds"`
}

func (in filterInput) toDomain() communication.Filter {
	f := communication.Filter{
		DepartmentIDs: in.DepartmentIDs,
		GroupIDs:      in.GroupIDs,
		Gender:        in.Gender,
		Activity:      communication.Activity(in.Activity),
		MemberIDs:     in.MemberIDs,
	}
	for _, status := range in.Statuses {
		f.Statuses = append(f.Statuses, member.Status(status))
	}
	if in.ActivityDays > 0 {
		f.ActivityWindow = time.Duration(in.ActivityDays) * 24 * time.Hour
	}
	return f
}

func handlePreviewBroadcast(svc *communication.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Channel string      `json:"channel"`
			Body    string      `json:"body"`
			Filter  filterInput `json:"filter"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}

		preview, err := svc.Preview(r.Context(), body.Channel, body.Body, body.Filter.toDomain())
		if err != nil {
			writeCommunicationError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, preview)
	}
}

// handleMeasureMessage segments a body without resolving an audience.
func handleMeasureMessage() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Body string `json:"body"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		estimate := sms.Measure(body.Body)
		out := map[string]any{"message": estimate}
		// The corrected text is offered, never applied. Rewriting somebody's
		// words without asking is worse than charging them for them.
		if estimate.ForcedUnicodeBy != "" {
			if plain := sms.Plain(body.Body); plain != body.Body {
				out["suggestion"] = map[string]any{
					"body":    plain,
					"message": sms.Measure(plain),
				}
			}
		}
		httpx.JSON(w, http.StatusOK, out)
	}
}

func handleListCampaigns(svc *communication.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit := int64(0)
		if raw := r.URL.Query().Get("limit"); raw != "" {
			limit, _ = strconv.ParseInt(raw, 10, 64)
		}
		campaigns, err := svc.Campaigns(r.Context(), limit)
		if err != nil {
			writeCommunicationError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"campaigns": campaigns})
	}
}

func handleCreateCampaign(svc *communication.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Name         string      `json:"name"`
			Channel      string      `json:"channel"`
			Subject      string      `json:"subject"`
			Body         string      `json:"body"`
			Filter       filterInput `json:"filter"`
			ScheduledFor *time.Time  `json:"scheduledFor"`
			// AcceptedCostMinor is the estimate the sender agreed to. Carried
			// through so a scheduled send can refuse a material overrun rather
			// than spending money nobody approved.
			AcceptedCostMinor int64  `json:"acceptedCostMinor"`
			AcceptedCurrency  string `json:"acceptedCurrency"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}

		created, err := svc.Create(r.Context(), communication.CampaignInput{
			Name:              body.Name,
			Channel:           body.Channel,
			Subject:           body.Subject,
			Body:              body.Body,
			Filter:            body.Filter.toDomain(),
			ScheduledFor:      body.ScheduledFor,
			ApprovedCostMinor: body.AcceptedCostMinor,
			ApprovedCurrency:  body.AcceptedCurrency,
		})
		if err != nil {
			writeCommunicationError(w, err)
			return
		}
		httpx.JSON(w, http.StatusCreated, created)
	}
}

func handleGetCampaign(svc *communication.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		found, err := svc.ByID(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			writeCommunicationError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, found)
	}
}

func handleSendCampaign(svc *communication.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sent, err := svc.Send(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			writeCommunicationError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, sent)
	}
}

func handleCancelCampaign(svc *communication.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cancelled, err := svc.Cancel(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			writeCommunicationError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, cancelled)
	}
}

func handleListTemplates(svc *communication.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		templates, err := svc.Templates(r.Context())
		if err != nil {
			writeCommunicationError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"templates": templates})
	}
}

func handleSaveTemplate(svc *communication.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Name    string `json:"name"`
			Channel string `json:"channel"`
			Subject string `json:"subject"`
			Body    string `json:"body"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		saved, err := svc.SaveTemplate(r.Context(), body.Name, body.Channel, body.Subject, body.Body)
		if err != nil {
			writeCommunicationError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, saved)
	}
}

func handleDeleteTemplate(svc *communication.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := svc.DeleteTemplate(r.Context(), chi.URLParam(r, "id")); err != nil {
			writeCommunicationError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"deleted": true})
	}
}

// handleSetMinistries replaces a member's departments and groups.
func handleSetMinistries(members *member.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			DepartmentIDs []string `json:"departmentIds"`
			GroupIDs      []string `json:"groupIds"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		updated, err := members.SetMinistries(r.Context(), chi.URLParam(r, "id"),
			body.DepartmentIDs, body.GroupIDs)
		if err != nil {
			writeMemberError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, updated)
	}
}

func writeCommunicationError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, communication.ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "That message does not exist.")
	case errors.Is(err, communication.ErrBodyRequired):
		httpx.Error(w, http.StatusBadRequest, "Write something to send first.")
	case errors.Is(err, communication.ErrChannelInvalid):
		httpx.Error(w, http.StatusBadRequest,
			"Choose SMS, email, push or WhatsApp.")
	case errors.Is(err, communication.ErrFilterInvalid):
		httpx.Error(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, communication.ErrAudienceEmpty):
		httpx.Error(w, http.StatusBadRequest, "Nobody matches that audience.")
	case errors.Is(err, communication.ErrAudienceTooBroad):
		httpx.Error(w, http.StatusConflict,
			"That reaches more people than can be sent in one go. Narrow it down, "+
				"or send it to one department at a time.")
	case errors.Is(err, communication.ErrAlreadySent):
		httpx.Error(w, http.StatusConflict, "This message has already been sent.")
	case errors.Is(err, communication.ErrScheduleInPast):
		httpx.Error(w, http.StatusBadRequest, "That time has already passed.")
	case errors.Is(err, communication.ErrCostChanged):
		// 409, and it says what changed: a scheduled message to a congregation
		// that grew is not an error the church did anything wrong to cause.
		httpx.Error(w, http.StatusConflict,
			"More people match this audience than when the cost was approved, so "+
				"it would cost more than agreed. Review it and send again.")
	case errors.Is(err, tenancy.ErrNoTenant):
		httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
	default:
		httpx.Error(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
	}
}
