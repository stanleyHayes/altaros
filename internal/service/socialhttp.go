package service

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/domain/social"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// buildSocial mounts the congregation feed (WP-24).
func buildSocial(d *deps.Deps) http.Handler { return standalone(socialRoutes(d)) }

// socialRoutes registers the feed and its moderation.
//
// The guard split is the design. Reading the feed, posting, commenting, liking
// and reporting carry NO permission: they are things a member of a congregation
// does, the same way giving is, and putting them behind a permission would mean
// a church had to grant its own congregation the right to speak. Moderation
// carries `social:update`, which the Staff role holds — the group that actually
// does this work, rather than an administrator who should not be reading every
// report by default.
func socialRoutes(d *deps.Deps) routeSet {
	svc := social.NewService(d.Mongo)
	names := newMemberNames(d)

	return func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(authenticated(d))
			r.Use(resolvePermissions(d))

			// --- what a member does ---
			r.Get("/social/feed", handleFeed(svc))
			r.Get("/social/posts/{id}", handleGetPost(svc))
			r.Post("/social/posts", handleCreatePost(svc, names))
			r.Delete("/social/posts/{id}", handleDeletePost(svc))

			r.Post("/social/posts/{id}/like", handleLike(svc))
			r.Delete("/social/posts/{id}/like", handleUnlike(svc))

			r.Get("/social/posts/{id}/comments", handleComments(svc))
			r.Post("/social/posts/{id}/comments", handleAddComment(svc, names))

			r.Post("/social/posts/{id}/report", handleReportPost(svc))

			// --- what a moderator does ---
			r.With(requirePermission(rbac.ResourceSocial, rbac.ActionRead)).
				Get("/social/moderation/queue", handleModerationQueue(svc))
			r.With(requirePermission(rbac.ResourceSocial, rbac.ActionRead)).
				Get("/social/posts/{id}/reports", handlePostReports(svc))
			r.With(requirePermission(rbac.ResourceSocial, rbac.ActionUpdate)).
				Post("/social/posts/{id}/moderate", handleModerate(svc))
		})
	}
}

// authorFrom builds the author stamped onto a post or comment.
//
// The name is looked up rather than taken from the request, because a client
// that supplies its own display name can post as somebody else — and on a
// church feed, a post appearing under the pastor's name is the whole attack.
func authorFrom(r *http.Request, names *memberNames) (social.Author, error) {
	scope, err := callerScope(r)
	if err != nil {
		return social.Author{}, err
	}
	author := social.Author{ID: scope.UserID}
	if name, avatar := names.lookup(r.Context(), scope.UserID); name != "" {
		author.Name, author.AvatarURL = name, avatar
	}
	return author, nil
}

// paging reads page and limit from the query string.
func paging(r *http.Request) (page, limit int) {
	page, _ = strconv.Atoi(r.URL.Query().Get("page"))
	limit, _ = strconv.Atoi(r.URL.Query().Get("limit"))
	return page, limit
}

func handleFeed(svc *social.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, err := callerScope(r)
		if err != nil {
			writeSocialError(w, err)
			return
		}
		page, limit := paging(r)
		posts, total, err := svc.Feed(r.Context(), scope.UserID, page, limit)
		if err != nil {
			writeSocialError(w, err)
			return
		}
		// `data` and `total`, which is the envelope the shared contract and
		// both clients already expect. The mobile normaliser rejects a page
		// carrying more rows than it asked for, so the service's clamp is what
		// keeps this renderable.
		httpx.JSON(w, http.StatusOK, map[string]any{"data": posts, "total": total})
	}
}

func handleGetPost(svc *social.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, err := callerScope(r)
		if err != nil {
			writeSocialError(w, err)
			return
		}
		post, err := svc.PostByID(r.Context(), chi.URLParam(r, "id"), scope.UserID)
		if err != nil {
			writeSocialError(w, err)
			return
		}
		// A hidden or removed post is not readable by an ordinary member, and
		// says "not found" rather than "moderated" — see the comment on Feed.
		if !post.Status.OnFeed() && !Can(r, rbac.ResourceSocial, rbac.ActionRead) {
			httpx.Error(w, http.StatusNotFound, "That post does not exist.")
			return
		}
		httpx.JSON(w, http.StatusOK, post)
	}
}

