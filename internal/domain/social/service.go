package social

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// Service is the feed and its moderation.
type Service struct {
	posts    *mongodb.TenantCollection
	comments *mongodb.TenantCollection
	likes    *mongodb.TenantCollection
	reports  *mongodb.TenantCollection

	now func() time.Time
}

// NewService builds the service.
func NewService(db *mongodb.DB) *Service {
	return &Service{
		posts:    db.Tenant(PostCollection),
		comments: db.Tenant(CommentCollection),
		likes:    db.Tenant(LikeCollection),
		reports:  db.Tenant(ReportCollection),
		now:      func() time.Time { return time.Now().UTC() },
	}
}

// EnsureIndexes creates the indexes the feed needs.
func (s *Service) EnsureIndexes(ctx context.Context) error {
	if err := s.posts.EnsureIndexes(ctx, []mongo.IndexModel{
		{
			// The feed query: this church, visible, newest first.
			Keys: bson.D{
				{Key: "churchId", Value: 1},
				{Key: "status", Value: 1},
				{Key: "createdAt", Value: -1},
			},
			Options: options.Index().SetName("church_feed"),
		},
		{
			// The moderation queue: this church, anything reported.
			Keys: bson.D{
				{Key: "churchId", Value: 1},
				{Key: "reportCount", Value: -1},
				{Key: "createdAt", Value: -1},
			},
			Options: options.Index().SetName("church_reported").
				SetPartialFilterExpression(bson.M{"reportCount": bson.M{"$gt": 0}}),
		},
		{
			// A member's own posts, for a profile and for deletion.
			Keys: bson.D{
				{Key: "churchId", Value: 1},
				{Key: "authorId", Value: 1},
				{Key: "createdAt", Value: -1},
			},
			Options: options.Index().SetName("church_author"),
		},
	}); err != nil {
		return fmt.Errorf("social: post indexes: %w", err)
	}

	if err := s.comments.EnsureIndexes(ctx, []mongo.IndexModel{{
		Keys: bson.D{
			{Key: "churchId", Value: 1},
			{Key: "postId", Value: 1},
			{Key: "createdAt", Value: 1},
		},
		Options: options.Index().SetName("church_post_comments"),
	}}); err != nil {
		return fmt.Errorf("social: comment indexes: %w", err)
	}

	if err := s.likes.EnsureIndexes(ctx, []mongo.IndexModel{{
		// THE index that makes the stored like count trustworthy. Without it a
		// double tap — or a retried request on a bad connection, which is the
		// normal case on Ghanaian mobile data — inflates the counter with no
		// way to tell that it happened.
		Keys: bson.D{
			{Key: "churchId", Value: 1},
			{Key: "postId", Value: 1},
			{Key: "memberId", Value: 1},
		},
		Options: options.Index().SetName("church_post_member_like").SetUnique(true),
	}}); err != nil {
		return fmt.Errorf("social: like indexes: %w", err)
	}

	if err := s.reports.EnsureIndexes(ctx, []mongo.IndexModel{
		{
			// One report per member per post. A member who taps report twice
			// has not doubled the seriousness of the post.
			Keys: bson.D{
				{Key: "churchId", Value: 1},
				{Key: "postId", Value: 1},
				{Key: "reporterId", Value: 1},
			},
			Options: options.Index().SetName("church_post_reporter").SetUnique(true),
		},
		{
			Keys: bson.D{
				{Key: "churchId", Value: 1},
				{Key: "status", Value: 1},
				{Key: "createdAt", Value: -1},
			},
			Options: options.Index().SetName("church_report_status"),
		},
	}); err != nil {
		return fmt.Errorf("social: report indexes: %w", err)
	}
	return nil
}

// Author identifies who is posting.
//
// Passed in rather than looked up, because the name and avatar are denormalised
// onto the post and the caller already holds them from the session.
type Author struct {
	ID        string
	Name      string
	AvatarURL string
}

// PostInput is a new post.
type PostInput struct {
	Author   Author
	Content  string
	Type     Type
	ImageURL string
}

