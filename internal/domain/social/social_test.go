package social

import (
	"context"
	"testing"
	"time"

	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

const (
	churchA = "6a6d0a46536bf5e6e21ca101"
	churchB = "6a6d0a46536bf5e6e21ca102"

	ama    = "6a6f3460a6b0e0738ca10001"
	kwame  = "6a6f3460a6b0e0738ca10002"
	pastor = "6a6f3460a6b0e0738ca10003"
)

type harness struct {
	svc *Service
	ctx context.Context
	// other is a DIFFERENT church, present in every test file here because
	// "all tenant-scoped" is half of WP-24's acceptance criterion.
	other context.Context
}

func newHarness(t *testing.T) *harness {
	t.Helper()

	uri := testsupport.MongoURI()
	connectCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	db, err := mongodb.Connect(connectCtx, config.MongoConfig{
		URI:            uri,
		Database:       "altar_test_social",
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

	h := &harness{svc: NewService(db)}
	h.ctx = tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: churchA, UserID: ama, Role: "MEMBER",
	})
	h.other = tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: churchB, UserID: kwame, Role: "MEMBER",
	})
	if err := h.svc.EnsureIndexes(h.ctx); err != nil {
		t.Fatalf("EnsureIndexes: %v", err)
	}
	return h
}

// as returns a context for another member of the same church.
func (h *harness) as(userID string) context.Context {
	return tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: churchA, UserID: userID, Role: "MEMBER",
	})
}

func (h *harness) post(t *testing.T, author, content string) *PostView {
	t.Helper()
	out, err := h.svc.CreatePost(h.as(author), PostInput{
		Author:  Author{ID: author, Name: "Author " + author},
		Content: content, Type: TypeGeneral,
	})
	if err != nil {
		t.Fatalf("CreatePost: %v", err)
	}
	return out
}

// WP-24 acceptance, in one test and in order: "post → comment → like → report
// → moderator action, all tenant-scoped."
func TestPostCommentLikeReportModerate(t *testing.T) {
	h := newHarness(t)

	// --- post ---
	created := h.post(t, ama, "God has been faithful this year.")
	if created.LikesCount != 0 || created.CommentsCount != 0 {
		t.Fatalf("a new post starts at %d likes and %d comments",
			created.LikesCount, created.CommentsCount)
	}
	if created.Status != StatusVisible {
		t.Fatalf("a new post is %s, want visible", created.Status)
	}
	id := created.ID.Hex()

	// --- comment ---
	if _, err := h.svc.Comment(h.as(kwame), id,
		Author{ID: kwame, Name: "Kwame"}, "Amen!"); err != nil {
		t.Fatalf("Comment: %v", err)
	}
	comments, total, err := h.svc.Comments(h.ctx, id, 1, 20)
	if err != nil {
		t.Fatalf("Comments: %v", err)
	}
	if len(comments) != 1 || total != 1 {
		t.Fatalf("got %d comments (total %d), want 1", len(comments), total)
	}
	if comments[0].PostID.String() != id {
		// The mobile normaliser rejects a comment whose postId is not the one
		// it asked for, so this is a contract requirement, not a nicety.
		t.Errorf("comment carries postId %q, want %q", comments[0].PostID, id)
	}

	// --- like ---
	count, err := h.svc.Like(h.as(kwame), id, kwame)
	if err != nil {
		t.Fatalf("Like: %v", err)
	}
	if count != 1 {
		t.Fatalf("likes = %d after one like", count)
	}

	after, err := h.svc.PostByID(h.as(kwame), id, kwame)
	if err != nil {
		t.Fatalf("PostByID: %v", err)
	}
	if !after.IsLikedByMe {
		t.Error("the member who liked it does not see isLikedByMe")
	}
	if after.CommentsCount != 1 {
		t.Errorf("commentsCount = %d, want 1", after.CommentsCount)
	}
	// And the author, who did not like it, must not see it as liked.
	authorView, err := h.svc.PostByID(h.ctx, id, ama)
	if err != nil {
		t.Fatalf("PostByID: %v", err)
	}
	if authorView.IsLikedByMe {
		t.Error("a member who did not like the post sees isLikedByMe")
	}

	// --- report ---
	if _, err := h.svc.Report(h.as(kwame), ReportInput{
		PostID: id, ReporterID: kwame, Reason: ReasonMisleading,
	}); err != nil {
		t.Fatalf("Report: %v", err)
	}
	// A report does NOT remove the post. It raises it to a human.
	stillThere, _, err := h.svc.Feed(h.ctx, ama, 1, 20)
	if err != nil {
		t.Fatalf("Feed: %v", err)
	}
	if len(stillThere) != 1 {
		t.Fatalf("a reported post left the feed before a moderator acted (%d posts)",
			len(stillThere))
	}

	queue, err := h.svc.Queue(h.ctx, true, 1, 20)
	if err != nil {
		t.Fatalf("Queue: %v", err)
	}
	if len(queue) != 1 || queue[0].OpenReports != 1 {
		t.Fatalf("queue has %d items", len(queue))
	}
	if queue[0].Post.ID.Hex() != id {
		t.Errorf("queue names post %s, want %s", queue[0].Post.ID.Hex(), id)
	}

	// --- moderator action ---
	moderated, err := h.svc.Moderate(h.as(pastor), id, ActionHide, pastor, "Checking with the author.")
	if err != nil {
		t.Fatalf("Moderate: %v", err)
	}
	if moderated.Status != StatusHidden {
		t.Fatalf("post is %s after hide", moderated.Status)
	}
	if moderated.ModeratedBy.String() != pastor {
		t.Errorf("moderation is attributed to %q, want the moderator", moderated.ModeratedBy)
	}

	// It leaves the feed...
	feed, feedTotal, err := h.svc.Feed(h.ctx, ama, 1, 20)
	if err != nil {
		t.Fatalf("Feed: %v", err)
	}
	if len(feed) != 0 || feedTotal != 0 {
		t.Fatalf("a hidden post is still on the feed (%d posts, total %d)", len(feed), feedTotal)
	}
	// ...and the report is closed, so it does not sit in the queue forever.
	open, err := h.svc.Queue(h.ctx, true, 1, 20)
	if err != nil {
		t.Fatalf("Queue: %v", err)
	}
	if len(open) != 0 {
		t.Fatalf("moderating left %d reports open", len(open))
	}
}

