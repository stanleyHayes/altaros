package service

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/member"
	"github.com/hayfordstanley/altar-os/internal/domain/privacy"
	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// buildPrivacy mounts data subject rights.
func buildPrivacy(d *deps.Deps) http.Handler { return standalone(privacyRoutes(d)) }

// privacyRoutes registers export and deletion.
//
// # These are OWNERSHIP routes, not permission routes
//
// A member exporting or deleting their own data holds nothing that would
// satisfy a permission, and requiring one would make the right conditional on
// the church granting it — which is not what Act 843 s.32 says, and not what
// App Store Guideline 5.1.1(v) accepts. Somebody acting on ANOTHER person's
// data needs `member:delete`, and that is a different act entirely.
func privacyRoutes(d *deps.Deps) routeSet {
	svc := privacy.NewService(d.Mongo)
	members := member.NewService(d.Mongo, d.Events, d.Config.DataRegion)

	return func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(authenticated(d))
			r.Use(resolvePermissions(d))

			// Act 843 s.32 — the right to know what is held.
			r.Get("/privacy/me/export", handlePrivacyExport(svc, members))

			// Apple 5.1.1(v) — reachable from inside the app, and it must
			// actually delete rather than deactivate.
			r.Post("/privacy/me/delete", handlePrivacyDeleteSelf(svc, members))

			// What the account-deletion screen shows BEFORE the confirm
			// button, so nobody agrees to something they were not told.
			r.Get("/privacy/deletion-preview", handleDeletionPreview())

			// An administrator acting for somebody else — a different act,
			// and a permission rather than ownership.
			r.With(requirePermission(rbac.ResourceMember, rbac.ActionDelete)).
				Post("/privacy/members/{memberId}/delete", handlePrivacyDeleteMember(svc, members))
		})
	}
}

// callerIdentity resolves the signed-in caller to BOTH of their identifiers.
//
// A person has two, and they are not interchangeable: the login they signed in
// with, and the member record almost every church record points at. Using the
// login id alone matches nothing outside `users` — the deletion reports success
// and leaves the person's giving, welfare and social history untouched.
func callerIdentity(r *http.Request, members *member.Service) (memberID, userID string, ok bool) {
	scope, err := callerScope(r)
	if err != nil || scope.UserID == "" {
		return "", "", false
	}
	found, err := members.ByUserID(r.Context(), scope.UserID)
	if err != nil {
		// A login with no member record yet. The account can still be
		// deleted; there is simply nothing on the member side to remove.
		return scope.UserID, scope.UserID, true
	}
	return found.ID.Hex(), scope.UserID, true
}

func handlePrivacyExport(svc *privacy.Service, members *member.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		memberID, userID, ok := callerIdentity(r, members)
		if !ok {
			httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
			return
		}
		out, err := svc.ExportFor(r.Context(), memberID, userID)
		if err != nil {
			writePrivacyError(w, err)
			return
		}

		// Offered as a download rather than a page. A data export is something
		// a person keeps, and Act 843 s.32 is about giving them the data, not
		// showing it to them once.
		w.Header().Set("Content-Disposition",
			fmt.Sprintf(`attachment; filename="altar-os-my-data-%s.json"`,
				time.Now().UTC().Format("2006-01-02")))
		httpx.JSON(w, http.StatusOK, out)
	}
}

// handleDeletionPreview returns what deletion will and will not remove.
//
// Served unauthenticated-safe content — it is the same for everybody, because
// it describes the POLICY rather than the person. Both stores expect this text
// to exist somewhere a reviewer can read it.
func handleDeletionPreview() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]any{
			"summary": "Deleting your account removes your login, your profile " +
				"and everything personal we hold about you. Your church's " +
				"financial records are kept, with your name removed, because " +
				"the law requires the church to keep six years of accounts.",
			"whatWeHold":       privacy.Holdings,
			"confirmationText": "DELETE",
			"irreversible":     true,
		})
	}
}

func handlePrivacyDeleteSelf(svc *privacy.Service, members *member.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Confirm string `json:"confirm"`
		}
		_ = decode(r, &body)

		memberID, userID, ok := callerIdentity(r, members)
		if !ok {
			httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
			return
		}

		receipt, err := svc.DeleteAccount(r.Context(), privacy.DeleteRequest{
			MemberID: memberID,
			UserID:   userID,
			// Typed confirmation, not a checkbox. This is irreversible and
			// takes the person's giving history out of their own reach.
			Confirmed:   body.Confirm == "DELETE",
			SelfService: true,
			ActorID:     userID,
		})
		if err != nil {
			writePrivacyError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"receipt": receipt})
	}
}

func handlePrivacyDeleteMember(svc *privacy.Service, members *member.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Confirm string `json:"confirm"`
		}
		_ = decode(r, &body)

		scope, err := callerScope(r)
		if err != nil {
			writePrivacyError(w, err)
			return
		}
		target := chi.URLParam(r, "memberId")
		userID := target
		if m, err := members.ByID(r.Context(), target); err == nil && m.UserID != "" {
			userID = m.UserID.String()
		}
		receipt, err := svc.DeleteAccount(r.Context(), privacy.DeleteRequest{
			MemberID:    target,
			UserID:      userID,
			Confirmed:   body.Confirm == "DELETE",
			SelfService: false,
			ActorID:     scope.UserID,
		})
		if err != nil {
			writePrivacyError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"receipt": receipt})
	}
}

func writePrivacyError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, privacy.ErrMemberRequired):
		httpx.Error(w, http.StatusBadRequest, "Say whose data this is about.")
	case errors.Is(err, privacy.ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "Not found.")
	case errors.Is(err, privacy.ErrConfirmationRequired):
		httpx.Error(w, http.StatusBadRequest,
			`Type DELETE to confirm. This cannot be undone.`)
	case errors.Is(err, privacy.ErrNotYours):
		httpx.Error(w, http.StatusNotFound, "Not found.")
	case errors.Is(err, tenancy.ErrNoTenant):
		httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
	default:
		httpx.Error(w, http.StatusInternalServerError,
			"Something went wrong. Your data has not been changed.")
	}
}
