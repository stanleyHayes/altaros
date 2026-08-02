package social

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// Moderation (WP-24). See the package comment for why a report never removes a
// post on its own.

// ReportInput is a member flagging a post.
type ReportInput struct {
	PostID     string
	ReporterID string
	Reason     ReportReason
	Detail     string
}

// Report flags a post for a moderator.
//
// The post stays on the feed. What changes is that a human is now going to look
// at it — which is the entire mechanism, and the reason there is no threshold
// at which reports act on their own.
func (s *Service) Report(ctx context.Context, in ReportInput) (*Report, error) {
	if strings.TrimSpace(in.ReporterID) == "" {
		return nil, ErrAuthorRequired
	}
	if in.Reason == "" {
		in.Reason = ReasonOther
	}
	if !in.Reason.Valid() {
		return nil, ErrReasonRequired
	}
	detail := strings.TrimSpace(in.Detail)
	if len([]rune(detail)) > MaxReportReason {
		detail = string([]rune(detail)[:MaxReportReason])
	}
	// "Other" with nothing written is a report a moderator cannot act on.
	if in.Reason == ReasonOther && detail == "" {
		return nil, ErrReasonRequired
	}

	oid, _, err := s.interactablePost(ctx, in.PostID)
	if err != nil {
		return nil, err
	}

	now := s.now()
	doc := bson.M{
		"postId":     oid,
		"reporterId": mongodb.ID(in.ReporterID),
		"reason":     string(in.Reason),
		"status":     string(ReportOpen),
		"createdAt":  now,
		"updatedAt":  now,
	}
	if detail != "" {
		doc["detail"] = detail
	}

	res, err := s.reports.InsertOne(ctx, doc)
	if mongo.IsDuplicateKeyError(err) {
		return nil, ErrAlreadyReported
	}
	if err != nil {
		return nil, fmt.Errorf("social: insert report: %w", err)
	}

	// The count orders the queue. It is incremented only on a report that was
	// actually stored, so the unique index above keeps it honest the same way
	// it keeps the like count honest.
	if _, err := s.posts.UpdateOne(ctx, bson.M{"_id": oid}, bson.M{
		"$inc": bson.M{"reportCount": 1},
		"$set": bson.M{"updatedAt": now},
	}); err != nil {
		return nil, fmt.Errorf("social: increment reports: %w", err)
	}

	var out Report
	insertedID, _ := res.InsertedID.(bson.ObjectID)
	if err := s.reports.FindOne(ctx, bson.M{"_id": insertedID}, &out); err != nil {
		return nil, fmt.Errorf("social: read report: %w", err)
	}
	return &out, nil
}

// Queue returns reported posts for a moderator, most-reported first.
//
// Ordered by open reports rather than by total, so a post already dealt with
// does not keep sitting at the top of somebody's work list.
func (s *Service) Queue(ctx context.Context, openOnly bool, page, limit int) ([]QueueItem, error) {
	skip, take := pageOf(page, limit)

	filter := bson.M{"status": string(ReportOpen)}
	if !openOnly {
		filter = bson.M{}
	}

	var reports []Report
	err := s.reports.Find(ctx, filter, &reports,
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}))
	if err != nil {
		return nil, fmt.Errorf("social: read reports: %w", err)
	}
	if len(reports) == 0 {
		return []QueueItem{}, nil
	}

	// Group by post, preserving the order posts were first seen so the newest
	// report surfaces its post first.
	order := make([]string, 0, len(reports))
	byPost := make(map[string][]Report, len(reports))
	for _, r := range reports {
		key := r.PostID.String()
		if _, seen := byPost[key]; !seen {
			order = append(order, key)
		}
		byPost[key] = append(byPost[key], r)
	}

	ids := make(bson.A, 0, len(order))
	for _, key := range order {
		if oid, err := bson.ObjectIDFromHex(key); err == nil {
			ids = append(ids, oid)
		}
	}

	var posts []Post
	if err := s.posts.Find(ctx, bson.M{"_id": bson.M{"$in": ids}}, &posts); err != nil {
		return nil, fmt.Errorf("social: read reported posts: %w", err)
	}
	found := make(map[string]*Post, len(posts))
	for i := range posts {
		found[posts[i].ID.Hex()] = &posts[i]
	}

	items := make([]QueueItem, 0, len(order))
	for _, key := range order {
		post, ok := found[key]
		if !ok {
			// A report whose post is gone. Skipped rather than surfaced as an
			// empty row: there is nothing a moderator can do with it.
			continue
		}
		open := 0
		for _, r := range byPost[key] {
			if r.Status == ReportOpen {
				open++
			}
		}
		items = append(items, QueueItem{
			Post: post, Reports: byPost[key], OpenReports: open,
		})
	}

	if skip >= len(items) {
		return []QueueItem{}, nil
	}
	end := skip + take
	if end > len(items) {
		end = len(items)
	}
	return items[skip:end], nil
}