// The other half of the criterion, checked on every collection rather than
// just the posts: a feed that leaks is a church reading another church's
// congregation.
func TestNothingCrossesChurches(t *testing.T) {
	h := newHarness(t)
	created := h.post(t, ama, "Church A only.")
	id := created.ID.Hex()

	if _, err := h.svc.Comment(h.ctx, id, Author{ID: ama, Name: "Ama"}, "mine"); err != nil {
		t.Fatalf("Comment: %v", err)
	}
	if _, err := h.svc.Like(h.ctx, id, ama); err != nil {
		t.Fatalf("Like: %v", err)
	}
	if _, err := h.svc.Report(h.ctx, ReportInput{
		PostID: id, ReporterID: ama, Reason: ReasonSpam,
	}); err != nil {
		t.Fatalf("Report: %v", err)
	}

	// Church B sees none of it.
	feed, total, err := h.svc.Feed(h.other, kwame, 1, 20)
	if err != nil {
		t.Fatalf("Feed: %v", err)
	}
	if len(feed) != 0 || total != 0 {
		t.Fatalf("church B sees %d of church A's posts (total %d)", len(feed), total)
	}
	if _, err := h.svc.PostByID(h.other, id, kwame); err == nil {
		t.Error("church B read church A's post by id")
	}
	if _, _, err := h.svc.Comments(h.other, id, 1, 20); err == nil {
		t.Error("church B read church A's comments")
	}
	queue, err := h.svc.Queue(h.other, true, 1, 20)
	if err != nil {
		t.Fatalf("Queue: %v", err)
	}
	if len(queue) != 0 {
		t.Fatalf("church B sees %d of church A's reports", len(queue))
	}
	if _, err := h.svc.Moderate(h.other, id, ActionRemove, kwame, ""); err == nil {
		t.Error("church B moderated church A's post")
	}
}

// A double tap must not inflate the count. On Ghanaian mobile data a retried
// request is the normal case, not the edge one.
func TestLikingTwiceCountsOnce(t *testing.T) {
	h := newHarness(t)
	id := h.post(t, ama, "Praise God.").ID.Hex()

	for i := 0; i < 4; i++ {
		if _, err := h.svc.Like(h.as(kwame), id, kwame); err != nil {
			t.Fatalf("Like %d: %v", i, err)
		}
	}
	post, err := h.svc.PostByID(h.ctx, id, ama)
	if err != nil {
		t.Fatalf("PostByID: %v", err)
	}
	if post.LikesCount != 1 {
		t.Fatalf("four taps produced %d likes", post.LikesCount)
	}
}

