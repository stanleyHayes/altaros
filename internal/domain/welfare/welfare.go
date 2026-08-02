// Package welfare is assistance requests and pastoral care (WP-27, PDF §5.7).
//
// This is the most sensitive data in the product. A welfare case records that a
// named person cannot pay rent, is being abused, or is unwell — information
// that in the wrong hands costs somebody their safety rather than their
// privacy. §3.4(3) asks for four things, and each is enforced somewhere
// different because no single mechanism covers them:
//
//   - **Encrypted at rest, separate key.** The narrative fields go through
//     `fieldcrypt`, keyed independently of the JWT secret and the database
//     password, so losing either one does not disclose cases. What is NOT
//     encrypted is the metadata a case is found by — the member, the status —
//     because an encrypted field cannot be queried. So the EXISTENCE of a case
//     is visible to anybody who can read the collection; only its contents are
//     protected. Saying otherwise would be worse than not encrypting.
//   - **Strict pastoral ACL.** Withheld from every blanket grant: the
//     Administrator role holds `AllExceptPastoral()`, so a church admin does
//     NOT get welfare by being made an admin. That is the acceptance criterion,
//     and it was impossible until the role model changed.
//   - **Audited, including refusals.** A denied attempt is the entry that
//     matters — it is how a church learns somebody went looking.
//   - **Excluded from analytics.** A hardship figure on a dashboard is a
//     hardship figure in a screenshot.
package welfare