func handleCreatePost(svc *social.Service, names *memberNames) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Content  string `json:"content"`
			Type     string `json:"type"`
			ImageURL string `json:"imageUrl"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		author, err := authorFrom(r, names)
		if err != nil {
			writeSocialError(w, err)
			return
		}

		post, err := svc.CreatePost(r.Context(), social.PostInput{
			Author:   author,
			Content:  body.Content,
			Type:     social.Type(body.Type),
			ImageURL: body.ImageURL,
		})
		if err != nil {
			writeSocialError(w, err)
			return
		}
		httpx.JSON(w, http.StatusCreated, post)
	}
}

func handleDeletePost(svc *social.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, err := callerScope(r)
		if err != nil {
			writeSocialError(w, err)
			return
		}
		err = svc.DeletePost(r.Context(), chi.URLParam(r, "id"), scope.UserID,
			Can(r, rbac.ResourceSocial, rbac.ActionUpdate))
		if err != nil {
			writeSocialError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"deleted": true})
	}
}

func handleLike(svc *social.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, err := callerScope(r)
		if err != nil {
			writeSocialError(w, err)
			return
		}
		count, err := svc.Like(r.Context(), chi.URLParam(r, "id"), scope.UserID)
		if err != nil {
			writeSocialError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"likesCount": count})
	}
}

func handleUnlike(svc *social.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, err := callerScope(r)
		if err != nil {
			writeSocialError(w, err)
			return
		}
		count, err := svc.Unlike(r.Context(), chi.URLParam(r, "id"), scope.UserID)
		if err != nil {
			writeSocialError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"likesCount": count})
	}
}

func handleComments(svc *social.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		page, limit := paging(r)
		comments, total, err := svc.Comments(r.Context(), chi.URLParam(r, "id"), page, limit)
		if err != nil {
			writeSocialError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"data": comments, "total": total})
	}
}

func handleAddComment(svc *social.Service, names *memberNames) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Content string `json:"content"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		author, err := authorFrom(r, names)
		if err != nil {
			writeSocialError(w, err)
			return
		}
		comment, err := svc.Comment(r.Context(), chi.URLParam(r, "id"), author, body.Content)
		if err != nil {
			writeSocialError(w, err)
			return
		}
		httpx.JSON(w, http.StatusCreated, comment)
	}
}

func handleReportPost(svc *social.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Reason string `json:"reason"`
			Detail string `json:"detail"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		scope, err := callerScope(r)
		if err != nil {
			writeSocialError(w, err)
			return
		}

		report, err := svc.Report(r.Context(), social.ReportInput{
			PostID:     chi.URLParam(r, "id"),
			ReporterID: scope.UserID,
			Reason:     social.ReportReason(body.Reason),
			Detail:     body.Detail,
		})
		if err != nil {
			writeSocialError(w, err)
			return
		}
		// The reporter is told it was received, and nothing about what happens
		// next: a member who can watch a report's progress can work out who
		// else reported, and a moderator's decision is not the reporter's to
		// review.
		httpx.JSON(w, http.StatusCreated, map[string]any{
			"reported": true, "reportId": report.ID.Hex(),
		})
	}
}

func handleModerationQueue(svc *social.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		page, limit := paging(r)
		openOnly := r.URL.Query().Get("all") != "true"
		items, err := svc.Queue(r.Context(), openOnly, page, limit)
		if err != nil {
			writeSocialError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"data": items, "total": len(items)})
	}
}

func handlePostReports(svc *social.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		reports, err := svc.ReportsFor(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			writeSocialError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"data": reports, "total": len(reports)})
	}
}

func handleModerate(svc *social.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Action string `json:"action"`
			Note   string `json:"note"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		scope, err := callerScope(r)
		if err != nil {
			writeSocialError(w, err)
			return
		}
		post, err := svc.Moderate(r.Context(), chi.URLParam(r, "id"),
			social.Action(body.Action), scope.UserID, body.Note)
		if err != nil {
			writeSocialError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"post": post})
	}
}

// writeSocialError maps a domain error onto a status and a sentence.
func writeSocialError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, social.ErrPostNotFound):
		httpx.Error(w, http.StatusNotFound, "That post does not exist.")
	case errors.Is(err, social.ErrCommentNotFound):
		httpx.Error(w, http.StatusNotFound, "That comment does not exist.")
	case errors.Is(err, social.ErrReportNotFound):
		httpx.Error(w, http.StatusNotFound, "That report does not exist.")
	case errors.Is(err, social.ErrPostHidden):
		// Deliberately the same sentence as "not found". A member who can tell
		// a moderated post from a deleted one can work out that a moderator
		// acted, which is the start of the argument in public that moderation
		// exists to avoid.
		httpx.Error(w, http.StatusNotFound, "That post does not exist.")
	case errors.Is(err, social.ErrContentRequired):
		httpx.Error(w, http.StatusBadRequest, "There is nothing to post.")
	case errors.Is(err, social.ErrContentTooLong):
		httpx.Error(w, http.StatusBadRequest, "That is longer than a post may be.")
	case errors.Is(err, social.ErrTypeInvalid):
		httpx.Error(w, http.StatusBadRequest,
			"Choose whether this is a post, a testimony or a praise report.")
	case errors.Is(err, social.ErrAuthorRequired):
		httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
	case errors.Is(err, social.ErrNotAuthor):
		httpx.Error(w, http.StatusNotFound, "That post does not exist.")
	case errors.Is(err, social.ErrReasonRequired):
		httpx.Error(w, http.StatusBadRequest, "Say what is wrong with this post.")
	case errors.Is(err, social.ErrAlreadyReported):
		httpx.Error(w, http.StatusConflict, "You have already reported this post.")
	case errors.Is(err, social.ErrImageNotAllowed):
		httpx.Error(w, http.StatusBadRequest,
			"Images have to be uploaded through the app.")
	case errors.Is(err, social.ErrActionInvalid):
		httpx.Error(w, http.StatusBadRequest, "That moderation action is not recognised.")
	case errors.Is(err, tenancy.ErrNoTenant):
		httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
	default:
		httpx.Error(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
	}
}