// CreatePost adds a post to the feed.
func (s *Service) CreatePost(ctx context.Context, in PostInput) (*PostView, error) {
	if strings.TrimSpace(in.Author.ID) == "" {
		return nil, ErrAuthorRequired
	}
	content, err := cleanContent(in.Content)
	if err != nil {
		return nil, err
	}
	if in.Type == "" {
		in.Type = TypeGeneral
	}
	if !in.Type.Valid() {
		return nil, fmt.Errorf("%w: %q", ErrTypeInvalid, in.Type)
	}
	image, err := cleanImageURL(in.ImageURL)
	if err != nil {
		return nil, err
	}

	now := s.now()
	doc := bson.M{
		"authorId":      mongodb.ID(in.Author.ID),
		"authorName":    strings.TrimSpace(in.Author.Name),
		"content":       content,
		"type":          string(in.Type),
		"likesCount":    0,
		"commentsCount": 0,
		"status":        string(StatusVisible),
		"createdAt":     now,
		"updatedAt":     now,
	}
	if avatar := strings.TrimSpace(in.Author.AvatarURL); avatar != "" {
		doc["authorAvatarUrl"] = avatar
	}
	if image != "" {
		doc["imageUrl"] = image
	}

	res, err := s.posts.InsertOne(ctx, doc)
	if err != nil {
		return nil, fmt.Errorf("social: insert post: %w", err)
	}
	oid, _ := res.InsertedID.(bson.ObjectID)
	return s.postView(ctx, oid, in.Author.ID)
}

// Feed returns the church's visible posts, newest first.
//
// Hidden and removed posts are absent — not blanked, absent — so a member
// cannot tell a moderated post from one that was never written. A placeholder
// saying "this post was removed" is an invitation to ask who and why, in
// public, which is the argument moderation exists to avoid.
func (s *Service) Feed(ctx context.Context, viewerID string, page, limit int) ([]PostView, int64, error) {
	skip, take := pageOf(page, limit)

	var posts []Post
	err := s.posts.Find(ctx, bson.M{"status": string(StatusVisible)}, &posts,
		options.Find().
			SetSort(bson.D{{Key: "createdAt", Value: -1}}).
			SetSkip(int64(skip)).SetLimit(int64(take)))
	if err != nil {
		return nil, 0, fmt.Errorf("social: read feed: %w", err)
	}

	total, err := s.posts.CountDocuments(ctx, bson.M{"status": string(StatusVisible)})
	if err != nil {
		return nil, 0, fmt.Errorf("social: count feed: %w", err)
	}

	views, err := s.withViewerLikes(ctx, posts, viewerID)
	if err != nil {
		return nil, 0, err
	}
	return views, total, nil
}

// withViewerLikes answers "did I like this" for a page of posts in ONE query.
//
// The per-post alternative is a query per row, which is the classic feed N+1
// and shows up as a feed that gets slower the more it shows.
func (s *Service) withViewerLikes(ctx context.Context, posts []Post, viewerID string) ([]PostView, error) {
	views := make([]PostView, len(posts))
	for i := range posts {
		views[i] = PostView{Post: &posts[i]}
	}
	if len(posts) == 0 || strings.TrimSpace(viewerID) == "" {
		return views, nil
	}

	ids := make(bson.A, 0, len(posts))
	for i := range posts {
		ids = append(ids, posts[i].ID)
	}

	var liked []Like
	err := s.likes.Find(ctx, bson.M{
		"postId":   bson.M{"$in": ids},
		"memberId": mongodb.ID(viewerID),
	}, &liked)
	if err != nil {
		return nil, fmt.Errorf("social: read viewer likes: %w", err)
	}

	byPost := make(map[string]bool, len(liked))
	for i := range liked {
		byPost[liked[i].PostID.String()] = true
	}
	for i := range views {
		views[i].IsLikedByMe = byPost[views[i].Post.ID.Hex()]
	}
	return views, nil
}

// PostByID reads one post as a given viewer sees it.
func (s *Service) PostByID(ctx context.Context, id, viewerID string) (*PostView, error) {
	oid, err := bson.ObjectIDFromHex(strings.TrimSpace(id))
	if err != nil {
		return nil, ErrPostNotFound
	}
	return s.postView(ctx, oid, viewerID)
}