import (
	"errors"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// Collection holds welfare cases.
const Collection = "welfare_cases"

var (
	// ErrNotFound means no such case in this church.
	//
	// Deliberately the SAME error a caller gets when they lack permission. A
	// distinct "forbidden" would confirm that a case exists for a named
	// person, which is most of what somebody fishing wants to know.
	ErrNotFound = errors.New("welfare: not found")
	// ErrForbidden is used internally to drive the audit trail; it is never
	// the error a caller sees. See ErrNotFound.
	ErrForbidden = errors.New("welfare: not permitted")
	// ErrMemberRequired means a case named nobody.
	ErrMemberRequired = errors.New("welfare: which member is this case about?")
	// ErrSummaryRequired means a case has no description.
	ErrSummaryRequired = errors.New("welfare: a short summary is required")
	// ErrCategoryInvalid means an unrecognised category.
	ErrCategoryInvalid = errors.New("welfare: that category is not recognised")
	// ErrStatusInvalid means an unrecognised status.
	ErrStatusInvalid = errors.New("welfare: that status is not recognised")
	// ErrNotEncrypted means a case was about to be written in the clear.
	ErrNotEncrypted = errors.New("welfare: refusing to store a case unencrypted")
)

// Category is what kind of help is needed.
type Category string

const (
	CategoryFinancial    Category = "financial"
	CategoryMedical      Category = "medical"
	CategoryBereavement  Category = "bereavement"
	CategoryFood         Category = "food"
	CategoryHousing      Category = "housing"
	CategoryEducation    Category = "education"
	CategorySafeguarding Category = "safeguarding"
	CategoryOther        Category = "other"
)

// AllCategories is every category, for a UI.
var AllCategories = []Category{
	CategoryFinancial, CategoryMedical, CategoryBereavement, CategoryFood,
	CategoryHousing, CategoryEducation, CategorySafeguarding, CategoryOther,
}

// Valid reports whether a category is recognised.
func (c Category) Valid() bool {
	for _, known := range AllCategories {
		if c == known {
			return true
		}
	}
	return false
}

// Safeguarding marks the category that is not merely private but urgent.
//
// A safeguarding case can involve a child or a vulnerable adult at risk right
// now. It is separated because the product must be able to treat it
// differently — a higher urgency floor, and a narrower set of eyes.
func (c Category) Safeguarding() bool { return c == CategorySafeguarding }

// Urgency is how fast this needs attention.
type Urgency string

const (
	UrgencyRoutine   Urgency = "routine"
	UrgencyElevated  Urgency = "elevated"
	UrgencyEmergency Urgency = "emergency"
)

// Valid reports whether an urgency is recognised.
func (u Urgency) Valid() bool {
	return u == UrgencyRoutine || u == UrgencyElevated || u == UrgencyEmergency
}

// Status is where a case has got to.
type Status string

const (
	StatusOpen       Status = "open"
	StatusInProgress Status = "in_progress"
	StatusAwaiting   Status = "awaiting_info"
	StatusResolved   Status = "resolved"
	StatusClosed     Status = "closed"
	StatusReferred   Status = "referred"
)

// AllStatuses is every status, in the order a case moves through them.
var AllStatuses = []Status{
	StatusOpen, StatusInProgress, StatusAwaiting,
	StatusResolved, StatusReferred, StatusClosed,
}

// Valid reports whether a status is recognised.
func (s Status) Valid() bool {
	for _, known := range AllStatuses {
		if s == known {
			return true
		}
	}
	return false
}

// Open reports whether a case still needs somebody.
func (s Status) Open() bool {
	return s == StatusOpen || s == StatusInProgress || s == StatusAwaiting
}

// Case is one request for help.
//
// The split between encrypted and plaintext fields IS the design. Anything
// searchable is plaintext and therefore visible to anyone with the database;
// anything descriptive is encrypted. When in doubt a field goes in the
// encrypted half, because the cost of that is a query somebody cannot write and
// the cost of the other is a person's circumstances in a backup.
type Case struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`

	// --- searchable, and therefore NOT encrypted ---

	MemberID string   `bson:"memberId" json:"memberId"`
	Category Category `bson:"category" json:"category"`
	Urgency  Urgency  `bson:"urgency"  json:"urgency"`
	Status   Status   `bson:"status"   json:"status"`
	// AssignedTo is the pastoral worker handling it.
	AssignedTo string `bson:"assignedTo,omitempty" json:"assignedTo,omitempty"`

	// --- encrypted at rest ---

	// Summary is the one-line description. Stored encrypted; the JSON tag is
	// the DECRYPTED value, which only ever leaves this service to a caller who
	// passed the ACL.
	Summary string `bson:"summary"          json:"summary"`
	// Detail is the full narrative.
	Detail string `bson:"detail,omitempty" json:"detail,omitempty"`
	// Notes are the case worker's running record.
	Notes []Note `bson:"notes,omitempty"  json:"notes,omitempty"`

	// AmountMinor is help given in money, if any. Plaintext because a church
	// has to reconcile welfare spending against its ledger, and an amount
	// alone names nobody.
	AmountMinor int64  `bson:"amountMinor,omitempty" json:"amountMinor,omitempty"`
	Currency    string `bson:"currency,omitempty"    json:"currency,omitempty"`

	RaisedBy   mongodb.ID `bson:"raisedBy,omitempty"   json:"raisedBy,omitempty"`
	ResolvedAt *time.Time `bson:"resolvedAt,omitempty" json:"resolvedAt,omitempty"`
	CreatedAt  time.Time  `bson:"createdAt" json:"createdAt"`
	UpdatedAt  time.Time  `bson:"updatedAt" json:"updatedAt"`
}

// Note is one entry in a case's running record.
type Note struct {
	// Body is encrypted at rest.
	Body     string     `bson:"body"     json:"body"`
	AuthorID mongodb.ID `bson:"authorId" json:"authorId"`
	At       time.Time  `bson:"at"       json:"at"`
}

// Summary is a case with its contents REMOVED.
//
// What a listing returns. A church needs to see that it has eleven open cases,
// three of them urgent, without putting eleven people's circumstances on a
// screen that somebody walks past. Opening one is a separate, separately
// audited act.
type CaseSummary struct {
	ID         bson.ObjectID `json:"id"`
	MemberID   string        `json:"memberId"`
	Category   Category      `json:"category"`
	Urgency    Urgency       `json:"urgency"`
	Status     Status        `json:"status"`
	AssignedTo string        `json:"assignedTo,omitempty"`
	// NoteCount says how much record there is without showing any of it.
	NoteCount int       `json:"noteCount"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Summarise strips a case to what a listing may show.
func (c *Case) Summarise() CaseSummary {
	return CaseSummary{
		ID: c.ID, MemberID: c.MemberID, Category: c.Category,
		Urgency: c.Urgency, Status: c.Status, AssignedTo: c.AssignedTo,
		NoteCount: len(c.Notes), CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt,
	}
}
