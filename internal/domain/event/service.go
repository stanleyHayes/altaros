package event

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// Roster answers which member ids exist in the caller's church.
//
// A port rather than a direct dependency on the member service for one reason
// that matters here: an offline device submits ids from a roster it downloaded
// hours ago, and this is the check that a check-in names somebody real and
// somebody OURS. A member id from another church simply is not in the answer,
// because the implementation is tenant-scoped — which makes cross-tenant
// attendance injection a non-event rather than a validation rule.
type Roster interface {
	Exist(ctx context.Context, ids []string) (map[string]bool, error)
}

// Service is events, RSVP and attendance.
type Service struct {
	events     *mongodb.TenantCollection
	rsvps      *mongodb.TenantCollection
	attendance *mongodb.TenantCollection
	roster     Roster
	now        func() time.Time
}

// NewService builds the event service.
func NewService(db *mongodb.DB, roster Roster) *Service {
	return &Service{
		events:     db.Tenant(Collection),
		rsvps:      db.Tenant(RSVPCollection),
		attendance: db.Tenant(AttendanceCollection),
		roster:     roster,
		now:        time.Now,
	}
}

// EnsureIndexes creates the constraints this domain depends on.
//
// The attendance index is not an optimisation. It is the acceptance criterion:
// 200 offline check-ins reconciling with zero duplicates is true because the
// database refuses the second copy, not because the sync code counted
// correctly. Application-level deduplication cannot hold that line — two ushers
// syncing at once both read "not present" before either writes.
func (s *Service) EnsureIndexes(ctx context.Context) error {
	err := s.events.EnsureIndexes(ctx, []mongo.IndexModel{
		{
			// Every listing is "this church's events, by date".
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "startDate", Value: 1},
			},
			Options: options.Index().SetName("church_event_start"),
		},
		{
			// The code an usher's device presents. Unique WITHIN a church, not
			// globally: two churches may both end up with ABC123 and neither
			// can reach the other's events, because every lookup is scoped.
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "checkInCode", Value: 1},
			},
			Options: options.Index().SetName("uq_church_checkin_code").SetUnique(true),
		},
	})
	if err != nil {
		return fmt.Errorf("event: create event indexes: %w", err)
	}

	err = s.rsvps.EnsureIndexes(ctx, []mongo.IndexModel{
		{
			// One answer per person per event. A member changing their mind
			// updates their answer rather than adding a second one.
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "eventId", Value: 1},
				{Key: "memberId", Value: 1},
			},
			Options: options.Index().SetName("uq_church_event_member_rsvp").SetUnique(true),
		},
	})
	if err != nil {
		return fmt.Errorf("event: create rsvp indexes: %w", err)
	}

	err = s.attendance.EnsureIndexes(ctx, []mongo.IndexModel{
		{
			// THE constraint. See the note above EnsureIndexes.
			//
			// occurrenceAt is in the key because a recurring event is one
			// document: without it this would read "may attend Sunday service
			// once, ever", and every Sunday after the first would record
			// nobody while reporting a clean sync.
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "eventId", Value: 1},
				{Key: "occurrenceAt", Value: 1},
				{Key: "memberId", Value: 1},
			},
			Options: options.Index().SetName("uq_church_occurrence_member").SetUnique(true),
		},
		{
			// Attendance history for one person, which is what "who has stopped
			// coming" reports read.
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "memberId", Value: 1},
				{Key: "checkedInAt", Value: -1},
			},
			Options: options.Index().SetName("church_member_attendance"),
		},
	})
	if err != nil {
		return fmt.Errorf("event: create attendance indexes: %w", err)
	}
	return nil
}

// Input is an event as submitted.
type Input struct {
	Title          string
	Description    string
	Location       string
	StartDate      time.Time
	EndDate        time.Time
	RecurrenceRule string
	Capacity       int
}

