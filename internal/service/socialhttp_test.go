package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/domain/member"
	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/domain/social"
	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

type socialIdentityResolver struct{}

func (socialIdentityResolver) ByUserID(_ context.Context, userID string) (*member.Member, error) {
	oid, err := bson.ObjectIDFromHex(userID)
	if err != nil {
		return nil, member.ErrNotFound
	}
	return &member.Member{ID: oid}, nil
}

// These test the HANDLERS rather than the service, because the handler is where
// "is this caller a moderator" is decided — and a service that enforces the
// rule perfectly is no help if the handler hands it `true` for everybody.
//
// That gap is not hypothetical. The same one in discipleshiphttp.go let any
// member close anybody's follow-up, and a mutation that made this file treat
// every reader as a moderator initially survived because nothing here was
// tested at this level.

const (
	sChurch    = "6a6d0a46536bf5e6e21cf001"
	sAuthor    = "6a6f3460a6b0e0738cf10001"
	sOther     = "6a6f3460a6b0e0738cf10002"
	sModerator = "6a6f3460a6b0e0738cf10003"
)

func socialTestService(t *testing.T) *social.Service {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	db, err := mongodb.Connect(ctx, config.MongoConfig{
		URI:            testsupport.MongoURI(),
		Database:       "altar_test_social_http",
		ConnectTimeout: 3 * time.Second,
	})
	if err != nil {
		testsupport.SkipOrFail(t, "MongoDB", err)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = db.Database().Drop(c)
		_ = db.Close(c)
	})

	svc := social.NewService(db)
	if err := svc.EnsureIndexes(socialScope(sAuthor)); err != nil {
		t.Fatalf("EnsureIndexes: %v", err)
	}
	return svc
}

func socialScope(userID string) context.Context {
	return tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: sChurch, UserID: userID, Role: "MEMBER",
	})
}

func socialRequest(t *testing.T, method, target, body, userID string, holds ...rbac.Permission) *http.Request {
	t.Helper()
	if body == "" {
		body = "{}"
	}
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	ctx := tenancy.WithScope(req.Context(), tenancy.Scope{
		ChurchID: sChurch, UserID: userID, Role: "MEMBER",
	})
	return req.WithContext(withPermissions(ctx, rbac.NewSet(holds...)))
}

