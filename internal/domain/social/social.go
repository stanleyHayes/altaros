// Package social is the church feed and its moderation (WP-24, PDF §5.5).
//
// # A church-branded feed without moderation is a liability
//
// That sentence is the whole reason moderation is in this package rather than
// deferred to a later work package. A feed carrying a church's name, where a
// member can post to the whole congregation, will eventually carry something
// the church has to be able to take down: a dispute aired in public, an
// accusation, a scam link, somebody's crisis posted by somebody else. If the
// only answer is "ask an engineer to delete a row", the church cannot run it.
//
// So the four things a moderator needs exist from the start: a member can
// report, a report lands in a queue, a moderator can hide or remove or dismiss,
// and every action is attributable.
//
// # What is deliberately NOT built
//
// **Auto-hiding at N reports.** It is the obvious feature and it is a weapon:
// any five people who dislike a post can remove it, and in a church the five
// people who dislike a post are often a faction. A report raises the post to a
// human; it never removes it. That is a slower system and a fairer one.
//
// # Counters are stored here, and that contradicts the finance rule on purpose
//
// Campaign totals, attendance counts and pledge fulfilment are all DERIVED,
// because a stored copy drifts and a wrong number about money costs something
// real. Like counts are stored — a feed that runs one aggregation per post per
// scroll is a feed nobody scrolls.
//
// The difference is the cost of being wrong. A like count that is off by one is
// cosmetic; a giving total that is off by one is a church asking why the system
// disagrees with its bank statement. And the drift is bounded rather than
// hoped-away: a like is its own document under a unique index on
// (postId, memberId), so the counter cannot be inflated by a double tap — the
// insert fails before the increment runs.
package social