// normalise validates and cleans an input.
func (in Input) normalise() (Input, *Recurrence, error) {
	out := in
	out.Title = strings.TrimSpace(in.Title)
	out.Description = strings.TrimSpace(in.Description)
	out.Location = strings.TrimSpace(in.Location)

	if out.Title == "" {
		return out, nil, ErrTitleRequired
	}
	if out.StartDate.IsZero() {
		return out, nil, ErrTimesInvalid
	}
	if out.EndDate.IsZero() {
		// A service with no stated end is the common case. Two hours is the
		// assumption a calendar has to make to render a block at all, and it is
		// visibly editable — unlike a zero-length event, which renders as
		// nothing and looks like a bug.
		out.EndDate = out.StartDate.Add(2 * time.Hour)
	}
	if !out.EndDate.After(out.StartDate) {
		return out, nil, ErrTimesInvalid
	}
	if out.Capacity < 0 {
		out.Capacity = 0
	}
	out.StartDate = out.StartDate.UTC()
	out.EndDate = out.EndDate.UTC()

	if strings.TrimSpace(out.RecurrenceRule) == "" {
		out.RecurrenceRule = ""
		return out, nil, nil
	}
	rule, err := ParseRecurrence(out.RecurrenceRule)
	if err != nil {
		return out, nil, err
	}
	// Stored in canonical form so the same rule typed two ways is one string.
	out.RecurrenceRule = rule.String()
	return out, rule, nil
}

// Create adds an event.
func (s *Service) Create(ctx context.Context, in Input) (*Event, error) {
	clean, _, err := in.normalise()
	if err != nil {
		return nil, err
	}

	scope, _ := tenancy.FromContext(ctx)
	now := s.now().UTC()

	doc := bson.M{
		"title":           clean.Title,
		"startDate":       clean.StartDate,
		"endDate":         clean.EndDate,
		"isRecurring":     clean.RecurrenceRule != "",
		"rsvpCount":       0,
		"attendanceCount": 0,
		"createdAt":       now,
		"updatedAt":       now,
	}
	setIfPresent(doc, "description", clean.Description)
	setIfPresent(doc, "location", clean.Location)
	setIfPresent(doc, "recurrenceRule", clean.RecurrenceRule)
	if clean.Capacity > 0 {
		doc["capacity"] = clean.Capacity
	}
	if scope.UserID != "" {
		doc["createdBy"] = mongodb.ID(scope.UserID)
	}

	// The check-in code is generated with retries because it is unique per
	// church: two events created in the same second can collide, and a
	// collision must cost a retry rather than the request.
	var created *Event
	for attempt := 0; attempt < 5; attempt++ {
		code, err := newCheckInCode()
		if err != nil {
			return nil, err
		}
		doc["checkInCode"] = code

		res, err := s.events.InsertOne(ctx, doc)
		if err != nil {
			if mongo.IsDuplicateKeyError(err) {
				continue
			}
			return nil, fmt.Errorf("event: create: %w", err)
		}
		created, err = s.byObjectID(ctx, res.InsertedID.(bson.ObjectID))
		if err != nil {
			return nil, err
		}
		break
	}
	if created == nil {
		return nil, errors.New("event: could not allocate a check-in code")
	}
	return created, nil
}

// Update edits an event.
//
// The check-in code is deliberately NOT regenerated. Ushers have devices
// holding it and posters may carry the QR; changing it because somebody fixed a
// typo in the title would silently break check-in at the door.
func (s *Service) Update(ctx context.Context, id string, in Input) (*Event, error) {
	existing, err := s.ByID(ctx, id)
	if err != nil {
		return nil, err
	}
	clean, _, err := in.normalise()
	if err != nil {
		return nil, err
	}

	set := bson.M{
		"title":       clean.Title,
		"startDate":   clean.StartDate,
		"endDate":     clean.EndDate,
		"isRecurring": clean.RecurrenceRule != "",
	}
	unset := bson.M{}
	for field, value := range map[string]string{
		"description":    clean.Description,
		"location":       clean.Location,
		"recurrenceRule": clean.RecurrenceRule,
	} {
		if value != "" {
			set[field] = value
		} else {
			unset[field] = ""
		}
	}
	if clean.Capacity > 0 {
		set["capacity"] = clean.Capacity
	} else {
		unset["capacity"] = ""
	}

	update := bson.M{"$set": set}
	if len(unset) > 0 {
		update["$unset"] = unset
	}
	if _, err := s.events.UpdateOne(ctx, bson.M{"_id": existing.ID}, update); err != nil {
		return nil, fmt.Errorf("event: update: %w", err)
	}
	return s.byObjectID(ctx, existing.ID)
}

