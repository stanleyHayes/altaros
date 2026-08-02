// Package discipleship is the follow-up pipeline (WP-34, §8.8).
//
// # Why active/inactive is not enough
//
// The PDF tracks members as active or inactive. Churches do not think that way:
// they think in journeys — first-timer, new convert, baptised, member, leader —
// and the whole point of the model is that somebody at one stage needs
// something different from somebody at another. A first-timer needs a phone
// call this week. A new convert needs a class. A member does not need either.
//
// # The failure this exists to prevent
//
// A visitor fills in a card on Sunday, the card goes in a drawer, and nobody
// calls. Every church knows this happens and most cannot say how often. So the
// pipeline is built around the one guarantee that matters: recording a
// first-timer CREATES a task, with an owner and a deadline, and if the deadline
// passes untouched the task escalates to somebody more senior rather than
// quietly ageing.
//
// An SLA nobody is told about is a report, not a process. The escalation is
// what makes it a process.
//
// # What is NOT here
//
// The plan lists "AI-suggested actions from WP-30". That half is absent because
// WP-30 is not built. It is an addition to this pipeline rather than a
// prerequisite: a church whose follow-up tasks are assigned, timed and escalated
// is doing follow-up, with or without a model suggesting what to say.
package discipleship

import (
	"errors"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// Collections.
const (
	JourneyCollection = "discipleship_journeys"
	TaskCollection    = "discipleship_tasks"
)

var (
	// ErrJourneyNotFound means no such journey in this church.
	ErrJourneyNotFound = errors.New("discipleship: journey not found")
	// ErrTaskNotFound means no such task in this church.
	ErrTaskNotFound = errors.New("discipleship: task not found")
	// ErrMemberRequired means a journey named nobody.
	ErrMemberRequired = errors.New("discipleship: which member is this about?")
	// ErrStageInvalid means an unrecognised stage.
	ErrStageInvalid = errors.New("discipleship: that stage is not recognised")
	// ErrNoOwner means a task with nobody responsible for it.
	ErrNoOwner = errors.New("discipleship: a follow-up needs somebody responsible")
	// ErrAlreadyClosed means acting on a task that is finished.
	ErrAlreadyClosed = errors.New("discipleship: that follow-up is already closed")
	// ErrOutcomeRequired means closing a task without saying what happened.
	ErrOutcomeRequired = errors.New("discipleship: say what happened")
)

// Stage is where somebody is on the journey.
//
// Ordered, because the useful questions are directional: how many people moved
// FORWARD this quarter, and who has been at one stage too long.
type Stage string

const (
	StageFirstTimer Stage = "first_timer"
	StageNewConvert Stage = "new_convert"
	StageBaptised   Stage = "baptised"
	StageMember     Stage = "member"
	StageLeader     Stage = "leader"
	// StageDormant is not a step backwards on the same road; it is somebody
	// who has stopped coming. Separate so that "we lost them" is visible
	// rather than being hidden as a member who happens not to attend.
	StageDormant Stage = "dormant"
)

// Journey is the ordered path. Dormant is deliberately outside it.
var Journey = []Stage{
	StageFirstTimer, StageNewConvert, StageBaptised, StageMember, StageLeader,
}

// AllStages is every stage, for a UI.
var AllStages = append(append([]Stage{}, Journey...), StageDormant)

// Valid reports whether a stage is recognised.
func (s Stage) Valid() bool {
	for _, known := range AllStages {
		if s == known {
			return true
		}
	}
	return false
}

// Rank is a stage's position on the journey, and -1 for dormant.
func (s Stage) Rank() int {
	for i, known := range Journey {
		if s == known {
			return i
		}
	}
	return -1
}

// Forward reports whether moving to another stage is progress.
//
// Used to describe a move rather than to forbid one: people do go backwards,
// and a model that refuses to record it produces records that disagree with
// what the church knows.
func (s Stage) Forward(to Stage) bool {
	return s.Rank() >= 0 && to.Rank() > s.Rank()
}

// Journey record: one member's path.
type Record struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`
	MemberID mongodb.ID    `bson:"memberId"      json:"memberId"`

	Stage Stage `bson:"stage" json:"stage"`
	// EnteredStageAt is when they reached the CURRENT stage, which is what
	// "stuck at new convert for eight months" is measured from.
	EnteredStageAt time.Time `bson:"enteredStageAt" json:"enteredStageAt"`

	// History is every move, kept because a church's real question is about
	// movement rather than position: how many first-timers became members this
	// year is not answerable from a current-stage field.
	History []Transition `bson:"history,omitempty" json:"history,omitempty"`

	// Source is how they arrived — a service, an event, an invitation.
	Source string `bson:"source,omitempty" json:"source,omitempty"`
	Note   string `bson:"note,omitempty"   json:"note,omitempty"`

	CreatedAt time.Time `bson:"createdAt" json:"createdAt"`
	UpdatedAt time.Time `bson:"updatedAt" json:"updatedAt"`
}

// Transition is one move between stages.
type Transition struct {
	From Stage      `bson:"from,omitempty" json:"from,omitempty"`
	To   Stage      `bson:"to"             json:"to"`
	At   time.Time  `bson:"at"             json:"at"`
	By   mongodb.ID `bson:"by,omitempty"   json:"by,omitempty"`
	Note string     `bson:"note,omitempty" json:"note,omitempty"`
}

// TaskKind is what somebody is being asked to do.
type TaskKind string

const (
	KindWelcomeCall TaskKind = "welcome_call"
	KindVisit       TaskKind = "visit"
	KindInviteClass TaskKind = "invite_to_class"
	KindCheckIn     TaskKind = "check_in"
	KindOther       TaskKind = "other"
)

// TaskStatus is where a follow-up has got to.
type TaskStatus string

const (
	TaskOpen TaskStatus = "open"
	// TaskEscalated is still open. It is a SEPARATE status rather than a flag
	// so that "escalated and still nobody has touched it" is one query, which
	// is the number a pastor actually needs.
	TaskEscalated TaskStatus = "escalated"
	TaskDone      TaskStatus = "done"
	// TaskUnreachable is the honest outcome for somebody who left a wrong
	// number. Without it, a church either marks it done (a lie) or leaves it
	// open forever (noise that buries the real work).
	TaskUnreachable TaskStatus = "unreachable"
	TaskCancelled   TaskStatus = "cancelled"
)

// Open reports whether a task still needs somebody.
func (s TaskStatus) Open() bool { return s == TaskOpen || s == TaskEscalated }

// Valid reports whether a status is recognised.
func (s TaskStatus) Valid() bool {
	switch s {
	case TaskOpen, TaskEscalated, TaskDone, TaskUnreachable, TaskCancelled:
		return true
	}
	return false
}

// Task is one piece of follow-up somebody owes somebody.
type Task struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`

	MemberID mongodb.ID `bson:"memberId" json:"memberId"`
	// JourneyID ties the task to the stage that produced it.
	JourneyID mongodb.ID `bson:"journeyId,omitempty" json:"journeyId,omitempty"`
	Stage     Stage      `bson:"stage,omitempty"     json:"stage,omitempty"`

	Kind  TaskKind `bson:"kind"  json:"kind"`
	Title string   `bson:"title" json:"title"`
	Note  string   `bson:"note,omitempty" json:"note,omitempty"`

	// AssigneeID is who owes the call. A task with no owner is a task nobody
	// does, so this is required rather than optional.
	AssigneeID mongodb.ID `bson:"assigneeId" json:"assigneeId"`
	// DueAt is the SLA deadline.
	DueAt time.Time `bson:"dueAt" json:"dueAt"`

	Status TaskStatus `bson:"status" json:"status"`

	// EscalatedAt and EscalatedTo record the escalation, so a church can see
	// that the process caught something rather than only that somebody senior
	// ended up with it.
	EscalatedAt *time.Time `bson:"escalatedAt,omitempty" json:"escalatedAt,omitempty"`
	EscalatedTo mongodb.ID `bson:"escalatedTo,omitempty" json:"escalatedTo,omitempty"`

	// FirstTouchedAt is when somebody first did anything. It is what
	// "untouched" means, and it is NOT the same as done: a task somebody
	// picked up on Tuesday and has not finished should not escalate.
	FirstTouchedAt *time.Time `bson:"firstTouchedAt,omitempty" json:"firstTouchedAt,omitempty"`

	ClosedAt *time.Time `bson:"closedAt,omitempty" json:"closedAt,omitempty"`
	Outcome  string     `bson:"outcome,omitempty"  json:"outcome,omitempty"`

	CreatedAt time.Time `bson:"createdAt" json:"createdAt"`
	UpdatedAt time.Time `bson:"updatedAt" json:"updatedAt"`
}