import (
	"errors"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// Collections.
const (
	PostCollection    = "social_posts"
	CommentCollection = "social_comments"
	LikeCollection    = "social_likes"
	ReportCollection  = "social_reports"
)

// Limits. These match the client contract in packages/shared-types and the
// mobile normaliser, which REJECTS a response that exceeds them — a server that
// allowed a longer post would produce a feed the app refuses to render.
const (
	MaxContentLength = 5000
	MaxPageSize      = 50
	DefaultPageSize  = 20
	MaxReportReason  = 500
)

var (
	// ErrPostNotFound means no such post in this church.
	ErrPostNotFound = errors.New("social: post not found")
	// ErrCommentNotFound means no such comment in this church.
	//
	// Also what somebody gets for a comment they may not remove, for the same
	// reason as posts: a distinct "forbidden" confirms the comment exists.
	ErrCommentNotFound = errors.New("social: comment not found")
	// ErrReportNotFound means no such report in this church.
	ErrReportNotFound = errors.New("social: report not found")
	// ErrContentRequired means an empty post or comment.
	ErrContentRequired = errors.New("social: there is nothing to post")
	// ErrContentTooLong means the content exceeds what the clients accept.
	ErrContentTooLong = errors.New("social: that is longer than a post may be")
	// ErrTypeInvalid means an unrecognised post type.
	ErrTypeInvalid = errors.New("social: that post type is not recognised")
	// ErrAuthorRequired means the post named no author.
	ErrAuthorRequired = errors.New("social: a post needs an author")
	// ErrNotAuthor means somebody tried to delete another member's post.
	ErrNotAuthor = errors.New("social: that is not yours to remove")
	// ErrPostHidden means the post is under moderation and cannot be
	// interacted with.
	ErrPostHidden = errors.New("social: that post is not available")
	// ErrReasonRequired means a report said nothing.
	ErrReasonRequired = errors.New("social: say what is wrong with this post")
	// ErrAlreadyReported means this member already reported this post.
	ErrAlreadyReported = errors.New("social: you have already reported this post")
	// ErrImageNotAllowed means an image URL we will not store.
	ErrImageNotAllowed = errors.New("social: that image link is not allowed")
)

// Type is what kind of post this is.
//
// The three values are fixed by the client contract — the mobile normaliser
// rejects anything else — and they are not decoration. A testimony and a praise
// report are what churches actually post, and separating them is what lets a
// church surface testimonies without surfacing everything.
type Type string

const (
	TypeGeneral      Type = "general"
	TypeTestimony    Type = "testimony"
	TypePraiseReport Type = "praise_report"
)

// AllTypes is every post type, for a UI.
var AllTypes = []Type{TypeGeneral, TypeTestimony, TypePraiseReport}

// Valid reports whether a type is recognised.
func (t Type) Valid() bool {
	for _, known := range AllTypes {
		if t == known {
			return true
		}
	}
	return false
}

// Status is a post's moderation state.
type Status string

const (
	// StatusVisible is the normal state, including while reports are open. A
	// report raises a post to a human; it does not remove it.
	StatusVisible Status = "visible"
	// StatusHidden is a moderator's reversible action: off the feed, still
	// readable by moderators, restorable if the report was wrong.
	StatusHidden Status = "hidden"
	// StatusRemoved is the moderator's final action. Still a row, because a
	// church that removed something needs to be able to say what it removed
	// and who decided — deleting the evidence of a moderation decision is how
	// a church loses the argument about whether it was fair.
	StatusRemoved Status = "removed"
)

// Valid reports whether a status is recognised.
func (s Status) Valid() bool {
	return s == StatusVisible || s == StatusHidden || s == StatusRemoved
}

// OnFeed reports whether a post in this state belongs in the congregation feed.
func (s Status) OnFeed() bool { return s == StatusVisible }

// Post is one entry in the feed.
type Post struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`

	AuthorID mongodb.ID `bson:"authorId" json:"authorId"`
	// AuthorName and AuthorAvatarURL are DENORMALISED onto the post.
	//
	// A feed that joins to members for every row is a feed that gets slower as
	// the church grows, and the join is against a collection the legacy
	// TypeScript API also writes (ADR-005). The cost is a renamed member whose
	// old posts keep the old name, which is the right way round: a post is a
	// record of what somebody said at a time.
	AuthorName      string `bson:"authorName"                 json:"authorName"`
	AuthorAvatarURL string `bson:"authorAvatarUrl,omitempty"  json:"authorAvatarUrl,omitempty"`

	Content  string `bson:"content"           json:"content"`
	Type     Type   `bson:"type"              json:"type"`
	ImageURL string `bson:"imageUrl,omitempty" json:"imageUrl,omitempty"`

	// LikesCount and CommentsCount are stored. See the package comment: the
	// unique index on likes is what keeps them honest.
	LikesCount    int `bson:"likesCount"    json:"likesCount"`
	CommentsCount int `bson:"commentsCount" json:"commentsCount"`

	Status Status `bson:"status" json:"status"`
	// ReportCount is how many members have reported it, so a queue can be
	// ordered by how loudly a post is being flagged without that ordering
	// deciding anything on its own.
	ReportCount int `bson:"reportCount,omitempty" json:"reportCount,omitempty"`

	ModeratedBy    mongodb.ID `bson:"moderatedBy,omitempty"     json:"moderatedBy,omitempty"`
	ModeratedAt    *time.Time `bson:"moderatedAt,omitempty"     json:"moderatedAt,omitempty"`
	ModerationNote string     `bson:"moderationNote,omitempty"  json:"moderationNote,omitempty"`

	CreatedAt time.Time `bson:"createdAt" json:"createdAt"`
	UpdatedAt time.Time `bson:"updatedAt" json:"updatedAt"`
}

// PostView is a post as a MEMBER may see it.
//
// It exists because `isLikedByMe` is per-viewer and therefore cannot live on
// the document. The field name is fixed by the mobile normaliser.
//
// # Why the fields are listed out instead of embedding Post
//
// It used to embed *Post, which meant Go serialised every field on the record
// into the congregation's feed — including `reportCount`, `moderatedBy`,
// `moderatedAt` and `moderationNote`. So a post somebody had reported told the
// whole church how many people had reported it, and a post that was hidden and
// later restored published the moderator's identity and their private note
// ("Checking with the author before it stays up") to everyone who scrolled
// past.
//
// That is the opposite of what this package says it does. Report says the
// reporter learns nothing about what happens next, precisely so that reporting
// is not a public act — and then the post itself announced it. A report count
// on a post is also a pile-on signal, which is the thing the no-auto-hide rule
// exists to avoid.
//
// Listing the fields means a new field on Post is invisible to members until
// somebody deliberately adds it here, which is the right default for a record
// that carries moderation state. Moderators read the full Post through the
// queue, the reports endpoint and the moderate response.
type PostView struct {
	// Post is the underlying record for callers INSIDE this package. Never
	// serialised: that is the whole point of this type.
	Post *Post `json:"-"`

	ID       bson.ObjectID `json:"id"`
	ChurchID mongodb.ID    `json:"churchId"`

	AuthorID        mongodb.ID `json:"authorId"`
	AuthorName      string     `json:"authorName"`
	AuthorAvatarURL string     `json:"authorAvatarUrl,omitempty"`

	Content  string `json:"content"`
	Type     Type   `json:"type"`
	ImageURL string `json:"imageUrl,omitempty"`

	LikesCount    int `json:"likesCount"`
	CommentsCount int `json:"commentsCount"`

	// Status is safe to show: a member only ever receives visible posts, and
	// the client uses it to reason about its own cache.
	Status Status `json:"status"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`

	IsLikedByMe bool `json:"isLikedByMe"`
}

// viewOf reduces a record to what a member may see.
func viewOf(p *Post, liked bool) PostView {
	return PostView{
		Post: p,
		ID:   p.ID, ChurchID: p.ChurchID,
		AuthorID: p.AuthorID, AuthorName: p.AuthorName,
		AuthorAvatarURL: p.AuthorAvatarURL,
		Content:         p.Content, Type: p.Type, ImageURL: p.ImageURL,
		LikesCount: p.LikesCount, CommentsCount: p.CommentsCount,
		Status:    p.Status,
		CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
		IsLikedByMe: liked,
	}
}

// Comment is a reply to a post.
type Comment struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`
	PostID   mongodb.ID    `bson:"postId"        json:"postId"`

	AuthorID        mongodb.ID `bson:"authorId"                  json:"authorId"`
	AuthorName      string     `bson:"authorName"                json:"authorName"`
	AuthorAvatarURL string     `bson:"authorAvatarUrl,omitempty" json:"authorAvatarUrl,omitempty"`

	Content string `bson:"content" json:"content"`

	// Status is the comment's moderation state, and it exists because the
	// first cut of this package could moderate posts and NOT comments — which
	// is backwards. People rarely post abuse to a church feed; they comment
	// it, underneath something innocuous. A moderator who can only remove the
	// whole post has to delete a testimony to silence an argument under it.
	//
	// Absent on rows written before this field, which is why every query
	// filters on "not removed" rather than "is visible".
	Status Status `bson:"status,omitempty" json:"status,omitempty"`

	ModeratedBy mongodb.ID `bson:"moderatedBy,omitempty" json:"moderatedBy,omitempty"`
	ModeratedAt *time.Time `bson:"moderatedAt,omitempty" json:"moderatedAt,omitempty"`

	CreatedAt time.Time `bson:"createdAt" json:"createdAt"`
	UpdatedAt time.Time `bson:"updatedAt" json:"updatedAt"`
}

