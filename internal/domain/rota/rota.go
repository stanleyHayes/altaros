// Package rota is volunteer scheduling (WP-33, §8.7).
//
// # Why a rota is not a list of names
//
// The naive model is "this person serves on the sound desk". What a church
// actually needs is "this person serves on the sound desk ON THIS SUNDAY", and
// the difference is the same one WP-21 hit with attendance: a weekly service is
// ONE event, so anything attached to the event rather than to a specific
// staging of it collapses every Sunday into one.
//
// So an assignment is keyed on the OCCURRENCE. That also makes the two things
// churches actually do possible: publishing next month's rota (many
// occurrences at once) and swapping one Sunday without touching the others.
//
// # Three things that must not go wrong
//
//   - A volunteer must never be double-booked. Two roles at 9am is a person who
//     will do neither well, and a rota that allows it is one the team leader
//     stops trusting.
//   - A swap must be settled by the DATABASE, not by whoever's phone was
//     fastest. Two people accepting the same open slot is the normal case in a
//     WhatsApp-driven church, not the edge one.
//   - A reminder must reach somebody who opted out of marketing. A volunteer
//     who accepted a slot asked for the reminder; suppressing it because they
//     declined a newsletter is how a church ends up with no sound engineer.
package rota

import (
	"errors"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// Collections.
const (
	AssignmentCollection  = "rota_assignments"
	UnavailableCollection = "rota_unavailability"
)

var (
	// ErrNotFound means no such assignment in this church.
	ErrNotFound = errors.New("rota: not found")
	// ErrRoleRequired means an assignment named no role.
	ErrRoleRequired = errors.New("rota: a serving role is required")
	// ErrMemberRequired means an assignment named nobody.
	ErrMemberRequired = errors.New("rota: a volunteer is required")
	// ErrOccurrenceRequired means an assignment named no date.
	ErrOccurrenceRequired = errors.New("rota: which service is this for?")
	// ErrDoubleBooked means the volunteer is already serving at that time.
	ErrDoubleBooked = errors.New("rota: that volunteer is already serving then")
	// ErrAlreadyAssigned means the volunteer already holds that exact slot.
	ErrAlreadyAssigned = errors.New("rota: that volunteer already has this role")
	// ErrUnavailable means the volunteer has blocked that date.
	ErrUnavailable = errors.New("rota: that volunteer is unavailable then")
	// ErrNotYours means somebody tried to answer for another volunteer.
	ErrNotYours = errors.New("rota: that is not your assignment")
	// ErrNotOpen means a swap was accepted that nobody had opened, or that
	// somebody else already took.
	ErrNotOpen = errors.New("rota: that slot is no longer open")
	// ErrNotAnOccurrence means the date is not a time the service happens.
	ErrNotAnOccurrence = errors.New("rota: that service does not happen then")
	// ErrAlreadyPublished means a published rota was published again.
	ErrAlreadyPublished = errors.New("rota: this rota is already published")
)

// Status is where an assignment stands.
type Status string

const (
	// StatusDraft is scheduled but not yet visible to the volunteer. A team
	// leader builds a month at a time and does not want six half-finished
	// notifications going out while they think.
	StatusDraft Status = "draft"
	// StatusAssigned is published and awaiting an answer.
	StatusAssigned Status = "assigned"
	// StatusAccepted is confirmed by the volunteer.
	StatusAccepted Status = "accepted"
	// StatusDeclined is refused. The slot is open for somebody else.
	StatusDeclined Status = "declined"
	// StatusSwapRequested is a volunteer asking to be replaced on a slot they
	// had accepted. Distinct from declined: they are still on the hook until
	// somebody takes it, which is the honest reading and the one that stops a
	// service silently losing its sound engineer.
	StatusSwapRequested Status = "swap_requested"
	// StatusSwappedOut is a slot somebody else took over.
	StatusSwappedOut Status = "swapped_out"
)

// Valid reports whether a status is recognised.
func (s Status) Valid() bool {
	switch s {
	case StatusDraft, StatusAssigned, StatusAccepted, StatusDeclined,
		StatusSwapRequested, StatusSwappedOut:
		return true
	}
	return false
}

// Committed reports whether this assignment still counts as somebody serving.
//
// A swap REQUEST is committed: until somebody takes it, the original volunteer
// is still the one rostered, and a rota that showed the slot as empty the
// moment somebody asked to swap would let a team leader think it was covered by
// a stranger who does not exist.
func (s Status) Committed() bool {
	return s == StatusAssigned || s == StatusAccepted || s == StatusSwapRequested
}

// Assignment is one person serving one role at one service.
type Assignment struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`

	EventID bson.ObjectID `bson:"eventId" json:"eventId"`
	// OccurrenceAt is WHICH staging of the event — the specific Sunday.
	//
	// Part of the uniqueness key, for the reason in the package comment: a
	// weekly service is one document, so an assignment keyed on the event alone
	// would mean a volunteer could be rostered for "Sunday service" exactly
	// once, ever.
	OccurrenceAt time.Time `bson:"occurrenceAt" json:"occurrenceAt"`

	// Role is what they are doing — "Sound", "Usher", "Worship".
	//
	// A free string rather than a foreign key to departments. A church's rota
	// roles and its ministry departments overlap but are not the same list: the
	// media department covers sound AND projection on the same Sunday, and
	// forcing one to be the other means a team leader cannot describe a rota
	// they already run.
	Role     string `bson:"role"     json:"role"`
	MemberID string `bson:"memberId" json:"memberId"`

	Status Status `bson:"status" json:"status"`
	// Note carries a decline reason or a swap message, so a team leader is not
	// left with a status and no explanation.
	Note string `bson:"note,omitempty" json:"note,omitempty"`

	AssignedBy  mongodb.ID `bson:"assignedBy,omitempty"  json:"assignedBy,omitempty"`
	PublishedAt *time.Time `bson:"publishedAt,omitempty" json:"publishedAt,omitempty"`
	RespondedAt *time.Time `bson:"respondedAt,omitempty" json:"respondedAt,omitempty"`
	// RemindedAt stops a sweeper sending the same reminder twice. Nil means it
	// has not gone yet.
	RemindedAt *time.Time `bson:"remindedAt,omitempty" json:"remindedAt,omitempty"`
	// SwappedFrom records who originally held a slot somebody took over, so
	// the history reads rather than silently changing names.
	SwappedFrom string `bson:"swappedFrom,omitempty" json:"swappedFrom,omitempty"`

	CreatedAt time.Time `bson:"createdAt" json:"createdAt"`
	UpdatedAt time.Time `bson:"updatedAt" json:"updatedAt"`
}

// Unavailability is a date range a volunteer cannot serve.
//
// Stored as a range rather than as individual dates because that is how people
// think and say it — "I'm away for the whole of August" — and because a
// holiday stored as thirty-one rows is thirty-one rows to delete when it moves.
type Unavailability struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`
	MemberID string        `bson:"memberId"      json:"memberId"`

	From   time.Time `bson:"from"             json:"from"`
	To     time.Time `bson:"to"               json:"to"`
	Reason string    `bson:"reason,omitempty" json:"reason,omitempty"`

	CreatedAt time.Time `bson:"createdAt" json:"createdAt"`
}

