package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/member"
	"github.com/hayfordstanley/altar-os/internal/domain/notification"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/ratelimit"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/token"
)

func buildNotification(d *deps.Deps) http.Handler { return standalone(notificationRoutes(d)) }

func notificationRoutes(d *deps.Deps) routeSet {
	svc := newNotificationService(d)
	members := member.NewService(d.Mongo, d.Events, d.Config.DataRegion)
	return func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(authenticated(d))
			r.Get("/notifications", handleNotificationInbox(svc, members))
			r.With(throttleUser(d, ratelimit.Write)).Put("/notifications/{id}/read", handleNotificationRead(svc, members))
			r.With(throttleUser(d, ratelimit.Write)).Post("/notifications/devices", handleNotificationDevice(d, svc, members))
		})
	}
}

type memberAccountResolver interface {
	ByUserID(context.Context, string) (*member.Member, error)
}

func memberIDForUser(ctx context.Context, resolver memberAccountResolver, userID string) (string, error) {
	linked, err := resolver.ByUserID(ctx, userID)
	if err != nil || linked == nil || linked.ID.IsZero() {
		return "", member.ErrNotFound
	}
	return linked.ID.Hex(), nil
}

type memberNotificationResponse struct {
	ID          string         `json:"id"`
	ChurchID    string         `json:"churchId"`
	RecipientID string         `json:"recipientId"`
	Channel     string         `json:"channel"`
	Type        string         `json:"type"`
	Status      string         `json:"status"`
	Title       string         `json:"title"`
	Body        string         `json:"body"`
	CreatedAt   time.Time      `json:"createdAt"`
	SentAt      *time.Time     `json:"sentAt,omitempty"`
	ReadAt      *time.Time     `json:"readAt,omitempty"`
	Metadata    map[string]any `json:"metadata"`
}

func notificationForMember(n notification.Notification) memberNotificationResponse {
	title := strings.TrimSpace(n.Subject)
	if title == "" {
		title = "Church update"
	}
	status := "SENT"
	switch n.Status {
	case notification.StatusQueued:
		status = "PENDING"
	case notification.StatusFailed, notification.StatusSuppressed:
		status = "FAILED"
	}
	if n.ReadAt != nil {
		status = "READ"
	}
	return memberNotificationResponse{
		ID: n.ID.Hex(), ChurchID: n.ChurchID.String(), RecipientID: n.MemberID.String(),
		Channel: strings.ToUpper(string(n.Channel)), Type: "CUSTOM", Status: status,
		Title: title, Body: n.Body, CreatedAt: n.CreatedAt, SentAt: n.SentAt,
		ReadAt: n.ReadAt, Metadata: notificationMetadata(n),
	}
}

func notificationMetadata(n notification.Notification) map[string]any {
	metadata := map[string]any{}
	if n.DeepLink != "" {
		metadata["deepLink"] = n.DeepLink
	}
	return metadata
}

func handleNotificationInbox(svc *notification.Service, members memberAccountResolver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, err := tenancy.FromContext(r.Context())
		if err != nil || scope.UserID == "" {
			httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
			return
		}
		memberID, err := memberIDForUser(r.Context(), members, scope.UserID)
		if err != nil {
			httpx.Error(w, http.StatusConflict, "Your account is not linked to a member record yet.")
			return
		}
		paged := r.URL.Query().Has("page") || r.URL.Query().Has("limit")
		page, limit := 1, 200
		if paged {
			page, limit = paging(r)
			if page < 1 {
				page = 1
			}
			if page > 10_000_000 {
				httpx.Error(w, http.StatusBadRequest, "That notification page is not valid.")
				return
			}
			if limit < 1 || limit > 100 {
				limit = 50
			}
		}
		history, err := svc.HistoryPage(r.Context(), memberID, int64(limit), int64(page-1)*int64(limit))
		if err != nil {
			writeNotificationError(w, err)
			return
		}
		items := make([]memberNotificationResponse, 0, len(history))
		for _, item := range history {
			items = append(items, notificationForMember(item))
		}
		if paged {
			total, countErr := svc.HistoryCount(r.Context(), memberID)
			if countErr != nil {
				writeNotificationError(w, countErr)
				return
			}
			httpx.JSON(w, http.StatusOK, map[string]any{"data": items, "total": total})
			return
		}
		httpx.JSON(w, http.StatusOK, items)
	}
}

func handleNotificationRead(svc *notification.Service, members memberAccountResolver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, err := tenancy.FromContext(r.Context())
		if err != nil || scope.UserID == "" {
			httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
			return
		}
		memberID, err := memberIDForUser(r.Context(), members, scope.UserID)
		if err != nil {
			httpx.Error(w, http.StatusConflict, "Your account is not linked to a member record yet.")
			return
		}
		item, err := svc.MarkRead(r.Context(), chi.URLParam(r, "id"), memberID)
		if err != nil {
			writeNotificationError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"id": item.ID.Hex(), "notificationId": item.ID.Hex(),
			"status": "READ", "readAt": item.ReadAt,
		})
	}
}

func handleNotificationDevice(d *deps.Deps, svc *notification.Service, members memberAccountResolver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, err := tenancy.FromContext(r.Context())
		if err != nil || scope.UserID == "" {
			httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
			return
		}
		var req struct {
			Token    string `json:"token"`
			Platform string `json:"platform"`
		}
		if err := decode(r, &req); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		claims, err := d.Tokens.Verify(r.Context(), bearer(r), token.KindAccess)
		if err != nil || claims.Family == "" || claims.UserID != scope.UserID {
			httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
			return
		}
		memberID, err := memberIDForUser(r.Context(), members, scope.UserID)
		if err != nil {
			httpx.Error(w, http.StatusConflict, "Your account is not linked to a member record yet.")
			return
		}
		if err := svc.RegisterDevice(r.Context(), memberID, claims.Family, req.Token, req.Platform); err != nil {
			writeNotificationError(w, err)
			return
		}
		httpx.JSON(w, http.StatusCreated, map[string]any{
			"token":      strings.TrimSpace(req.Token),
			"platform":   strings.ToLower(strings.TrimSpace(req.Platform)),
			"registered": true,
		})
	}
}

func writeNotificationError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, notification.ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "Notification not found.")
	case errors.Is(err, notification.ErrInvalidDevice), errors.Is(err, notification.ErrNoRecipient):
		httpx.Error(w, http.StatusBadRequest, "That device registration is not valid.")
	default:
		httpx.Error(w, http.StatusInternalServerError, "Notifications are unavailable right now.")
	}
}
