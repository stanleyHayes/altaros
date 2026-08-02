package service

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/domain/auth"
	"github.com/hayfordstanley/altar-os/internal/domain/social"
	"github.com/hayfordstanley/altar-os/internal/platform/token"
)

func socialMemberRequest(t *testing.T, router http.Handler, access, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("encode request: %v", err)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(raw))
	req.Header.Set("Authorization", "Bearer "+access)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestSocialHTTPBridgesAccountSessionToRosterMemberIdentity(t *testing.T) {
	db, churchID, userID, memberID := notificationHTTPFixture(t)
	d := newTestDeps(t)
	d.Mongo = db
	d.Config.DataRegion = "GH"
	churchOID, _ := bson.ObjectIDFromHex(churchID)
	userOID, _ := bson.ObjectIDFromHex(userID)
	if _, err := db.Global(auth.Collection).InsertOne(context.Background(), bson.M{
		"_id": userOID, "churchId": churchOID, "name": "Ama Mensah",
		"email": "ama@example.com", "phone": "+233241234567", "role": RoleMember,
		"createdAt": time.Now().UTC(), "updatedAt": time.Now().UTC(),
	}); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	router := standalone(socialRoutes(d))
	access := tokenFor(t, d, token.Identity{UserID: userID, ChurchID: churchID, Role: RoleMember})

	created := socialMemberRequest(t, router, access, http.MethodPost, "/social/posts", map[string]any{
		"content": "Grace carried us this week.", "type": "general",
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", created.Code, created.Body.String())
	}
	var postEnvelope struct {
		Data struct {
			ID, AuthorID string
		} `json:"data"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &postEnvelope); err != nil {
		t.Fatalf("decode post: %v", err)
	}
	if postEnvelope.Data.ID == "" || postEnvelope.Data.AuthorID != memberID || postEnvelope.Data.AuthorID == userID {
		t.Fatalf("post identity = %+v, want member %q and never account %q", postEnvelope.Data, memberID, userID)
	}

	commented := socialMemberRequest(t, router, access, http.MethodPost,
		"/social/posts/"+postEnvelope.Data.ID+"/comments", map[string]string{"content": "Amen."})
	if commented.Code != http.StatusCreated {
		t.Fatalf("comment status = %d, body = %s", commented.Code, commented.Body.String())
	}
	liked := socialMemberRequest(t, router, access, http.MethodPost,
		"/social/posts/"+postEnvelope.Data.ID+"/like", nil)
	if liked.Code != http.StatusOK {
		t.Fatalf("like status = %d, body = %s", liked.Code, liked.Body.String())
	}
	reported := socialMemberRequest(t, router, access, http.MethodPost,
		"/social/posts/"+postEnvelope.Data.ID+"/report", map[string]string{"reason": "other", "detail": "Please review this."})
	if reported.Code != http.StatusCreated {
		t.Fatalf("report status = %d, body = %s", reported.Code, reported.Body.String())
	}

	postOID, _ := bson.ObjectIDFromHex(postEnvelope.Data.ID)
	ctx := context.Background()
	var comment social.Comment
	if err := db.Global(social.CommentCollection).FindOne(ctx, bson.M{"postId": postOID}).Decode(&comment); err != nil {
		t.Fatalf("read comment: %v", err)
	}
	var like social.Like
	if err := db.Global(social.LikeCollection).FindOne(ctx, bson.M{"postId": postOID}).Decode(&like); err != nil {
		t.Fatalf("read like: %v", err)
	}
	var report social.Report
	if err := db.Global(social.ReportCollection).FindOne(ctx, bson.M{"postId": postOID}).Decode(&report); err != nil {
		t.Fatalf("read report: %v", err)
	}
	if comment.AuthorID.String() != memberID || like.MemberID.String() != memberID || report.ReporterID.String() != memberID {
		t.Fatalf("social rows did not retain member ownership: comment=%q like=%q report=%q want=%q",
			comment.AuthorID, like.MemberID, report.ReporterID, memberID)
	}
}