// postView loads one post and answers "did I like this".
func (s *Service) postView(ctx context.Context, oid bson.ObjectID, viewerID string) (*PostView, error) {
	var post Post
	err := s.posts.FindOne(ctx, bson.M{"_id": oid}, &post)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrPostNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("social: read post: %w", err)
	}

	views, err := s.withViewerLikes(ctx, []Post{post}, viewerID)
	if err != nil {
		return nil, err
	}
	return &views[0], nil
}

// Like records a member's like and returns the new count.
//
// The unique index settles a double tap: the insert fails, the counter is NOT
// incremented, and the caller gets the count as it stands rather than an error
// — because from the member's point of view the post is liked either way, and
// an error for "you already liked this" is a bug report waiting to happen.
func (s *Service) Like(ctx context.Context, postID, memberID string) (int, error) {
	oid, post, err := s.interactablePost(ctx, postID)
	if err != nil {
		return 0, err
	}

	_, err = s.likes.InsertOne(ctx, bson.M{
		"postId":   oid,
		"memberId": mongodb.ID(memberID),
		"at":       s.now(),
	})
	if mongo.IsDuplicateKeyError(err) {
		return post.LikesCount, nil
	}
	if err != nil {
		return 0, fmt.Errorf("social: insert like: %w", err)
	}

	if _, err := s.posts.UpdateOne(ctx, bson.M{"_id": oid}, bson.M{
		"$inc": bson.M{"likesCount": 1},
		"$set": bson.M{"updatedAt": s.now()},
	}); err != nil {
		return 0, fmt.Errorf("social: increment likes: %w", err)
	}
	return post.LikesCount + 1, nil
}

// Unlike removes a member's like and returns the new count.
func (s *Service) Unlike(ctx context.Context, postID, memberID string) (int, error) {
	oid, post, err := s.interactablePost(ctx, postID)
	if err != nil {
		return 0, err
	}

	res, err := s.likes.DeleteOne(ctx, bson.M{
		"postId": oid, "memberId": mongodb.ID(memberID),
	})
	if err != nil {
		return 0, fmt.Errorf("social: delete like: %w", err)
	}
	if res.DeletedCount == 0 {
		// Not liked in the first place. Nothing to decrement — and decrementing
		// anyway is how a counter goes negative.
		return post.LikesCount, nil
	}

	if _, err := s.posts.UpdateOne(ctx, bson.M{"_id": oid}, bson.M{
		"$inc": bson.M{"likesCount": -1},
		"$set": bson.M{"updatedAt": s.now()},
	}); err != nil {
		return 0, fmt.Errorf("social: decrement likes: %w", err)
	}
	return post.LikesCount - 1, nil
}

// Comment adds a reply to a post.
func (s *Service) Comment(ctx context.Context, postID string, author Author, body string) (*Comment, error) {
	if strings.TrimSpace(author.ID) == "" {
		return nil, ErrAuthorRequired
	}
	content, err := cleanContent(body)
	if err != nil {
		return nil, err
	}
	oid, _, err := s.interactablePost(ctx, postID)
	if err != nil {
		return nil, err
	}

	now := s.now()
	doc := bson.M{
		"postId":     oid,
		"authorId":   mongodb.ID(author.ID),
		"authorName": strings.TrimSpace(author.Name),
		"content":    content,
		"createdAt":  now,
		"updatedAt":  now,
	}
	if avatar := strings.TrimSpace(author.AvatarURL); avatar != "" {
		doc["authorAvatarUrl"] = avatar
	}

	res, err := s.comments.InsertOne(ctx, doc)
	if err != nil {
		return nil, fmt.Errorf("social: insert comment: %w", err)
	}
	if _, err := s.posts.UpdateOne(ctx, bson.M{"_id": oid}, bson.M{
		"$inc": bson.M{"commentsCount": 1},
		"$set": bson.M{"updatedAt": now},
	}); err != nil {
		return nil, fmt.Errorf("social: increment comments: %w", err)
	}

	var out Comment
	insertedID, _ := res.InsertedID.(bson.ObjectID)
	if err := s.comments.FindOne(ctx, bson.M{"_id": insertedID}, &out); err != nil {
		return nil, fmt.Errorf("social: read comment: %w", err)
	}
	return &out, nil
}

