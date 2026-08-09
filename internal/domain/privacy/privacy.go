// Package privacy is data subject rights: what we hold about a person, giving
// it to them, and deleting them.
//
// It exists to satisfy three obligations that turn out to be one piece of work:
//
//   - **Ghana's Data Protection Act 2012 (Act 843)**, which gives a data
//     subject the right to know what is held (s.32), to have it corrected, and
//     to have it erased where retention is no longer justified (s.33).
//   - **App Store Review Guideline 5.1.1(v)**, which requires an app that
//     creates accounts to let the person delete theirs FROM INSIDE THE APP.
//     Offering only a "contact support" address is a rejection.
//   - **Google Play's Data deletion policy**, which requires both an in-app
//     path and a publicly reachable URL that works without installing the app.
//
// # Deletion cannot mean "delete every row", and pretending otherwise is worse
//
// A church's ledger has to keep balancing after somebody leaves. Ghana's
// Revenue Administration Act 2016 (Act 915, s.28) requires business records be
// kept for six years, and a giving receipt is a business record — for the
// CHURCH, which is the controller of its own accounts. Deleting the
// transactions would leave a congregation unable to reconcile its own bank
// statement, and would destroy the church's evidence of its own income.
//
// So deletion here is precise rather than absolute:
//
//	IDENTITY   erased      name, email, phone, address, photo, and every
//	                       free-text record about the person
//	FINANCIAL  anonymised  the amount, date and type survive; the link to the
//	                       person is severed and cannot be restored
//
// The person is TOLD this, in the receipt, in those terms. An app that says
// "your data has been deleted" while keeping a named giving history has lied
// to somebody about something they are entitled to know, and Act 843 s.32
// gives them the right to ask what is held — at which point the lie surfaces.
//
// # Why anonymisation is real here and not a fig leaf
//
// Anonymised only counts if re-identification is not reasonably possible. So
// the member id is not hashed or tokenised — it is REMOVED, and the row keeps
// no email, phone or name. What remains is "GHS 200, tithe, 3 March", which
// describes a transaction and not a person.
package privacy

