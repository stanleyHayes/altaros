// Package event is services, RSVP and attendance (WP-21, PDF §5.6).
//
// # What makes this harder than a CRUD port
//
// Ushers check people in at the door, and the door is where connectivity is
// worst — a church hall with a metal roof, three hundred people on the same
// cell tower, a five-year-old Android phone. §8.3 makes offline capture a
// requirement rather than a nicety, and the acceptance criterion is the honest
// version of it: 200 check-ins recorded fully offline must reconcile with ZERO
// duplicates on reconnect.
//
// That is a deduplication problem, and it is solved structurally rather than by
// the sync code being careful:
//
//   - A person is either present at a given service or not. So
//     (church, event, occurrence, member) is UNIQUE, and a second check-in for
//     the same person is not a second attendance — it is the same fact,
//     arriving twice.
//   - Two ushers scanning the same person at the same moment race. The unique
//     index settles that race in the database rather than in whichever usher's
//     phone syncs first.
//   - A phone that syncs, loses signal before hearing the reply, and retries
//     sends everything again. That is the normal case offline, not the edge
//     one, so a repeated batch must be a no-op rather than an error.
//
// The occurrence in that key is what makes a weekly service work at all. A
// recurring event is ONE document (see recurrence.go for why), so without it
// the constraint would read "this person may attend Sunday service once, ever"
// — and the second Sunday of a church's life would silently record nobody.
package event

import (
	"errors"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// Collections.
const (
	Collection           = "events"
	RSVPCollection       = "rsvps"
	AttendanceCollection = "attendance"
)

var (
	// ErrNotFound means no such event in this church.
	ErrNotFound = errors.New("event: not found")
	// ErrTitleRequired means an event was submitted without a title.
	ErrTitleRequired = errors.New("event: a title is required")
	// ErrTimesInvalid means the event ends before it starts.
	ErrTimesInvalid = errors.New("event: the end time must be after the start time")
	// ErrMemberRequired means a check-in or RSVP named no member.
	ErrMemberRequired = errors.New("event: a member is required")
	// ErrMemberUnknown means a check-in named somebody this church does not
	// have. Distinct from ErrMemberRequired because the fix is different: one
	// is a malformed request, the other is a device holding a stale roster.
	ErrMemberUnknown = errors.New("event: no such member in this church")
	// ErrStatusInvalid means an RSVP status is not recognised.
	ErrStatusInvalid = errors.New("event: that RSVP response is not recognised")
	// ErrCapacityReached means the event is full.
	ErrCapacityReached = errors.New("event: this event is full")
	// ErrCheckInCodeInvalid means a check-in code matched no event.
	ErrCheckInCodeInvalid = errors.New("event: that check-in code is not valid")
)

// CheckInMethod is how somebody was recorded as present.
type CheckInMethod string

const (
	// CheckInQR is a scan of the member's code.
	CheckInQR CheckInMethod = "QR"
	// CheckInManual is an usher finding somebody by name — always needed,
	// because somebody always forgets their phone.
	CheckInManual CheckInMethod = "MANUAL"
)

// Valid reports whether a method is recognised.
func (m CheckInMethod) Valid() bool {
	return m == CheckInQR || m == CheckInManual
}

// RSVPStatus is a member's answer.
type RSVPStatus string

const (
	RSVPGoing    RSVPStatus = "GOING"
	RSVPMaybe    RSVPStatus = "MAYBE"
	RSVPNotGoing RSVPStatus = "NOT_GOING"
)

// Valid reports whether a status is recognised.
func (s RSVPStatus) Valid() bool {
	switch s {
	case RSVPGoing, RSVPMaybe, RSVPNotGoing:
		return true
	}
	return false
}

// Event is a service, meeting or gathering.
type Event struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`

	Title       string `bson:"title"                 json:"title"`
	Description string `bson:"description,omitempty" json:"description,omitempty"`
	Location    string `bson:"location,omitempty"    json:"location,omitempty"`

	// StartDate and EndDate match the field names the TypeScript API and the
	// shared-types contract already use, so both writers agree (ADR-005).
	StartDate time.Time `bson:"startDate" json:"startDate"`
	EndDate   time.Time `bson:"endDate"   json:"endDate"`

	IsRecurring bool `bson:"isRecurring" json:"isRecurring"`
	// RecurrenceRule is an RFC 5545 RRULE. Stored rather than expanded: a
	// weekly service running for years is one row, and expanding it into rows
	// means every change to the pattern is a migration.
	RecurrenceRule string `bson:"recurrenceRule,omitempty" json:"recurrenceRule,omitempty"`

	// Capacity is optional. Zero means unlimited, which is what a Sunday
	// service is.
	Capacity int `bson:"capacity,omitempty" json:"capacity,omitempty"`

	// CheckInCode is what an usher's device presents to identify the event.
	// Short and human-readable, because it gets typed when a scan fails.
	CheckInCode string `bson:"checkInCode" json:"checkInCode"`

	// RSVPCount and AttendanceCount are maintained on write rather than counted
	// on read. A church's event list is opened constantly and an aggregate per
	// event per view is the query that gets slow first.
	RSVPCount       int `bson:"rsvpCount"       json:"rsvpCount"`
	AttendanceCount int `bson:"attendanceCount" json:"attendanceCount"`

	CreatedBy mongodb.ID `bson:"createdBy,omitempty" json:"createdBy,omitempty"`
	CreatedAt time.Time  `bson:"createdAt" json:"createdAt"`
	UpdatedAt time.Time  `bson:"updatedAt" json:"updatedAt"`
}

// RSVP is a member's answer to an invitation.
type RSVP struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`
	EventID  bson.ObjectID `bson:"eventId"       json:"eventId"`
	MemberID string        `bson:"memberId"      json:"memberId"`

	Status      RSVPStatus `bson:"status"       json:"status"`
	RespondedAt time.Time  `bson:"respondedAt"  json:"respondedAt"`
}