// Comments returns a post's replies, oldest first — the order a conversation
// reads in.
func (s *Service) Comments(ctx context.Context, postID string, page, limit int) ([]Comment, int64, error) {
	oid, _, err := s.readablePost(ctx, postID)
	if err != nil {
		return nil, 0, err
	}
	skip, take := pageOf(page, limit)

	var out []Comment
	err = s.comments.Find(ctx, bson.M{"postId": oid}, &out,
		options.Find().
			SetSort(bson.D{{Key: "createdAt", Value: 1}}).
			SetSkip(int64(skip)).SetLimit(int64(take)))
	if err != nil {
		return nil, 0, fmt.Errorf("social: read comments: %w", err)
	}

	total, err := s.comments.CountDocuments(ctx, bson.M{"postId": oid})
	if err != nil {
		return nil, 0, fmt.Errorf("social: count comments: %w", err)
	}
	if out == nil {
		out = []Comment{}
	}
	return out, total, nil
}

// DeletePost removes a member's own post.
//
// Marked removed rather than deleted, for the same reason a moderated post is:
// the church may need to say what was there. `canModerate` lets a moderator
// remove anybody's; without it, only the author's own.
func (s *Service) DeletePost(ctx context.Context, postID, actorID string, canModerate bool) error {
	oid, post, err := s.readablePost(ctx, postID)
	if err != nil {
		return err
	}
	if !canModerate && post.AuthorID.String() != actorID {
		// Same error the caller gets for a post that does not exist. Telling
		// somebody "that exists but is not yours" confirms a post they cannot
		// see.
		return ErrPostNotFound
	}

	now := s.now()
	if _, err := s.posts.UpdateOne(ctx, bson.M{"_id": oid}, bson.M{"$set": bson.M{
		"status":      string(StatusRemoved),
		"moderatedBy": mongodb.ID(actorID),
		"moderatedAt": now,
		"updatedAt":   now,
	}}); err != nil {
		return fmt.Errorf("social: remove post: %w", err)
	}
	return nil
}

// readablePost loads a post whatever its moderation state.
func (s *Service) readablePost(ctx context.Context, postID string) (bson.ObjectID, *Post, error) {
	oid, err := bson.ObjectIDFromHex(strings.TrimSpace(postID))
	if err != nil {
		return bson.ObjectID{}, nil, ErrPostNotFound
	}
	var post Post
	err = s.posts.FindOne(ctx, bson.M{"_id": oid}, &post)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return bson.ObjectID{}, nil, ErrPostNotFound
	}
	if err != nil {
		return bson.ObjectID{}, nil, fmt.Errorf("social: read post: %w", err)
	}
	return oid, &post, nil
}

// interactablePost loads a post that may still be liked or commented on.
//
// A hidden post is off the feed; letting it still collect likes and replies
// would mean a moderated post keeps generating notifications.
func (s *Service) interactablePost(ctx context.Context, postID string) (bson.ObjectID, *Post, error) {
	oid, post, err := s.readablePost(ctx, postID)
	if err != nil {
		return bson.ObjectID{}, nil, err
	}
	if !post.Status.OnFeed() {
		return bson.ObjectID{}, nil, ErrPostHidden
	}
	return oid, post, nil
}

// cleanImageURL checks an image link before it is stored.
//
// Only https and only our own delivery host — the same rule WP-29 applies to
// media. A feed that stores whatever URL a client sends is a feed that renders
// an attacker's host to the whole congregation, and every image request then
// carries a member's IP to somebody else's server.
func cleanImageURL(raw string) (string, error) {
	url := strings.TrimSpace(raw)
	if url == "" {
		return "", nil
	}
	if !strings.HasPrefix(url, "https://") {
		return "", ErrImageNotAllowed
	}
	if !strings.Contains(url, "res.cloudinary.com/") {
		return "", ErrImageNotAllowed
	}
	return url, nil
}

// tenantOf is the caller's church, for the few places that need it directly.
func tenantOf(ctx context.Context) (string, error) {
	scope, err := tenancy.FromContext(ctx)
	if err != nil {
		return "", err
	}
	return scope.ChurchID, nil
}
