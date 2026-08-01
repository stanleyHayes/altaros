package service

import (
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/auth"
	"github.com/hayfordstanley/altar-os/internal/domain/invitation"
	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/ratelimit"
	"github.com/hayfordstanley/altar-os/internal/platform/token"
)

// buildInvitation mounts invitations and direct user creation (WP-37).
func buildInvitation(d *deps.Deps) http.Handler { return standalone(invitationRoutes(d)) }

// invitationRoutes registers the endpoints that bring people into a church.
//
// This is requirement 9 — "the admin can create or invite a user with the
// initial role and other information like password where necessary" — and the
// two halves of it are genuinely different operations: an invitation lets the
// person set their own password, direct creation has the admin set it. Both
// carry a role, because requirement 4 says the role's permissions are assigned
// at creation or invitation time rather than afterwards.
func invitationRoutes(d *deps.Deps) routeSet {
	svc := invitation.NewService(d.Mongo)
	courier := newInvitationCourier(d)

	return func(r chi.Router) {
		// --- unauthenticated redemption ---
		//
		// Both take the token in a POST body rather than a URL. A GET with
		// ?token= puts a working credential into every access log, proxy log
		// and Referer header between the invitee and here — and the whole point
		// of hashing the token at rest is that a copy of the database is not a
		// copy of the credentials, which is undone if the logs hold them in
		// plaintext.
		r.With(throttle(d, ratelimit.RedeemInvitation)).
			Post("/invitations/preview", handlePreviewInvitation(svc))
		r.With(throttle(d, ratelimit.RedeemInvitation)).
			Post("/invitations/accept", handleAcceptInvitation(svc, d))

		// --- administration ---
		r.Group(func(r chi.Router) {
			r.Use(authenticated(d))
			r.Use(resolvePermissions(d))

			r.With(requirePermission(rbac.ResourceUser, rbac.ActionRead)).
				Get("/invitations", handleListInvitations(svc))

			r.With(requirePermission(rbac.ResourceUser, rbac.ActionCreate)).
				Post("/invitations", handleCreateInvitation(svc, courier, d))

			// Resending and revoking are guarded by user:create, not update or
			// delete. They are undoing or repeating your own invitation, and
			// requiring a second permission to cancel one would leave someone
			// able to issue a link they cannot take back.
			r.With(requirePermission(rbac.ResourceUser, rbac.ActionCreate)).
				Post("/invitations/{id}/resend", handleResendInvitation(svc, courier, d))
			r.With(requirePermission(rbac.ResourceUser, rbac.ActionCreate)).
				Delete("/invitations/{id}", handleRevokeInvitation(svc))

			r.With(requirePermission(rbac.ResourceUser, rbac.ActionCreate)).
				Post("/users", handleCreateUser(svc))
		})
	}
}

// invitationView is what an admin sees in the list.
//
// Never the token or its hash. `expired` is computed rather than stored,
// because nothing runs to flip a status when a date passes and a list showing
// week-old invitations as "pending" is a list nobody trusts.
type invitationView struct {
	*invitation.Invitation
	Expired bool `json:"expired"`
}

func handleListInvitations(svc *invitation.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		status := invitation.Status(r.URL.Query().Get("status"))

		list, err := svc.List(r.Context(), status)
		if err != nil {
			writeInvitationError(w, err)
			return
		}

		now := time.Now()
		out := make([]invitationView, 0, len(list))
		for i := range list {
			out = append(out, invitationView{
				Invitation: &list[i],
				Expired:    !list[i].Live(now),
			})
		}
		httpx.JSON(w, http.StatusOK, out)
	}
}

func handleCreateInvitation(svc *invitation.Service, courier *invitationCourier, d *deps.Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Email   string `json:"email"`
			Phone   string `json:"phone"`
			Name    string `json:"name"`
			RoleID  string `json:"roleId"`
			Message string `json:"message"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}

		inv, rawToken, err := svc.Invite(r.Context(), invitation.InviteInput{
			Email:   body.Email,
			Phone:   body.Phone,
			Name:    body.Name,
			RoleID:  body.RoleID,
			Message: body.Message,
		}, permissionsFrom(r.Context()))
		if err != nil {
			writeInvitationError(w, err)
			return
		}

		respondWithInvitation(w, r, svc, courier, d, inv, rawToken, http.StatusCreated)
	}
}

func handleResendInvitation(svc *invitation.Service, courier *invitationCourier, d *deps.Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		inv, rawToken, err := svc.Resend(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			writeInvitationError(w, err)
			return
		}
		respondWithInvitation(w, r, svc, courier, d, inv, rawToken, http.StatusOK)
	}
}

// respondWithInvitation delivers the link and answers the admin.
//
// A delivery failure is reported but does NOT fail the request, and the
// difference matters: the invitation is already created and its token already
// issued, so a 500 here would leave the admin believing nothing happened while
// a live invitation sits in the database blocking a retry on the unique index.
// Instead the response says plainly that it was not delivered and hands back
// the link, which is also the answer for a church whose email is not yet
// configured — the secretary copies it into WhatsApp.
func respondWithInvitation(
	w http.ResponseWriter,
	r *http.Request,
	_ *invitation.Service,
	courier *invitationCourier,
	d *deps.Deps,
	inv *invitation.Invitation,
	rawToken string,
	status int,
) {
	link := invitationLink(d, rawToken)

	delivered, deliveryErr := courier.deliver(r.Context(), inv, link)
	body := map[string]any{
		"invitation": inv,
		// Returned to the ADMIN who just issued it, over an authenticated
		// connection, and only at the moment of issue. This is the one place
		// the raw token exists outside the message that was sent.
		"link":      link,
		"delivered": delivered,
	}
	if deliveryErr != nil {
		d.Log.Warn("could not deliver an invitation",
			"invitation_id", inv.ID.Hex(), "error", deliveryErr.Error())
		body["deliveryError"] = "We could not send the invitation. Share the link below instead."
	}
	httpx.JSON(w, status, body)
}

func handleRevokeInvitation(svc *invitation.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := svc.Revoke(r.Context(), chi.URLParam(r, "id")); err != nil {
			writeInvitationError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"revoked": true})
	}
}

func handleCreateUser(svc *invitation.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Email    string `json:"email"`
			Phone    string `json:"phone"`
			Name     string `json:"name"`
			RoleID   string `json:"roleId"`
			Password string `json:"password"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}

		user, err := svc.Create(r.Context(), invitation.CreateInput{
			Email:    body.Email,
			Phone:    body.Phone,
			Name:     body.Name,
			RoleID:   body.RoleID,
			Password: body.Password,
		}, permissionsFrom(r.Context()))
		if err != nil {
			writeInvitationError(w, err)
			return
		}
		httpx.JSON(w, http.StatusCreated, map[string]any{
			"user": user,
			"note": "They will be asked to choose a new password the first time they sign in.",
		})
	}
}