// Overdue reports whether a task has passed its deadline untouched.
func (t *Task) Overdue(now time.Time) bool {
	return t != nil && t.Status.Open() && t.FirstTouchedAt == nil && now.After(t.DueAt)
}

// SLA is how long a stage's follow-up has, and who it escalates to.
//
// Per church, because a village congregation of forty and a city church of four
// thousand do not run the same clock, and a fixed 48 hours would be either
// impossible for one or negligent for the other.
type SLA struct {
	Stage Stage    `bson:"stage" json:"stage"`
	Kind  TaskKind `bson:"kind"  json:"kind"`
	// Within is how long the assignee has.
	Within time.Duration `bson:"withinNanos" json:"-"`
	// WithinHours is the wire form, because a duration in nanoseconds is not
	// something a church administrator should ever have to type.
	WithinHours int `bson:"withinHours" json:"withinHours"`
}

// DefaultSLAs are what a church starts with.
//
// 48 hours for a first-timer is the number churches themselves use: a visitor
// contacted within two days is deciding whether to come back, and one contacted
// after a fortnight has already decided.
var DefaultSLAs = map[Stage]SLA{
	StageFirstTimer: {Stage: StageFirstTimer, Kind: KindWelcomeCall, WithinHours: 48},
	StageNewConvert: {Stage: StageNewConvert, Kind: KindInviteClass, WithinHours: 72},
	StageBaptised:   {Stage: StageBaptised, Kind: KindCheckIn, WithinHours: 168},
	StageDormant:    {Stage: StageDormant, Kind: KindVisit, WithinHours: 168},
}

// Duration is the SLA as a duration.
func (s SLA) Duration() time.Duration {
	if s.Within > 0 {
		return s.Within
	}
	return time.Duration(s.WithinHours) * time.Hour
}

// titleFor names a task in the words a volunteer would use.
func titleFor(kind TaskKind, stage Stage) string {
	switch kind {
	case KindWelcomeCall:
		return "Call this week's first-time visitor"
	case KindInviteClass:
		return "Invite to the next new believers' class"
	case KindVisit:
		return "Visit — not seen for a while"
	case KindCheckIn:
		return "Check in after baptism"
	default:
		return "Follow up: " + strings.ReplaceAll(string(stage), "_", " ")
	}
}