// Delete removes an event and everything hanging off it.
//
// RSVPs and attendance go with it. Leaving them would be worse than losing
// them: they reference an event that no longer exists, so every report that
// joins them shows attendance for a blank, and nothing in the product would
// ever surface them again.
func (s *Service) Delete(ctx context.Context, id string) error {
	existing, err := s.ByID(ctx, id)
	if err != nil {
		return err
	}
	if _, err := s.rsvps.DeleteMany(ctx, bson.M{"eventId": existing.ID}); err != nil {
		return fmt.Errorf("event: delete rsvps: %w", err)
	}
	if _, err := s.attendance.DeleteMany(ctx, bson.M{"eventId": existing.ID}); err != nil {
		return fmt.Errorf("event: delete attendance: %w", err)
	}
	if _, err := s.events.DeleteOne(ctx, bson.M{"_id": existing.ID}); err != nil {
		return fmt.Errorf("event: delete: %w", err)
	}
	return nil
}

// Filter narrows a listing.
type Filter struct {
	// From and To bound startDate. Zero means unbounded.
	From time.Time
	To   time.Time
	// Limit caps the result. Zero uses a sane default.
	Limit int64
}

// List returns events by start date.
func (s *Service) List(ctx context.Context, f Filter) ([]Event, error) {
	filter := bson.M{}
	window := bson.M{}
	if !f.From.IsZero() {
		window["$gte"] = f.From.UTC()
	}
	if !f.To.IsZero() {
		window["$lt"] = f.To.UTC()
	}
	if len(window) > 0 {
		// Recurring events are matched by their SERIES start, which is in the
		// past for anything long-running. Excluding them from a future window
		// would hide the Sunday service from every calendar; Upcoming is what
		// expands them into real dates.
		filter["$or"] = []bson.M{
			{"startDate": window},
			{"isRecurring": true},
		}
	}

	limit := f.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}

	var out []Event
	err := s.events.Find(ctx, filter, &out,
		options.Find().SetSort(bson.D{{Key: "startDate", Value: 1}}).SetLimit(limit))
	if err != nil {
		return nil, fmt.Errorf("event: list: %w", err)
	}
	if out == nil {
		out = []Event{}
	}
	return out, nil
}

// ByID returns one event within the caller's church.
func (s *Service) ByID(ctx context.Context, id string) (*Event, error) {
	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return nil, ErrNotFound
	}
	return s.byObjectID(ctx, oid)
}

func (s *Service) byObjectID(ctx context.Context, oid bson.ObjectID) (*Event, error) {
	var found Event
	err := s.events.FindOne(ctx, bson.M{"_id": oid}, &found)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("event: read: %w", err)
	}
	return &found, nil
}

// ByCheckInCode resolves the code an usher's device presents.
func (s *Service) ByCheckInCode(ctx context.Context, code string) (*Event, error) {
	// Upper-cased and stripped because this gets typed by hand when a scan
	// fails, and a phone keyboard offers lower case first.
	normalised := strings.ToUpper(strings.TrimSpace(code))
	normalised = strings.ReplaceAll(normalised, "-", "")
	normalised = strings.ReplaceAll(normalised, " ", "")
	if normalised == "" {
		return nil, ErrCheckInCodeInvalid
	}

	var found Event
	err := s.events.FindOne(ctx, bson.M{"checkInCode": normalised}, &found)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrCheckInCodeInvalid
	}
	if err != nil {
		return nil, fmt.Errorf("event: resolve check-in code: %w", err)
	}
	return &found, nil
}

// --- RSVP ---------------------------------------------------------------------

// Respond records a member's answer, replacing any previous one.
func (s *Service) Respond(ctx context.Context, eventID, memberID string, status RSVPStatus) (*RSVP, error) {
	found, err := s.ByID(ctx, eventID)
	if err != nil {
		return nil, err
	}
	memberID = strings.TrimSpace(memberID)
	if memberID == "" {
		return nil, ErrMemberRequired
	}
	if !status.Valid() {
		return nil, ErrStatusInvalid
	}

	if status == RSVPGoing && found.Capacity > 0 {
		// Counted excluding this member, so somebody re-confirming an existing
		// GOING is never told the event they are already in is full.
		going, err := s.rsvps.CountDocuments(ctx, bson.M{
			"eventId":  found.ID,
			"status":   string(RSVPGoing),
			"memberId": bson.M{"$ne": memberID},
		})
		if err != nil {
			return nil, fmt.Errorf("event: count rsvps: %w", err)
		}
		if going >= int64(found.Capacity) {
			return nil, ErrCapacityReached
		}
	}

	now := s.now().UTC()
	_, err = s.rsvps.UpsertOne(ctx,
		bson.M{"eventId": found.ID, "memberId": memberID},
		bson.M{"$set": bson.M{
			"status":      string(status),
			"respondedAt": now,
		}},
	)
	if err != nil {
		return nil, fmt.Errorf("event: record rsvp: %w", err)
	}

	if err := s.refreshRSVPCount(ctx, found.ID); err != nil {
		return nil, err
	}

	var out RSVP
	if err := s.rsvps.FindOne(ctx,
		bson.M{"eventId": found.ID, "memberId": memberID}, &out); err != nil {
		return nil, fmt.Errorf("event: read rsvp: %w", err)
	}
	return &out, nil
}