func handlePreviewInvitation(svc *invitation.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Token string `json:"token"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}

		preview, err := svc.Preview(r.Context(), body.Token)
		if err != nil {
			writeInvitationError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, preview)
	}
}

// handleAcceptInvitation redeems a link and signs the person in.
//
// Tokens are issued here rather than sending them to the login page: they have
// just proved control of the invited address and chosen a password, and making
// them immediately type that password into a second form is a step that exists
// only because the implementation was easier that way.
func handleAcceptInvitation(svc *invitation.Service, d *deps.Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Token    string `json:"token"`
			Name     string `json:"name"`
			Phone    string `json:"phone"`
			Password string `json:"password"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}

		user, err := svc.Accept(r.Context(), body.Token, invitation.AcceptInput{
			Name:     body.Name,
			Phone:    body.Phone,
			Password: body.Password,
		})
		if err != nil {
			writeInvitationError(w, err)
			return
		}

		pair, err := d.Tokens.Issue(r.Context(), token.Identity{
			UserID:         user.ID.Hex(),
			ChurchID:       user.ChurchID.String(),
			OrganizationID: user.OrganizationID.String(),
			Role:           user.Role,
		})
		if err != nil {
			// The account exists and the invitation is spent. Say so rather
			// than returning a bare error, or they will try the link again and
			// be told it is invalid.
			d.Log.Error("could not issue tokens after accepting an invitation",
				"user_id", user.ID.Hex(), "error", err.Error())
			httpx.JSON(w, http.StatusCreated, map[string]any{
				"user": user,
				"note": "Your account was created. Please sign in.",
			})
			return
		}

		httpx.JSON(w, http.StatusCreated, auth.Result{User: user, Tokens: pair})
	}
}

// invitationLink builds the URL the invitee follows.
//
// The base comes from configuration, never from the request Host: an attacker
// who can set Host would otherwise choose where a genuine invitation email
// points, and the recipient has no way to tell — the mail really is from us.
func invitationLink(d *deps.Deps, rawToken string) string {
	base := "http://localhost:5173"
	if d != nil && d.Config != nil && d.Config.PublicAppURL != "" {
		base = d.Config.PublicAppURL
	}
	return base + "/invitations/accept?token=" + url.QueryEscape(rawToken)
}

func writeInvitationError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, invitation.ErrNotFound):
		httpx.Error(w, http.StatusNotFound,
			"This invitation link is not valid. It may have expired or already been used.")

	case errors.Is(err, invitation.ErrAlreadyMember):
		httpx.Error(w, http.StatusConflict,
			"There is already an account using that email address or phone number.")

	case errors.Is(err, invitation.ErrAlreadyInvited):
		httpx.Error(w, http.StatusConflict,
			"That person already has a pending invitation. Resend it instead of creating another.")

	case errors.Is(err, invitation.ErrContactRequired):
		httpx.Error(w, http.StatusBadRequest, "Enter an email address or a phone number.")

	case errors.Is(err, invitation.ErrRoleRequired):
		httpx.Error(w, http.StatusBadRequest, "Choose a role for this person.")

	case errors.Is(err, invitation.ErrNameRequired):
		httpx.Error(w, http.StatusBadRequest, "Enter a name.")

	case errors.Is(err, invitation.ErrEmailInvalid):
		httpx.Error(w, http.StatusBadRequest, "That email address does not look right.")

	case errors.Is(err, invitation.ErrPhoneInvalid):
		httpx.Error(w, http.StatusBadRequest, "That phone number does not look right.")

	case errors.Is(err, invitation.ErrPasswordWeak):
		httpx.Error(w, http.StatusBadRequest, "Choose a password of at least 8 characters.")

	case errors.Is(err, rbac.ErrRoleNotFound):
		httpx.Error(w, http.StatusBadRequest, "That role no longer exists.")

	case errors.Is(err, rbac.ErrEscalation):
		// Name the permissions. A bare "you cannot grant what you do not hold"
		// leaves an admin with no idea which of the role's permissions was the
		// problem, and the answer is often a read they would happily have.
		var escalation *rbac.EscalationError
		if errors.As(err, &escalation) {
			httpx.Error(w, http.StatusForbidden,
				"You cannot invite someone into this role: it includes "+
					strings.Join(escalation.Missing, ", ")+
					", which you do not have yourself.")
			return
		}
		httpx.Error(w, http.StatusForbidden,
			"You cannot invite someone into a role with permissions you do not hold yourself.")

	default:
		writeRBACError(w, err)
	}
}
