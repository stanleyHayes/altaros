package social

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// What a member receives is decided by PostView, and it used to embed *Post —
// so Go serialised the whole record into the congregation's feed. These tests
// need no database because the defect was never in the query; it was in what
// the shape of a struct implied.

// moderated is a post that has been reported and acted on, then restored — the
// state that leaked the most.
func moderated() *Post {
	at := time.Date(2026, 8, 2, 12, 0, 0, 0, time.UTC)
	return &Post{
		ID: bson.NewObjectID(), ChurchID: mongodb.ID("6a6d0a46536bf5e6e21ca17e"),
		AuthorID: mongodb.ID("6a6f3460a6b0e0738ca16496"), AuthorName: "Kwame Boateng",
		Content: "God provided school fees.", Type: TypeTestimony,
		LikesCount: 3, CommentsCount: 1, Status: StatusVisible,

		// The half that must never reach a member.
		ReportCount:    4,
		ModeratedBy:    mongodb.ID("6a6f3460a6b0e0738ca16493"),
		ModeratedAt:    &at,
		ModerationNote: "Checking with the author before it stays up.",

		CreatedAt: at, UpdatedAt: at,
	}
}

func TestTheFeedNeverCarriesModerationMetadata(t *testing.T) {
	raw, err := json.Marshal(viewOf(moderated(), true))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	body := string(raw)

	// A report count on a post is a pile-on signal, and it tells the church
	// that somebody reported a named person's testimony.
	for _, leaked := range []string{
		"reportCount", "moderatedBy", "moderatedAt", "moderationNote",
		"Checking with the author",
	} {
		if strings.Contains(body, leaked) {
			t.Errorf("the member-facing feed carries %q:\n  %s", leaked, body)
		}
	}
}

// The mobile normaliser REJECTS a post missing any of these, so trimming the
// view is only safe if the contract survives intact.
func TestTheViewKeepsEveryFieldTheClientContractRequires(t *testing.T) {
	raw, err := json.Marshal(viewOf(moderated(), true))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	for _, required := range []string{
		"id", "churchId", "authorId", "authorName", "content", "type",
		"likesCount", "commentsCount", "isLikedByMe", "createdAt",
	} {
		if _, ok := got[required]; !ok {
			t.Errorf("the client contract requires %q and the view omits it", required)
		}
	}
	if got["isLikedByMe"] != true {
		t.Errorf("isLikedByMe = %v, want the viewer's own state", got["isLikedByMe"])
	}
	if got["likesCount"] != float64(3) || got["commentsCount"] != float64(1) {
		t.Errorf("counts did not survive: %v / %v", got["likesCount"], got["commentsCount"])
	}
}

// The underlying record stays reachable inside the package, because the queue
// and the moderate response legitimately need it.
func TestAModeratorCanStillReachTheFullRecord(t *testing.T) {
	view := viewOf(moderated(), false)
	if view.Post == nil {
		t.Fatal("the view dropped the underlying record")
	}
	if view.Post.ModerationNote == "" || view.Post.ReportCount != 4 {
		t.Error("the underlying record lost its moderation state")
	}
}