// RSVPs lists the answers for an event.
func (s *Service) RSVPs(ctx context.Context, eventID string) ([]RSVP, error) {
	found, err := s.ByID(ctx, eventID)
	if err != nil {
		return nil, err
	}
	var out []RSVP
	err = s.rsvps.Find(ctx, bson.M{"eventId": found.ID}, &out,
		options.Find().SetSort(bson.D{{Key: "respondedAt", Value: 1}}))
	if err != nil {
		return nil, fmt.Errorf("event: list rsvps: %w", err)
	}
	if out == nil {
		out = []RSVP{}
	}
	return out, nil
}

// refreshRSVPCount recomputes the denormalised count.
//
// Recomputed rather than incremented, because an answer can move between
// statuses: a member switching GOING to NOT_GOING would need a decrement that
// depends on their previous answer, and getting that wrong drifts the number
// permanently. RSVP volume is small enough that a count is cheaper than the
// class of bug increments invite.
func (s *Service) refreshRSVPCount(ctx context.Context, eventID bson.ObjectID) error {
	going, err := s.rsvps.CountDocuments(ctx, bson.M{
		"eventId": eventID,
		"status":  string(RSVPGoing),
	})
	if err != nil {
		return fmt.Errorf("event: count rsvps: %w", err)
	}
	if _, err := s.events.UpdateOne(ctx, bson.M{"_id": eventID},
		bson.M{"$set": bson.M{"rsvpCount": int(going)}}); err != nil {
		return fmt.Errorf("event: update rsvp count: %w", err)
	}
	return nil
}

// --- attendance ----------------------------------------------------------------

// futureSkew is how far ahead of the server a device's clock may be before its
// timestamp is treated as wrong.
//
// Phone clocks drift and a few of them are badly wrong. A check-in timestamped
// next Tuesday would sort to the top of every attendance list forever, so it is
// clamped to the server's now — the honest reading of "this happened, and we
// only know that it happened by the time we heard about it".
const futureSkew = 5 * time.Minute

// CheckIn records one person as present.
//
// Returns whether this created a new record. `false` means they were already
// checked in, which is a success — a second scan of the same person is the same
// fact, not an error to show an usher at a door.
func (s *Service) CheckIn(ctx context.Context, eventID string, in CheckIn) (bool, error) {
	result, err := s.Sync(ctx, SyncRequest{EventID: eventID, CheckIns: []CheckIn{in}})
	if err != nil {
		return false, err
	}
	// Sync reports per row because a batch must survive a bad row. One row has
	// no other rows to survive for, so the rejection becomes the error — a
	// caller checking in one person wants to be told why, not handed a list.
	if len(result.Rejected) > 0 {
		switch result.Rejected[0].Reason {
		case reasonNoMember:
			return false, ErrMemberRequired
		case reasonUnknownMember:
			return false, ErrMemberUnknown
		default:
			return false, fmt.Errorf("event: %s", result.Rejected[0].Reason)
		}
	}
	return result.Recorded == 1, nil
}

// Rejection reasons, shared so CheckIn can map them back to typed errors
// without matching on prose that someone will reword.
const (
	reasonNoMember      = "no member was named"
	reasonUnknownMember = "no such member in this church"
)