// Attendance is a person recorded as present.
type Attendance struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`
	EventID  bson.ObjectID `bson:"eventId"       json:"eventId"`
	MemberID string        `bson:"memberId"      json:"memberId"`

	// OccurrenceAt is WHICH staging of a recurring event this was — the start
	// time of that particular Sunday, not of the series. It is part of the
	// uniqueness key, which is why it is resolved rather than left optional:
	// two check-ins that disagree about which service they belong to are two
	// records, and the disagreement would be invisible.
	OccurrenceAt time.Time `bson:"occurrenceAt" json:"occurrenceAt"`

	Method CheckInMethod `bson:"method" json:"method"`
	// CheckedInAt is when the USHER recorded it, not when the server heard
	// about it. Offline check-ins arrive hours late, and a timestamp assigned
	// on arrival would put the whole of Sunday morning at whatever time the
	// phone found signal — which makes an attendance report wrong in exactly
	// the way nobody checks.
	CheckedInAt time.Time `bson:"checkedInAt" json:"checkedInAt"`
	// RecordedAt is when the server stored it. The two differ by however long
	// the device was offline, and the difference is worth keeping: it is the
	// only evidence that a reconciliation happened at all.
	RecordedAt time.Time  `bson:"recordedAt"  json:"recordedAt"`
	RecordedBy mongodb.ID `bson:"recordedBy,omitempty" json:"recordedBy,omitempty"`

	// Offline marks a check-in that was captured without connectivity. Kept
	// because "why is this attendance timestamped 09:14 but recorded at 14:40"
	// is a question somebody will ask, and the answer should be in the record.
	Offline bool `bson:"offline,omitempty" json:"offline,omitempty"`
}

// CheckIn is one attendance record as a device submits it.
type CheckIn struct {
	// MemberID is who was present.
	MemberID string `json:"memberId"`
	// Method is how they were identified.
	Method CheckInMethod `json:"method"`
	// CheckedInAt is when the usher scanned them. Supplied by the DEVICE,
	// because the server did not witness it.
	CheckedInAt time.Time `json:"checkedInAt"`
}

// SyncRequest is one device's queue landing.
type SyncRequest struct {
	// EventID is which event, as an id string.
	EventID string `json:"-"`
	// CheckIns are the rows the device captured.
	CheckIns []CheckIn `json:"checkIns"`
	// Occurrence names WHICH staging of a recurring event these belong to.
	//
	// Optional, and usually omitted: left zero, the server snaps each row to
	// the scheduled occurrence nearest its own timestamp, which is right for a
	// device scanning during the service. It is worth sending when it is not —
	// an administrator typing up last Sunday's paper register on Tuesday would
	// otherwise file it against this Sunday.
	Occurrence time.Time `json:"occurrence"`
	// Offline marks a queue captured without connectivity.
	Offline bool `json:"offline"`
}

// SyncResult reports what a batch of offline check-ins did.
//
// Recorded and Duplicate are separate numbers on purpose. A device that syncs
// 200 check-ins and is told "200 accepted" cannot tell a successful first sync
// from a successful retry — and an usher who sees "200 recorded" twice
// reasonably concludes something is wrong.
type SyncResult struct {
	Recorded  int `json:"recorded"`
	Duplicate int `json:"duplicate"`
	// Rejected are check-ins that could not be stored at all, with the reason.
	Rejected []RejectedCheckIn `json:"rejected,omitempty"`
	// AttendanceCount is the event's total across every occurrence.
	AttendanceCount int `json:"attendanceCount"`
	// OccurrenceAttendance is how many were present at THIS staging, which for
	// a weekly service is the number the usher is actually looking for. Zero
	// when the batch spanned more than one occurrence.
	OccurrenceAttendance int `json:"occurrenceAttendance,omitempty"`
	// OccurrenceAt is the staging the batch was filed against, echoed back so a
	// device can show which service it just reconciled. Zero when the batch
	// spanned more than one.
	OccurrenceAt *time.Time `json:"occurrenceAt,omitempty"`
}

// RejectedCheckIn is one check-in that could not be recorded.
//
// Returned per row rather than failing the batch. A single bad row in 200 must
// not cost an usher the other 199 — they are standing at a door and cannot
// re-scan anybody.
type RejectedCheckIn struct {
	MemberID string `json:"memberId"`
	Reason   string `json:"reason"`
}