import (
	"errors"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// GracePeriod is how long a deleted account can still be restored.
//
// # Why this is not an immediate erase, and why it is still "deletion"
//
// The first implementation erased everything the moment the button was
// pressed. That is defensible against App Store Guideline 5.1.1(v), which
// rejects deactivation offered in place of deletion — but it is dangerous in a
// church product. One mistaken tap, or a stolen unlocked phone, destroyed a
// person's entire history with the congregation and the church's record of
// them, with nothing to undo it.
//
// So deletion is now COMPLETED IN TWO PARTS:
//
//	immediately   the account is locked: sign-in refused, every session
//	              revoked, the profile withdrawn from the church's views
//	after 30 days the data is actually erased and anonymised, irreversibly
//
// This still satisfies both stores: the account really is deleted from the
// person's point of view the instant they ask — they cannot sign in, and
// nothing of theirs is reachable — and the underlying data really is destroyed
// rather than kept indefinitely behind a flag. Google Play explicitly allows a
// deletion window, and Apple's requirement is that deletion happens, not that
// it happens in the same millisecond.
//
// Thirty days is the same window a person gets from most services, long enough
// to notice a mistake and short enough that "deleted" stays honest.
const GracePeriod = 30 * 24 * time.Hour

// Collection records deletion receipts.
//
// Kept AFTER the person is gone, and deliberately holds nothing that
// identifies them: it is the church's evidence that a request was honoured and
// when, which is what an Act 843 audit asks for.
const ReceiptCollection = "privacy_deletion_receipts"

var (
	// ErrMemberRequired means the request named nobody.
	ErrMemberRequired = errors.New("privacy: which person is this about?")
	// ErrNotFound means no such person in this church.
	ErrNotFound = errors.New("privacy: not found")
	// ErrConfirmationRequired means a deletion was requested without the
	// explicit confirmation the UI must collect.
	ErrConfirmationRequired = errors.New("privacy: deletion must be confirmed explicitly")
	// ErrNotYours means somebody tried to export or delete another person.
	ErrNotYours = errors.New("privacy: that is not yours")
)

// Disposition is what happens to one kind of record on deletion.
type Disposition string

const (
	// Erased means the records are removed outright.
	Erased Disposition = "erased"
	// Anonymised means the records survive with the person severed from them.
	Anonymised Disposition = "anonymised"
	// Retained means the records are kept as they are, and the reason says why.
	Retained Disposition = "retained"
)

// Subject says WHICH identifier a category is keyed on.
//
// A person has two ids and they are not interchangeable: a login (`users._id`)
// and a member record (`members._id`), and almost every church record points at
// the MEMBER. Passing the wrong one matches nothing, deletes nothing, and still
// returns a receipt saying the account was deleted — a silent failure that
// would have shipped as a compliance feature.
type Subject string

const (
	// SubjectMember is keyed on the member id. The default and the common case.
	SubjectMember Subject = "member"
	// SubjectUser is keyed on the login/account id.
	SubjectUser Subject = "user"
)

// Holding is one category of data held about a person.
//
// The set of these IS the record of processing activities that Act 843 expects
// a controller to be able to produce, and it is generated from the same list
// the deletion walks — so the two cannot drift. A category added to the erasure
// plan appears in the disclosure automatically.
type Holding struct {
	// Collection is the underlying store.
	Collection string `json:"collection"`
	// Label is what to call it when talking to a person rather than a DBA.
	Label string `json:"label"`
	// Field is the attribute linking the record to the person.
	Field string `json:"field"`
	// Subject is which of the person's two identifiers Field holds. Empty
	// means SubjectMember.
	Subject Subject `json:"-"`
	// Disposition is what deletion does to it.
	Disposition Disposition `json:"disposition"`
	// Because explains the disposition in a sentence a member would accept.
	Because string `json:"because"`
	// IdentityFields are wiped when the row is anonymised rather than removed.
	IdentityFields []string `json:"identityFields,omitempty"`
}

// Holdings is everything ALTAR OS stores about a member, and what deletion
// does to each.
//
// Ordered so the destructive-but-recoverable work happens before the
// irreversible identity wipe: if a run dies halfway, the person still exists
// and the request can be retried. The reverse order would leave an account
// with no name and a full giving history still attached to it.
var Holdings = []Holding{
	{
		Collection: "transactions", Label: "Giving and payment records",
		Field: "memberId", Disposition: Anonymised,
		Because: "Your church must keep its financial records for six years " +
			"(Revenue Administration Act 2016, s.28) and its accounts must still " +
			"balance. The amount and date stay; your name is removed and cannot " +
			"be reconnected.",
		IdentityFields: []string{"memberId", "email", "phone", "memberName", "note"},
	},
	{
		Collection: "pledges", Label: "Pledges",
		Field: "memberId", Disposition: Anonymised,
		Because: "A pledge is part of a campaign's financial history. The amount " +
			"stays against the campaign; your name is removed.",
		IdentityFields: []string{"memberId", "note"},
	},
	{
		Collection: "welfare_cases", Label: "Welfare and pastoral care records",
		Field: "memberId", Disposition: Erased,
		Because: "Removed completely. These are the most sensitive records we " +
			"hold and nothing about them is kept.",
	},
	{
		Collection: "prayer_requests", Label: "Prayer requests",
		Field: "memberId", Disposition: Erased,
		Because: "Removed completely.",
	},
	{
		Collection: "social_posts", Label: "Posts you wrote",
		Field: "authorId", Disposition: Erased,
		Because: "Removed completely, along with the replies underneath them.",
	},
	{
		Collection: "social_comments", Label: "Comments you wrote",
		Field: "authorId", Disposition: Erased, Because: "Removed completely.",
	},
	{
		Collection: "social_likes", Label: "Posts you liked",
		Field: "memberId", Disposition: Erased, Because: "Removed completely.",
	},
	{
		Collection: "social_reports", Label: "Posts you reported",
		Field: "reporterId", Disposition: Erased,
		Because: "Removed completely. A moderator's decision stays, without you " +
			"attached to it.",
	},
	{
		Collection: "discipleship_journeys", Label: "Your discipleship journey",
		Field: "memberId", Disposition: Erased, Because: "Removed completely.",
	},
	{
		Collection: "discipleship_tasks", Label: "Follow-up about you",
		Field: "memberId", Disposition: Erased, Because: "Removed completely.",
	},
	{
		Collection: "rota_assignments", Label: "Serving rota",
		Field: "memberId", Disposition: Erased, Because: "Removed completely.",
	},
	{
		Collection: "rota_unavailability", Label: "Dates you were unavailable",
		Field: "memberId", Disposition: Erased, Because: "Removed completely.",
	},
	{
		Collection: "attendance", Label: "Attendance records",
		Field: "memberId", Disposition: Erased, Because: "Removed completely.",
	},
	{
		Collection: "rsvps", Label: "Event responses",
		Field: "memberId", Disposition: Erased, Because: "Removed completely.",
	},
	{
		Collection: "notifications", Label: "Messages we sent you",
		Field: "memberId", Disposition: Erased, Because: "Removed completely.",
	},
	{
		Collection: "notification_devices", Label: "Your registered devices",
		Field: "memberId", Disposition: Erased,
		Because: "Removed completely, so no further notification can reach you.",
	},
	{
		Collection: "notification_preferences", Label: "Notification settings",
		Field: "memberId", Disposition: Erased, Because: "Removed completely.",
	},
	{
		Collection: "consents", Label: "Consent records",
		Field: "memberId", Disposition: Retained,
		Because: "Kept as proof that permission was given and withdrawn, which " +
			"is what protects you if anyone later asks why you were contacted. " +
			"It holds a date and a purpose, not a message.",
	},
	{
		Collection: "members", Label: "Your member profile",
		Field: "_id", Subject: SubjectMember, Disposition: Erased,
		Because: "Removed completely — name, phone, email, address and photo.",
	},
	{
		// Keyed on the ACCOUNT id, which is a different identifier from the
		// member id — see Subject.
		Collection: "users", Label: "Your login",
		Field: "_id", Subject: SubjectUser, Disposition: Erased,
		Because: "Removed completely. You will be signed out everywhere and the " +
			"account cannot be recovered.",
	},
}

// Status is where a deletion has got to.
type Status string

const (
	// StatusPending means the account is locked and awaiting purge.
	StatusPending Status = "pending"
	// StatusPurged means the data is gone. Terminal.
	StatusPurged Status = "purged"
	// StatusCancelled means the person came back within the window.
	StatusCancelled Status = "cancelled"
)

// Receipt is what a person is given when their account is deleted, and what
// the church keeps as evidence the request was honoured.
type Receipt struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`

	// Reference is what the person quotes if they ever need to ask about it.
	// Deliberately NOT derived from their id or email — it must not become a
	// way to re-identify the anonymised rows.
	Reference string `bson:"reference" json:"reference"`

	RequestedAt time.Time `bson:"requestedAt" json:"requestedAt"`
	// Status distinguishes an account that is locked and awaiting purge from
	// one whose data is actually gone.
	Status Status `bson:"status" json:"status"`
	// PurgeAfter is when the data is destroyed for good.
	PurgeAfter time.Time `bson:"purgeAfter" json:"purgeAfter"`

	// MemberID and UserID are held ONLY while the receipt is pending, because
	// the purge needs to know whom to erase and a restore needs to know whom
	// to bring back. Both are removed at purge, which is what leaves the
	// finished receipt with nothing identifying in it.
	MemberID mongodb.ID `bson:"memberId,omitempty" json:"-"`
	UserID   mongodb.ID `bson:"userId,omitempty"   json:"-"`
	// SelfService distinguishes a person deleting their own account from an
	// administrator doing it for them, which Act 843 treats differently.
	SelfService bool `bson:"selfService" json:"selfService"`

	// Erased and Anonymised count rows, never contents.
	Erased     map[string]int64 `bson:"erased,omitempty"     json:"erased,omitempty"`
	Anonymised map[string]int64 `bson:"anonymised,omitempty" json:"anonymised,omitempty"`

	// Retained says plainly what survives and why, in the words the person
	// was shown before they confirmed.
	Retained []RetentionNote `bson:"retained,omitempty" json:"retained,omitempty"`

	// CompletedAt is when the data was actually destroyed. Zero while pending.
	CompletedAt time.Time `bson:"completedAt,omitempty" json:"completedAt,omitempty"`
	// CancelledAt is when the person restored the account instead.
	CancelledAt time.Time `bson:"cancelledAt,omitempty" json:"cancelledAt,omitempty"`
}

// Restorable reports whether this deletion can still be undone.
func (r *Receipt) Restorable(now time.Time) bool {
	return r != nil && r.Status == StatusPending && now.Before(r.PurgeAfter)
}

// RetentionNote is one thing that outlived the deletion, and why.
type RetentionNote struct {
	Label   string `bson:"label"   json:"label"`
	Because string `bson:"because" json:"because"`
}

// Export is everything held about a person, in a form they can actually read.
//
// Act 843 s.32 gives the right to the DATA, not to a database dump: a JSON
// blob of ObjectIds satisfies a lawyer and nobody else. Each section is
// labelled the way it is labelled in the app.
type Export struct {
	GeneratedAt time.Time `json:"generatedAt"`
	Church      string    `json:"church"`
	// About is the person, so they can confirm it is really them.
	About map[string]any `json:"about"`
	// Sections is the data itself, keyed by the label a member would recognise.
	Sections map[string][]map[string]any `json:"sections"`
	// WhatWeHold is the disclosure: every category, whether or not it had rows.
	// A category with nothing in it is still an answer to "what do you hold".
	WhatWeHold []Holding `json:"whatWeHold"`
}