// Sync reconciles a batch of check-ins captured on a device.
//
// This is the offline queue landing (§8.3). Its contract is that submitting the
// SAME batch twice leaves the same attendance and reports the second run as
// duplicates — because a device that loses signal after sending but before
// hearing the reply has no way to know which happened, and will send again.
//
// The batch never fails as a unit. An usher standing at a door cannot re-scan
// two hundred people because one row named somebody who has since been deleted.
func (s *Service) Sync(ctx context.Context, req SyncRequest) (*SyncResult, error) {
	found, err := s.ByID(ctx, req.EventID)
	if err != nil {
		return nil, err
	}
	batch, offline := req.CheckIns, req.Offline
	scope, _ := tenancy.FromContext(ctx)
	now := s.now().UTC()

	result := &SyncResult{Rejected: []RejectedCheckIn{}}

	// 1. Clean each row, and collapse repeats WITHIN the batch.
	//
	// A device holding two scans of the same person must not report one of them
	// as a duplicate: nothing was duplicated on the server, the device simply
	// scanned twice. Collapsed to the earliest time, because that is when they
	// arrived.
	earliest := map[string]CheckIn{}
	order := []string{}
	for _, row := range batch {
		memberID := strings.TrimSpace(row.MemberID)
		if memberID == "" {
			result.Rejected = append(result.Rejected, RejectedCheckIn{
				MemberID: row.MemberID,
				Reason:   reasonNoMember,
			})
			continue
		}
		if !row.Method.Valid() {
			row.Method = CheckInManual
		}
		at := row.CheckedInAt.UTC()
		if at.IsZero() || at.After(now.Add(futureSkew)) {
			at = now
		}
		row.MemberID, row.CheckedInAt = memberID, at

		if seen, ok := earliest[memberID]; ok {
			if at.Before(seen.CheckedInAt) {
				earliest[memberID] = row
			}
			continue
		}
		earliest[memberID] = row
		order = append(order, memberID)
	}

	// 2. One roster lookup for the whole batch, not one per row.
	if len(order) > 0 && s.roster != nil {
		known, err := s.roster.Exist(ctx, order)
		if err != nil {
			return nil, fmt.Errorf("event: verify members: %w", err)
		}
		kept := order[:0]
		for _, memberID := range order {
			if !known[memberID] {
				result.Rejected = append(result.Rejected, RejectedCheckIn{
					MemberID: memberID,
					Reason:   reasonUnknownMember,
				})
				continue
			}
			kept = append(kept, memberID)
		}
		order = kept
	}

	// 3. One unordered insert. Collisions with the unique index are the
	//    duplicates, and they are counted rather than raised.
	//
	//    Each row is filed against a specific staging of the event — for a
	//    weekly service, which Sunday. See occurrenceFor.
	occurrences := map[time.Time]struct{}{}
	if len(order) > 0 {
		docs := make([]bson.M, 0, len(order))
		for _, memberID := range order {
			row := earliest[memberID]
			occurrence := req.Occurrence.UTC()
			if req.Occurrence.IsZero() {
				occurrence = s.occurrenceFor(found, row.CheckedInAt)
			}
			occurrences[occurrence] = struct{}{}
			doc := bson.M{
				"eventId":      found.ID,
				"memberId":     memberID,
				"occurrenceAt": occurrence,
				"method":       string(row.Method),
				"checkedInAt":  row.CheckedInAt,
				"recordedAt":   now,
			}
			if offline {
				doc["offline"] = true
			}
			if scope.UserID != "" {
				doc["recordedBy"] = mongodb.ID(scope.UserID)
			}
			docs = append(docs, doc)
		}

		res, insertErr := s.attendance.InsertMany(ctx, docs)
		if res != nil {
			result.Recorded = len(res.InsertedIDs)
		}
		if insertErr != nil {
			var bulk mongo.BulkWriteException
			if !errors.As(insertErr, &bulk) {
				return nil, fmt.Errorf("event: record attendance: %w", insertErr)
			}
			for _, we := range bulk.WriteErrors {
				memberID := ""
				if we.Index >= 0 && we.Index < len(order) {
					memberID = order[we.Index]
				}
				if we.Code == duplicateKeyCode {
					result.Duplicate++
					continue
				}
				result.Rejected = append(result.Rejected, RejectedCheckIn{
					MemberID: memberID,
					Reason:   we.Message,
				})
			}
		}
	}

	// 4. Republish the total. Recomputed for the same reason the RSVP count is:
	//    a batch that half-collides cannot be turned into a correct increment
	//    without knowing which half, and the count is one indexed scan.
	total, err := s.attendance.CountDocuments(ctx, bson.M{"eventId": found.ID})
	if err != nil {
		return nil, fmt.Errorf("event: count attendance: %w", err)
	}
	if _, err := s.events.UpdateOne(ctx, bson.M{"_id": found.ID},
		bson.M{"$set": bson.M{"attendanceCount": int(total)}}); err != nil {
		return nil, fmt.Errorf("event: update attendance count: %w", err)
	}
	result.AttendanceCount = int(total)

	// The number the usher actually wants: how many were in THIS service, not
	// how many have ever attended this weekly slot. Only meaningful when the
	// batch landed on one occurrence, which is the normal case — a batch
	// straddling two is an administrator typing up a backlog, and there is no
	// single right answer to report to them.
	if len(occurrences) == 1 {
		for occurrence := range occurrences {
			present, err := s.attendance.CountDocuments(ctx, bson.M{
				"eventId":      found.ID,
				"occurrenceAt": occurrence,
			})
			if err != nil {
				return nil, fmt.Errorf("event: count occurrence attendance: %w", err)
			}
			at := occurrence
			result.OccurrenceAttendance = int(present)
			result.OccurrenceAt = &at
		}
	}

	if len(result.Rejected) == 0 {
		result.Rejected = nil
	}
	return result, nil
}

