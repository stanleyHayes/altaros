package service

import (
	"errors"
	"fmt"
	"html"
	"net/http"
	"strings"
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
	svc := privacy.NewService(d.Mongo, d.Tokens)
	members := member.NewService(d.Mongo, d.Events, d.Config.DataRegion)

	return func(r chi.Router) {
		// --- public, unauthenticated ---
		//
		// Google Play requires a data-deletion route that is reachable WITHOUT
		// installing the app and without signing in, and App Review expects to
		// read the policy before it ever creates an account. Both are served
		// here rather than from the marketing site so that they exist wherever
		// the API is deployed — a store listing whose privacy URL 404s because
		// a separate frontend was not deployed is a rejection.
		// Restoring is deliberately PUBLIC: somebody inside the grace period
		// cannot sign in — that is the point of the lock — so requiring a
		// session to undo a mistaken deletion would make the window useless.
		// The reference is the credential, and it is random and single-purpose.
		r.Post("/privacy/restore", handleRestoreAccount(svc))

		r.Get("/privacy/policy", handlePublicPrivacyPolicy())
		r.Get("/privacy/data-deletion", handlePublicDataDeletion())

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

		receipt, err := svc.RequestDeletion(r.Context(), privacy.DeleteRequest{
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
		receipt, err := svc.RequestDeletion(r.Context(), privacy.DeleteRequest{
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

// handleRestoreAccount undoes a deletion inside the grace period.
func handleRestoreAccount(svc *privacy.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Reference string `json:"reference"`
			Workspace string `json:"workspace"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		receipt, err := svc.CancelDeletion(r.Context(), body.Reference)
		if err != nil {
			writePrivacyError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"restored": true, "reference": receipt.Reference,
			"message": "Your account is active again. Sign in as usual.",
		})
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

// publicPage renders a plain, self-contained HTML page.
//
// No stylesheet, no script, no font: a store reviewer on a slow connection,
// a regulator, and a member on a 2G phone all have to be able to read this,
// and every external asset is one more thing that can be unavailable when
// somebody is checking whether the policy exists.
func publicPage(w http.ResponseWriter, title, body string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%s — ALTAR OS</title>
<style>
 body{font:16px/1.65 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
      max-width:44rem;margin:0 auto;padding:2rem 1.25rem;color:#1b1b1b;background:#fff}
 h1{font-size:1.6rem;line-height:1.25} h2{font-size:1.1rem;margin-top:2rem}
 table{border-collapse:collapse;width:100%%;margin:1rem 0;font-size:.94rem}
 th,td{border:1px solid #d9e2de;padding:.5rem .6rem;text-align:left;vertical-align:top}
 th{background:#f4f8f5} code{background:#f4f8f5;padding:.1rem .3rem;border-radius:3px}
 .note{background:#f4f8f5;border-left:3px solid #197665;padding:.75rem 1rem;margin:1.25rem 0}
 @media(prefers-color-scheme:dark){
   body{background:#101413;color:#e8efec} th{background:#18211f}
   th,td{border-color:#2a3532} .note{background:#18211f} code{background:#18211f}}
</style>
</head><body>%s</body></html>`, title, body)
}

// handlePublicPrivacyPolicy states what is collected and why.
//
// Generated from privacy.Holdings — the same list the export and the deletion
// walk — so the published policy cannot drift from what the software does.
// A policy maintained by hand beside code that changes is a policy that
// becomes false without anybody noticing.
func handlePublicPrivacyPolicy() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var rows strings.Builder
		for _, h := range privacy.Holdings {
			fmt.Fprintf(&rows, "<tr><td>%s</td><td>%s</td><td>%s</td></tr>",
				html.EscapeString(h.Label),
				html.EscapeString(string(h.Disposition)),
				html.EscapeString(h.Because))
		}

		var retention strings.Builder
		for _, r := range privacy.RetentionDisclosure() {
			fmt.Fprintf(&retention, "<tr><td>%s</td><td>%d days</td><td>%s</td></tr>",
				html.EscapeString(r.Label), r.KeepForDays, html.EscapeString(r.Because))
		}

		publicPage(w, "Privacy", `
<h1>Privacy at ALTAR OS</h1>
<p>ALTAR OS is church management software. Your church is the
<strong>data controller</strong> — it decides what to collect about its members
and why. ALTAR OS is the <strong>data processor</strong>: we hold the data on
your church's behalf and act on its instructions. This page describes how the
software handles your data, under Ghana's Data Protection Act 2012 (Act 843).</p>

<div class="note"><strong>We do not sell your data, and we do not track you.</strong>
There is no advertising network, no analytics broker and no third-party tracker
in the apps. Nothing about you is shared between churches.</div>

<h2>What is held, and what happens if you delete your account</h2>
<p>This table is generated from the software itself, so it cannot fall out of
date with what the system actually does.</p>
<table><tr><th>Information</th><th>On deletion</th><th>Why</th></tr>`+
			rows.String()+`</table>

<h2>How long we keep things</h2>
<p>Act 843 s.24 says personal data must not be kept longer than is necessary.
These periods are enforced automatically, not merely written down.</p>
<table><tr><th>Information</th><th>Kept for</th><th>Why that long</th></tr>`+
			retention.String()+`</table>

<h2>Your rights under Act 843</h2>
<ul>
<li><strong>To know what is held</strong> (s.32) — in the app: Settings &rarr;
Privacy &rarr; Download my data.</li>
<li><strong>To have it corrected</strong> — edit your profile, or ask your
church office.</li>
<li><strong>To have it erased</strong> (s.33) — see
<a href="/api/v1/privacy/data-deletion">deleting your account</a>.</li>
<li><strong>To object to how it is used</strong> — contact your church, or
write to us at the address below.</li>
</ul>

<h2>Where your data lives</h2>
<p>Church data for Ghanaian churches is held in the Ghana region. We do not
move it outside the region without the church's instruction.</p>

<h2>Payments</h2>
<p>Giving is processed by <strong>Paystack</strong>. Each church is its own
merchant and money settles directly to the church — ALTAR OS never holds your
funds and never sees your card number.</p>

<h2>Contact</h2>
<p>Data protection: <a href="mailto:privacy@altaros.com">privacy@altaros.com</a><br>
Support: <a href="mailto:support@altaros.com">support@altaros.com</a></p>
<p>You also have the right to complain to Ghana's Data Protection Commission.</p>`)
	}
}

// handlePublicDataDeletion is the URL Google Play requires.
//
// It must work for somebody who has already uninstalled the app, which is why
// it explains the out-of-app route as prominently as the in-app one.
func handlePublicDataDeletion() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var kept strings.Builder
		for _, h := range privacy.Holdings {
			if h.Disposition == privacy.Erased {
				continue
			}
			fmt.Fprintf(&kept, "<li><strong>%s</strong> — %s</li>",
				html.EscapeString(h.Label), html.EscapeString(h.Because))
		}

		publicPage(w, "Delete your account", `
<h1>Deleting your ALTAR OS account</h1>

<h2>In the app</h2>
<p>Open <strong>Settings &rarr; Privacy &rarr; Delete my account</strong>. You
will be shown exactly what is removed and what is kept, and asked to type
<code>DELETE</code> to confirm. It happens immediately — there is no waiting
period and no need to contact anyone.</p>

<h2>If you have already uninstalled the app</h2>
<p>Email <a href="mailto:privacy@altaros.com">privacy@altaros.com</a> from the
address on your account, or write from the phone number on it, and say that you
want your account deleted. We complete the request within 30 days and email you
a reference when it is done.</p>

<h2>What is removed</h2>
<p>Your login, your profile, and everything personal: prayer requests, welfare
and pastoral records, posts and comments, attendance, serving rota, follow-up
notes, notification history and your registered devices. Deletion is
immediate and cannot be undone.</p>

<h2>What is kept, and why</h2>
<p>Not everything can lawfully be destroyed. These survive with
<strong>your name removed</strong> and no way to reconnect them to you:</p>
<ul>`+kept.String()+`</ul>

<div class="note">We say this plainly because you are entitled to know it before
you decide. An app that says &ldquo;all your data has been deleted&rdquo; while
keeping a named record of your giving would be lying to you about something
Act 843 gives you the right to ask about.</div>

<h2>Questions</h2>
<p><a href="mailto:privacy@altaros.com">privacy@altaros.com</a> &middot;
<a href="/api/v1/privacy/policy">Privacy policy</a></p>`)
	}
}