// Unliking something never liked must not drive the counter below zero.
func TestUnlikingWhatWasNeverLikedDoesNotGoNegative(t *testing.T) {
	h := newHarness(t)
	id := h.post(t, ama, "Praise God.").ID.Hex()

	count, err := h.svc.Unlike(h.as(kwame), id, kwame)
	if err != nil {
		t.Fatalf("Unlike: %v", err)
	}
	if count != 0 {
		t.Fatalf("unlike returned %d", count)
	}
	post, err := h.svc.PostByID(h.ctx, id, ama)
	if err != nil {
		t.Fatalf("PostByID: %v", err)
	}
	if post.LikesCount != 0 {
		t.Fatalf("likesCount went to %d", post.LikesCount)
	}
}

// Like then unlike returns to zero — the counter has to survive a round trip,
// which is the thing a stored counter most often gets wrong.
func TestLikeThenUnlikeReturnsToZero(t *testing.T) {
	h := newHarness(t)
	id := h.post(t, ama, "Praise God.").ID.Hex()

	if _, err := h.svc.Like(h.as(kwame), id, kwame); err != nil {
		t.Fatalf("Like: %v", err)
	}
	if _, err := h.svc.Unlike(h.as(kwame), id, kwame); err != nil {
		t.Fatalf("Unlike: %v", err)
	}
	post, err := h.svc.PostByID(h.as(kwame), id, kwame)
	if err != nil {
		t.Fatalf("PostByID: %v", err)
	}
	if post.LikesCount != 0 {
		t.Errorf("likesCount = %d after like/unlike", post.LikesCount)
	}
	if post.IsLikedByMe {
		t.Error("isLikedByMe survives an unlike")
	}
}

// One report per member per post. Tapping report twice does not make a post
// twice as reported, and a queue ordered by report count would otherwise be
// gameable by one determined person.
func TestReportingTwiceIsRefused(t *testing.T) {
	h := newHarness(t)
	id := h.post(t, ama, "Buy my product.").ID.Hex()

	if _, err := h.svc.Report(h.as(kwame), ReportInput{
		PostID: id, ReporterID: kwame, Reason: ReasonSpam,
	}); err != nil {
		t.Fatalf("Report: %v", err)
	}
	_, err := h.svc.Report(h.as(kwame), ReportInput{
		PostID: id, ReporterID: kwame, Reason: ReasonSpam,
	})
	if err == nil {
		t.Fatal("a member reported the same post twice")
	}

	post, err := h.svc.PostByID(h.ctx, id, ama)
	if err != nil {
		t.Fatalf("PostByID: %v", err)
	}
	if post.ReportCount != 1 {
		t.Fatalf("reportCount = %d after a duplicate report", post.ReportCount)
	}
}

// Reports never act on their own, at any number. This is the deliberate
// omission in the package comment: five people who dislike a post are, in a
// church, often a faction.
func TestManyReportsDoNotRemoveAPost(t *testing.T) {
	h := newHarness(t)
	id := h.post(t, ama, "An unpopular opinion.").ID.Hex()

	for i, reporter := range []string{
		"6a6f3460a6b0e0738ca10011", "6a6f3460a6b0e0738ca10012",
		"6a6f3460a6b0e0738ca10013", "6a6f3460a6b0e0738ca10014",
		"6a6f3460a6b0e0738ca10015", "6a6f3460a6b0e0738ca10016",
	} {
		if _, err := h.svc.Report(h.as(reporter), ReportInput{
			PostID: id, ReporterID: reporter, Reason: ReasonInappropriate,
		}); err != nil {
			t.Fatalf("Report %d: %v", i, err)
		}
	}

	feed, _, err := h.svc.Feed(h.ctx, ama, 1, 20)
	if err != nil {
		t.Fatalf("Feed: %v", err)
	}
	if len(feed) != 1 {
		t.Fatalf("six reports removed the post from the feed without a moderator")
	}
	if feed[0].Status != StatusVisible {
		t.Errorf("post is %s after six reports", feed[0].Status)
	}
}