// duplicateKeyCode is MongoDB's E11000.
const duplicateKeyCode = 11000

// occurrenceFor decides WHICH staging of an event a check-in belongs to.
//
// A one-off event has exactly one, and the question does not arise. A weekly
// service has one per week, and a scan has to be filed against the right one or
// the uniqueness key stops meaning anything.
//
// It SNAPS to the nearest scheduled occurrence rather than truncating the
// timestamp to a date. Truncating looks simpler and is wrong twice over: it
// files a 23:50 setup scan against the previous day, and it depends on a
// timezone the server does not know — the church's, not UTC's. Snapping needs
// neither, because the schedule already carries both.
func (s *Service) occurrenceFor(e *Event, at time.Time) time.Time {
	if !e.IsRecurring || e.RecurrenceRule == "" {
		return e.StartDate.UTC()
	}
	rule, err := ParseRecurrence(e.RecurrenceRule)
	if err != nil {
		return e.StartDate.UTC()
	}

	// A month either side covers every supported frequency, including a
	// monthly service checked in a fortnight late.
	window := 31 * 24 * time.Hour
	candidates := rule.Occurrences(e.StartDate.UTC(), at.Add(-window), at.Add(window), 128)
	if len(candidates) == 0 {
		// The series ended, or has not begun. Filing against the series start
		// keeps the record rather than losing it, and keeps it obviously odd
		// rather than plausibly wrong.
		return e.StartDate.UTC()
	}

	best := candidates[0]
	bestGap := absDuration(at.Sub(best))
	for _, candidate := range candidates[1:] {
		if gap := absDuration(at.Sub(candidate)); gap < bestGap {
			best, bestGap = candidate, gap
		}
	}
	return best.UTC()
}

func absDuration(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}

// Attendance lists who was present, earliest first.
//
// occurrence narrows to one staging of a recurring event. Zero returns every
// occurrence, which is what a "total attendance" view wants and what a register
// for one Sunday very much does not.
func (s *Service) Attendance(ctx context.Context, eventID string, occurrence time.Time) ([]Attendance, error) {
	found, err := s.ByID(ctx, eventID)
	if err != nil {
		return nil, err
	}
	filter := bson.M{"eventId": found.ID}
	if !occurrence.IsZero() {
		filter["occurrenceAt"] = occurrence.UTC()
	}

	var out []Attendance
	err = s.attendance.Find(ctx, filter, &out,
		options.Find().SetSort(bson.D{{Key: "checkedInAt", Value: 1}}))
	if err != nil {
		return nil, fmt.Errorf("event: list attendance: %w", err)
	}
	if out == nil {
		out = []Attendance{}
	}
	return out, nil
}

// --- occurrences ----------------------------------------------------------------

// Occurrence is one concrete date an event happens on.
//
// A recurring event is one document; a calendar needs dates. This is the
// difference, and it is computed rather than stored — see recurrence.go.
type Occurrence struct {
	ID          bson.ObjectID `json:"id"`
	Title       string        `json:"title"`
	Description string        `json:"description,omitempty"`
	Location    string        `json:"location,omitempty"`
	StartsAt    time.Time     `json:"startsAt"`
	EndsAt      time.Time     `json:"endsAt"`
	IsRecurring bool          `json:"isRecurring"`
	Capacity    int           `json:"capacity,omitempty"`
	RSVPCount   int           `json:"rsvpCount"`
}