// Like records that one member liked one post.
//
// A document rather than a counter increment, because the unique index on
// (churchId, postId, memberId) is the only thing that makes the stored count
// trustworthy — and because "did I like this" has to be answerable per viewer.
type Like struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`
	PostID   mongodb.ID    `bson:"postId"        json:"postId"`
	MemberID mongodb.ID    `bson:"memberId"      json:"memberId"`
	At       time.Time     `bson:"at"            json:"at"`
}

// ReportReason is why a post was reported.
type ReportReason string

const (
	ReasonSpam          ReportReason = "spam"
	ReasonHarassment    ReportReason = "harassment"
	ReasonMisleading    ReportReason = "misleading"
	ReasonInappropriate ReportReason = "inappropriate"
	ReasonPrivacy       ReportReason = "privacy"
	ReasonOther         ReportReason = "other"
)

// AllReasons is every reason, for a UI.
var AllReasons = []ReportReason{
	ReasonSpam, ReasonHarassment, ReasonMisleading,
	ReasonInappropriate, ReasonPrivacy, ReasonOther,
}

// Valid reports whether a reason is recognised.
func (r ReportReason) Valid() bool {
	for _, known := range AllReasons {
		if r == known {
			return true
		}
	}
	return false
}

// ReportStatus is where a report has got to.
type ReportStatus string

const (
	ReportOpen      ReportStatus = "open"
	ReportUpheld    ReportStatus = "upheld"
	ReportDismissed ReportStatus = "dismissed"
)

// Report is one member flagging one post.
type Report struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`
	PostID   mongodb.ID    `bson:"postId"        json:"postId"`

	// ReporterID is visible to moderators and never to the author. A church
	// where reporting a post is known to the person reported is a church where
	// nobody reports the person everybody is afraid of.
	ReporterID mongodb.ID   `bson:"reporterId" json:"reporterId"`
	Reason     ReportReason `bson:"reason"     json:"reason"`
	Detail     string       `bson:"detail,omitempty" json:"detail,omitempty"`

	Status     ReportStatus `bson:"status"                 json:"status"`
	ResolvedBy mongodb.ID   `bson:"resolvedBy,omitempty"   json:"resolvedBy,omitempty"`
	ResolvedAt *time.Time   `bson:"resolvedAt,omitempty"   json:"resolvedAt,omitempty"`
	Outcome    string       `bson:"outcome,omitempty"      json:"outcome,omitempty"`

	CreatedAt time.Time `bson:"createdAt" json:"createdAt"`
	UpdatedAt time.Time `bson:"updatedAt" json:"updatedAt"`
}

// QueueItem is a reported post together with why it was reported.
//
// The moderator needs both in one place: a post with six spam reports and a
// post with one harassment report need different responses, and a queue that
// shows only a count cannot tell them apart.
type QueueItem struct {
	Post    *Post    `json:"post"`
	Reports []Report `json:"reports"`
	// OpenReports is how many are still unresolved, which is what orders the
	// queue.
	OpenReports int `json:"openReports"`
}

// cleanContent trims a post or comment and checks it is usable.
func cleanContent(raw string) (string, error) {
	content := strings.TrimSpace(raw)
	if content == "" {
		return "", ErrContentRequired
	}
	if len([]rune(content)) > MaxContentLength {
		return "", ErrContentTooLong
	}
	return content, nil
}

// pageOf clamps paging to what the clients accept.
//
// The mobile normaliser THROWS when a response carries more rows than it asked
// for, so a server that quietly returned everything would break the app rather
// than merely being generous.
func pageOf(page, limit int) (skip, take int) {
	if limit <= 0 || limit > MaxPageSize {
		limit = DefaultPageSize
	}
	if page < 1 {
		page = 1
	}
	return (page - 1) * limit, limit
}