// Action is what a moderator decided.
type Action string

const (
	// ActionHide takes a post off the feed reversibly.
	ActionHide Action = "hide"
	// ActionRemove takes it off for good. Still a row.
	ActionRemove Action = "remove"
	// ActionRestore puts a hidden post back and dismisses the reports.
	ActionRestore Action = "restore"
	// ActionDismiss leaves the post alone and closes the reports — the answer
	// when somebody reported a post they simply disagreed with.
	ActionDismiss Action = "dismiss"
)

// Valid reports whether an action is recognised.
func (a Action) Valid() bool {
	switch a {
	case ActionHide, ActionRemove, ActionRestore, ActionDismiss:
		return true
	}
	return false
}

// ErrActionInvalid means an unrecognised moderator action.
var ErrActionInvalid = errors.New("social: that moderation action is not recognised")

// Moderate applies a moderator's decision to a post and closes its reports.
//
// One call, because the two halves must not come apart: a post hidden whose
// reports stay open sits in the queue forever, and reports closed on a post
// still on the feed means the next moderator believes it was dealt with.
func (s *Service) Moderate(ctx context.Context, postID string, action Action, moderatorID, note string) (*Post, error) {
	if !action.Valid() {
		return nil, fmt.Errorf("%w: %q", ErrActionInvalid, action)
	}
	oid, _, err := s.readablePost(ctx, postID)
	if err != nil {
		return nil, err
	}

	now := s.now()
	set := bson.M{
		"moderatedBy": mongodb.ID(moderatorID),
		"moderatedAt": now,
		"updatedAt":   now,
	}
	if strings.TrimSpace(note) != "" {
		set["moderationNote"] = strings.TrimSpace(note)
	}

	outcome := ReportUpheld
	switch action {
	case ActionHide:
		set["status"] = string(StatusHidden)
	case ActionRemove:
		set["status"] = string(StatusRemoved)
	case ActionRestore:
		set["status"] = string(StatusVisible)
		outcome = ReportDismissed
	case ActionDismiss:
		// The post is left exactly as it is — including its status, so
		// dismissing a report on an already-hidden post does not silently
		// restore it.
		outcome = ReportDismissed
	}

	if _, err := s.posts.UpdateOne(ctx, bson.M{"_id": oid}, bson.M{"$set": set}); err != nil {
		return nil, fmt.Errorf("social: moderate post: %w", err)
	}

	if _, err := s.reports.UpdateMany(ctx,
		bson.M{"postId": oid, "status": string(ReportOpen)},
		bson.M{"$set": bson.M{
			"status":     string(outcome),
			"resolvedBy": mongodb.ID(moderatorID),
			"resolvedAt": now,
			"outcome":    string(action),
			"updatedAt":  now,
		}}); err != nil {
		return nil, fmt.Errorf("social: resolve reports: %w", err)
	}

	var out Post
	if err := s.posts.FindOne(ctx, bson.M{"_id": oid}, &out); err != nil {
		return nil, fmt.Errorf("social: read moderated post: %w", err)
	}
	return &out, nil
}

// ReportsFor returns every report against one post, for a moderator.
func (s *Service) ReportsFor(ctx context.Context, postID string) ([]Report, error) {
	oid, _, err := s.readablePost(ctx, postID)
	if err != nil {
		return nil, err
	}
	var out []Report
	if err := s.reports.Find(ctx, bson.M{"postId": oid}, &out,
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}})); err != nil {
		return nil, fmt.Errorf("social: read reports: %w", err)
	}
	if out == nil {
		out = []Report{}
	}
	return out, nil
}