// occurrenceHorizon bounds how far ahead a recurring series is expanded.
//
// Without it "every Sunday, forever" produces an infinite calendar. A year is
// past the point anybody plans to, and the query is re-run on every read, so
// the horizon moves with time rather than needing a job.
const occurrenceHorizon = 365 * 24 * time.Hour

// Upcoming returns the next dates anything happens, recurring events expanded.
//
// This is what the public site's events block reads. A church whose only event
// is "Sunday service, weekly" has a website that must still say when the next
// one is — listing the stored row would show the date the series began, which
// for an established church is years ago.
func (s *Service) Upcoming(ctx context.Context, limit int) ([]Occurrence, error) {
	if limit <= 0 {
		limit = 5
	}
	now := s.now().UTC()
	horizon := now.Add(occurrenceHorizon)

	// Everything that either has not happened yet or recurs. A one-off in the
	// past is excluded by the query rather than by the expansion, so the number
	// of documents read stays proportional to what is actually upcoming.
	var events []Event
	err := s.events.Find(ctx, bson.M{"$or": []bson.M{
		{"startDate": bson.M{"$gte": now}},
		{"isRecurring": true},
	}}, &events, options.Find().SetSort(bson.D{{Key: "startDate", Value: 1}}).SetLimit(200))
	if err != nil {
		return nil, fmt.Errorf("event: upcoming: %w", err)
	}

	out := []Occurrence{}
	for i := range events {
		for _, at := range occurrencesOf(&events[i], now, horizon, limit) {
			out = append(out, Occurrence{
				ID:          events[i].ID,
				Title:       events[i].Title,
				Description: events[i].Description,
				Location:    events[i].Location,
				StartsAt:    at,
				EndsAt:      at.Add(events[i].EndDate.Sub(events[i].StartDate)),
				IsRecurring: events[i].IsRecurring,
				Capacity:    events[i].Capacity,
				RSVPCount:   events[i].RSVPCount,
			})
		}
	}

	sort.Slice(out, func(i, j int) bool { return out[i].StartsAt.Before(out[j].StartsAt) })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

// occurrencesOf expands one event within a window.
//
// A recurrence rule that fails to parse falls back to the stored start date
// rather than dropping the event. The rule is validated on write, so this can
// only be reached by data that predates the validation or was written by
// another writer — and an event shown once is better than an event that
// silently vanishes from a church's website.
func occurrencesOf(e *Event, from, to time.Time, limit int) []time.Time {
	if !e.IsRecurring || e.RecurrenceRule == "" {
		if e.StartDate.Before(from) {
			return nil
		}
		return []time.Time{e.StartDate}
	}
	rule, err := ParseRecurrence(e.RecurrenceRule)
	if err != nil {
		if e.StartDate.Before(from) {
			return nil
		}
		return []time.Time{e.StartDate}
	}
	return rule.Occurrences(e.StartDate.UTC(), from, to, limit)
}

// --- helpers --------------------------------------------------------------------

// checkInAlphabet excludes characters people confuse when reading a code off a
// screen and typing it into a phone: 0/O, 1/I/L, 5/S, 8/B.
const checkInAlphabet = "ACDEFGHJKMNPQRTUVWXY2346789"

// newCheckInCode returns a short, unambiguous, unguessable code.
//
// Six characters from a 27-symbol alphabet is about 28 bits — not a secret, and
// not treated as one: the code identifies an event to an authenticated usher,
// it does not authorise anything on its own.
func newCheckInCode() (string, error) {
	const length = 6
	buf := make([]byte, length)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("event: generate check-in code: %w", err)
	}
	out := make([]byte, length)
	for i, b := range buf {
		out[i] = checkInAlphabet[int(b)%len(checkInAlphabet)]
	}
	return string(out), nil
}

// setIfPresent writes a field only when it has a value.
//
// The distinction between an absent field and an empty string is invisible in
// Go and decisive in MongoDB, where "" is an ordinary value a unique or sparse
// index will happily collide on.
func setIfPresent(doc bson.M, field, value string) {
	if value != "" {
		doc[field] = value
	}
}