func withParams(req *http.Request, kv ...string) *http.Request {
	rctx := chi.NewRouteContext()
	for i := 0; i+1 < len(kv); i += 2 {
		rctx.URLParams.Add(kv[i], kv[i+1])
	}
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

// seedThread returns a hidden post and the id of a comment under it.
func seedThread(t *testing.T, svc *social.Service, hide bool) (postID, commentID string) {
	t.Helper()
	post, err := svc.CreatePost(socialScope(sAuthor), social.PostInput{
		Author:  social.Author{ID: sAuthor, Name: "Ama"},
		Content: "Something contested.", Type: social.TypeGeneral,
	})
	if err != nil {
		t.Fatalf("CreatePost: %v", err)
	}
	postID = post.ID.Hex()

	comment, err := svc.Comment(socialScope(sOther), postID,
		social.Author{ID: sOther, Name: "Kwame"}, "The argument starts here.")
	if err != nil {
		t.Fatalf("Comment: %v", err)
	}
	commentID = comment.ID.Hex()

	if hide {
		if _, err := svc.Moderate(socialScope(sModerator), postID,
			social.ActionHide, sModerator, ""); err != nil {
			t.Fatalf("Moderate: %v", err)
		}
	}
	return postID, commentID
}

// The handler must decide "moderator" from the caller's permissions, not hand
// everybody the moderator path.
func TestTheCommentsHandlerDoesNotTreatEveryReaderAsAModerator(t *testing.T) {
	svc := socialTestService(t)
	postID, _ := seedThread(t, svc, true)

	// An ordinary member holding nothing.
	req := withParams(socialRequest(t, http.MethodGet,
		"/social/posts/"+postID+"/comments", "", sOther), "id", postID)
	rec := httptest.NewRecorder()
	handleComments(svc)(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("a member read a hidden post's thread: status %d, body %s",
			rec.Code, rec.Body.String())
	}

	// A moderator holding social:read.
	req = withParams(socialRequest(t, http.MethodGet,
		"/social/posts/"+postID+"/comments", "", sModerator,
		rbac.NewPermission(rbac.ResourceSocial, rbac.ActionRead)), "id", postID)
	rec = httptest.NewRecorder()
	handleComments(svc)(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("a moderator could not read a hidden thread: %d %s",
			rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "The argument starts here.") {
		t.Errorf("the moderator's view is missing the thread: %s", rec.Body.String())
	}
}

// The same for removal: the handler must not grant moderator rights to all.
func TestTheDeleteCommentHandlerDoesNotTreatEveryCallerAsAModerator(t *testing.T) {
	svc := socialTestService(t)
	postID, commentID := seedThread(t, svc, false)

	// A member who wrote neither the post nor the comment.
	req := withParams(socialRequest(t, http.MethodDelete,
		"/social/posts/"+postID+"/comments/"+commentID, "", sAuthor),
		"id", postID, "commentId", commentID)
	rec := httptest.NewRecorder()
	handleDeleteComment(svc, socialIdentityResolver{})(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("a stranger removed somebody else's comment: %d %s",
			rec.Code, rec.Body.String())
	}

	// Still there.
	comments, _, err := svc.Comments(socialScope(sOther), postID, 1, 20, false)
	if err != nil {
		t.Fatalf("Comments: %v", err)
	}
	if len(comments) != 1 {
		t.Fatal("the comment was removed by the failed attempt")
	}

	// The comment's own author may.
	req = withParams(socialRequest(t, http.MethodDelete,
		"/social/posts/"+postID+"/comments/"+commentID, "", sOther),
		"id", postID, "commentId", commentID)
	rec = httptest.NewRecorder()
	handleDeleteComment(svc, socialIdentityResolver{})(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("the author could not remove their own comment: %d %s",
			rec.Code, rec.Body.String())
	}
}

// A moderator removes anybody's comment.
func TestAModeratorRemovesAnybodysCommentOverHTTP(t *testing.T) {
	svc := socialTestService(t)
	postID, commentID := seedThread(t, svc, false)

	req := withParams(socialRequest(t, http.MethodDelete,
		"/social/posts/"+postID+"/comments/"+commentID, "", sModerator,
		rbac.NewPermission(rbac.ResourceSocial, rbac.ActionUpdate)),
		"id", postID, "commentId", commentID)
	rec := httptest.NewRecorder()
	handleDeleteComment(svc, socialIdentityResolver{})(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("a moderator could not remove a comment: %d %s",
			rec.Code, rec.Body.String())
	}
}

// A hidden post reads as absent to a member and present to a moderator, and
// the handler is what decides which.
func TestTheGetPostHandlerHidesAModeratedPostFromMembers(t *testing.T) {
	svc := socialTestService(t)
	postID, _ := seedThread(t, svc, true)

	req := withParams(socialRequest(t, http.MethodGet,
		"/social/posts/"+postID, "", sOther), "id", postID)
	rec := httptest.NewRecorder()
	handleGetPost(svc, socialIdentityResolver{})(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("a member read a hidden post: %d %s", rec.Code, rec.Body.String())
	}

	req = withParams(socialRequest(t, http.MethodGet,
		"/social/posts/"+postID, "", sModerator,
		rbac.NewPermission(rbac.ResourceSocial, rbac.ActionRead)), "id", postID)
	rec = httptest.NewRecorder()
	handleGetPost(svc, socialIdentityResolver{})(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("a moderator could not read a hidden post: %d %s",
			rec.Code, rec.Body.String())
	}
}

// Deleting a POST is author-or-moderator, and again the handler decides.
func TestTheDeletePostHandlerDoesNotTreatEveryCallerAsAModerator(t *testing.T) {
	svc := socialTestService(t)
	postID, _ := seedThread(t, svc, false)

	req := withParams(socialRequest(t, http.MethodDelete,
		"/social/posts/"+postID, "", sOther), "id", postID)
	rec := httptest.NewRecorder()
	handleDeletePost(svc, socialIdentityResolver{})(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("a stranger removed somebody else's post: %d %s",
			rec.Code, rec.Body.String())
	}

	post, err := svc.PostByID(socialScope(sAuthor), postID, sAuthor)
	if err != nil {
		t.Fatalf("PostByID: %v", err)
	}
	if post.Status != social.StatusVisible {
		t.Fatalf("the post is %s after a refused deletion", post.Status)
	}
}