// Covers reports whether a moment falls inside the block.
func (u *Unavailability) Covers(at time.Time) bool {
	return !at.Before(u.From) && at.Before(u.To)
}

// Slot is one role at one service, with who is on it.
//
// The shape a rota is READ in. A team leader looks at a Sunday and asks "is
// sound covered", not "list me every assignment row".
type Slot struct {
	Role         string       `json:"role"`
	OccurrenceAt time.Time    `json:"occurrenceAt"`
	Assignments  []Assignment `json:"assignments"`
	// Filled counts only the assignments that still represent somebody
	// serving. A slot whose only volunteer declined is NOT filled, and showing
	// it as filled is how a service arrives with no sound engineer.
	Filled int `json:"filled"`
	// NeedsCover is true when nobody is committed to this slot.
	NeedsCover bool `json:"needsCover"`
}

// Service is one date's rota across every role.
type ServiceRota struct {
	EventID      bson.ObjectID `json:"eventId"`
	EventTitle   string        `json:"eventTitle"`
	OccurrenceAt time.Time     `json:"occurrenceAt"`
	Slots        []Slot        `json:"slots"`
	// Unfilled is how many roles have nobody committed, surfaced at the top
	// because it is the only number a team leader is looking for.
	Unfilled int `json:"unfilled"`
}