// A hidden post stops collecting likes, comments and reports. Otherwise a
// moderated post keeps generating notifications for its author.
func TestAHiddenPostCannotBeInteractedWith(t *testing.T) {
	h := newHarness(t)
	id := h.post(t, ama, "Something contested.").ID.Hex()
	if _, err := h.svc.Moderate(h.as(pastor), id, ActionHide, pastor, ""); err != nil {
		t.Fatalf("Moderate: %v", err)
	}

	if _, err := h.svc.Like(h.as(kwame), id, kwame); err == nil {
		t.Error("a hidden post was liked")
	}
	if _, err := h.svc.Comment(h.as(kwame), id, Author{ID: kwame, Name: "K"}, "hi"); err == nil {
		t.Error("a hidden post was commented on")
	}
	if _, err := h.svc.Report(h.as(kwame), ReportInput{
		PostID: id, ReporterID: kwame, Reason: ReasonSpam,
	}); err == nil {
		t.Error("a hidden post was reported")
	}
}

// Restoring puts a post back and dismisses its reports, so the same post does
// not reappear in the queue on the strength of reports already judged wrong.
func TestRestoringClearsTheQueue(t *testing.T) {
	h := newHarness(t)
	id := h.post(t, ama, "Judged too quickly.").ID.Hex()
	if _, err := h.svc.Report(h.as(kwame), ReportInput{
		PostID: id, ReporterID: kwame, Reason: ReasonMisleading,
	}); err != nil {
		t.Fatalf("Report: %v", err)
	}
	if _, err := h.svc.Moderate(h.as(pastor), id, ActionHide, pastor, ""); err != nil {
		t.Fatalf("hide: %v", err)
	}
	restored, err := h.svc.Moderate(h.as(pastor), id, ActionRestore, pastor, "Nothing wrong with it.")
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if restored.Status != StatusVisible {
		t.Fatalf("restored post is %s", restored.Status)
	}

	feed, _, err := h.svc.Feed(h.ctx, ama, 1, 20)
	if err != nil {
		t.Fatalf("Feed: %v", err)
	}
	if len(feed) != 1 {
		t.Fatalf("a restored post is not back on the feed")
	}
	queue, err := h.svc.Queue(h.ctx, true, 1, 20)
	if err != nil {
		t.Fatalf("Queue: %v", err)
	}
	if len(queue) != 0 {
		t.Fatalf("restoring left %d reports open", len(queue))
	}
}

// Dismissing a report on an already-hidden post must not silently restore it.
// The two decisions are separate, and conflating them would put a post a
// moderator hid back in front of the congregation.
func TestDismissingDoesNotRestoreAHiddenPost(t *testing.T) {
	h := newHarness(t)
	id := h.post(t, ama, "Hidden for a reason.").ID.Hex()
	if _, err := h.svc.Report(h.as(kwame), ReportInput{
		PostID: id, ReporterID: kwame, Reason: ReasonSpam,
	}); err != nil {
		t.Fatalf("Report: %v", err)
	}
	if _, err := h.svc.Moderate(h.as(pastor), id, ActionHide, pastor, ""); err != nil {
		t.Fatalf("hide: %v", err)
	}
	after, err := h.svc.Moderate(h.as(pastor), id, ActionDismiss, pastor, "")
	if err != nil {
		t.Fatalf("dismiss: %v", err)
	}
	if after.Status != StatusHidden {
		t.Fatalf("dismissing a report changed the post to %s", after.Status)
	}
}

// A member removes their own post; they do not remove anybody else's.
func TestOnlyTheAuthorOrAModeratorRemovesAPost(t *testing.T) {
	h := newHarness(t)
	id := h.post(t, ama, "Mine.").ID.Hex()

	if err := h.svc.DeletePost(h.as(kwame), id, kwame, false); err == nil {
		t.Fatal("another member removed somebody else's post")
	}
	feed, _, err := h.svc.Feed(h.ctx, ama, 1, 20)
	if err != nil {
		t.Fatalf("Feed: %v", err)
	}
	if len(feed) != 1 {
		t.Fatal("the post was removed by the failed attempt")
	}

	if err := h.svc.DeletePost(h.ctx, id, ama, false); err != nil {
		t.Fatalf("the author could not remove their own post: %v", err)
	}
	feed, _, err = h.svc.Feed(h.ctx, ama, 1, 20)
	if err != nil {
		t.Fatalf("Feed: %v", err)
	}
	if len(feed) != 0 {
		t.Fatal("the author's own post survived their deletion")
	}
}

// A moderator removes anybody's.
func TestAModeratorRemovesAnybodysPost(t *testing.T) {
	h := newHarness(t)
	id := h.post(t, ama, "Not mine to keep.").ID.Hex()

	if err := h.svc.DeletePost(h.as(pastor), id, pastor, true); err != nil {
		t.Fatalf("a moderator could not remove a post: %v", err)
	}
	post, err := h.svc.PostByID(h.ctx, id, ama)
	if err != nil {
		t.Fatalf("PostByID: %v", err)
	}
	// Removed, not deleted: a church that took something down needs to be able
	// to say what it took down and who decided.
	if post.Status != StatusRemoved {
		t.Errorf("removed post is %s", post.Status)
	}
	if post.ModeratedBy.String() != pastor {
		t.Errorf("removal is attributed to %q", post.ModeratedBy)
	}
}

// The feed is newest first and paged to what the clients accept. The mobile
// normaliser THROWS on a page carrying more rows than it asked for.
func TestTheFeedIsNewestFirstAndRespectsPaging(t *testing.T) {
	h := newHarness(t)
	for i := 0; i < 5; i++ {
		h.post(t, ama, "post")
		time.Sleep(2 * time.Millisecond)
	}

	page, total, err := h.svc.Feed(h.ctx, ama, 1, 2)
	if err != nil {
		t.Fatalf("Feed: %v", err)
	}
	if len(page) != 2 {
		t.Fatalf("asked for 2, got %d", len(page))
	}
	if total != 5 {
		t.Errorf("total = %d, want 5", total)
	}
	if !page[0].CreatedAt.After(page[1].CreatedAt) {
		t.Error("the feed is not newest first")
	}

	// An absurd limit is clamped, not honoured.
	big, _, err := h.svc.Feed(h.ctx, ama, 1, 10_000)
	if err != nil {
		t.Fatalf("Feed: %v", err)
	}
	if len(big) > MaxPageSize {
		t.Errorf("returned %d rows, above the %d the clients accept", len(big), MaxPageSize)
	}
}

// Content rules, all of which the clients also enforce — a server that allowed
// more would produce a response the app refuses to render.
func TestUnusableContentIsRefused(t *testing.T) {
	h := newHarness(t)

	long := make([]rune, MaxContentLength+1)
	for i := range long {
		long[i] = 'a'
	}
	for name, in := range map[string]PostInput{
		"empty":      {Author: Author{ID: ama}, Content: "   ", Type: TypeGeneral},
		"too long":   {Author: Author{ID: ama}, Content: string(long), Type: TypeGeneral},
		"bad type":   {Author: Author{ID: ama}, Content: "hi", Type: "rant"},
		"no author":  {Author: Author{ID: ""}, Content: "hi", Type: TypeGeneral},
		"http image": {Author: Author{ID: ama}, Content: "hi", Type: TypeGeneral, ImageURL: "http://evil.example/x.png"},
		"other host": {Author: Author{ID: ama}, Content: "hi", Type: TypeGeneral, ImageURL: "https://evil.example/x.png"},
	} {
		if _, err := h.svc.CreatePost(h.ctx, in); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
}

// An empty type defaults to general rather than being refused, because the
// legacy clients predate the field and a church should not lose posts to a
// contract change.
func TestAMissingTypeDefaultsToGeneral(t *testing.T) {
	h := newHarness(t)
	out, err := h.svc.CreatePost(h.ctx, PostInput{
		Author: Author{ID: ama, Name: "Ama"}, Content: "No type given.",
	})
	if err != nil {
		t.Fatalf("CreatePost: %v", err)
	}
	if out.Type != TypeGeneral {
		t.Errorf("type = %q, want general", out.Type)
	}
}

// "Other" with nothing written is a report a moderator cannot act on.
func TestAReportMustSayEnoughToActOn(t *testing.T) {
	h := newHarness(t)
	id := h.post(t, ama, "Something.").ID.Hex()

	if _, err := h.svc.Report(h.as(kwame), ReportInput{
		PostID: id, ReporterID: kwame, Reason: ReasonOther,
	}); err == nil {
		t.Error("a bare 'other' report was accepted")
	}
	if _, err := h.svc.Report(h.as(kwame), ReportInput{
		PostID: id, ReporterID: kwame, Reason: ReasonOther,
		Detail: "It names a child.",
	}); err != nil {
		t.Errorf("an explained 'other' report was refused: %v", err)
	}
}
