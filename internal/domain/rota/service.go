package rota

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/domain/event"
	"github.com/hayfordstanley/altar-os/internal/domain/notification"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// Notifier delivers a message to one member. Satisfied by the WP-15
// notification service, which owns preference, quiet hours, dedupe and retry.
type Notifier interface {
	Send(ctx context.Context, msg notification.Message) (*notification.Notification, error)
}

// Events resolves the service a rota hangs off.
type Events interface {
	ByID(ctx context.Context, id string) (*event.Event, error)
}

// Service is volunteer scheduling.
type Service struct {
	assignments *mongodb.TenantCollection
	unavailable *mongodb.TenantCollection
	events      Events
	notifier    Notifier
	now         func() time.Time
}

// NewService builds the rota service.
func NewService(db *mongodb.DB, events Events, notifier Notifier) *Service {
	return &Service{
		assignments: db.Tenant(AssignmentCollection),
		unavailable: db.Tenant(UnavailableCollection),
		events:      events,
		notifier:    notifier,
		now:         time.Now,
	}
}

// EnsureIndexes creates the constraints scheduling depends on.
func (s *Service) EnsureIndexes(ctx context.Context) error {
	err := s.assignments.EnsureIndexes(ctx, []mongo.IndexModel{
		{
			// One person, one role, one service. A second row for the same
			// trio is the same fact typed twice, and the database refusing it
			// is cheaper than every caller remembering to check.
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "eventId", Value: 1},
				{Key: "occurrenceAt", Value: 1},
				{Key: "role", Value: 1},
				{Key: "memberId", Value: 1},
			},
			Options: options.Index().SetName("uq_rota_slot").SetUnique(true),
		},
		{
			// Reading a rota: everything for a service, in role order.
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "occurrenceAt", Value: 1},
				{Key: "role", Value: 1},
			},
			Options: options.Index().SetName("church_rota_service"),
		},
		{
			// A volunteer's own upcoming commitments, and the double-booking
			// check, which both read by member and date.
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "memberId", Value: 1},
				{Key: "occurrenceAt", Value: 1},
			},
			Options: options.Index().SetName("church_rota_member"),
		},
		{
			// The reminder sweeper: published, unreminded, coming up.
			Keys: bson.D{
				{Key: "status", Value: 1},
				{Key: "occurrenceAt", Value: 1},
			},
			Options: options.Index().SetName("rota_due_reminders"),
		},
	})
	if err != nil {
		return fmt.Errorf("rota: create assignment indexes: %w", err)
	}

	err = s.unavailable.EnsureIndexes(ctx, []mongo.IndexModel{
		{
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "memberId", Value: 1},
				{Key: "to", Value: 1},
			},
			Options: options.Index().SetName("church_unavailability"),
		},
	})
	if err != nil {
		return fmt.Errorf("rota: create unavailability indexes: %w", err)
	}
	return nil
}

// AssignInput is one slot being filled.
type AssignInput struct {
	EventID      string
	OccurrenceAt time.Time
	Role         string
	MemberID     string
	// Force schedules somebody who has blocked the date. A team leader who has
	// spoken to the person needs to be able to override, but the override is
	// EXPLICIT — a scheduler that silently ignores stated unavailability is one
	// volunteers stop bothering to update.
	Force bool
}

func (in AssignInput) normalise() (AssignInput, error) {
	out := in
	out.Role = strings.TrimSpace(in.Role)
	out.MemberID = strings.TrimSpace(in.MemberID)
	if out.Role == "" {
		return out, ErrRoleRequired
	}
	if out.MemberID == "" {
		return out, ErrMemberRequired
	}
	if out.OccurrenceAt.IsZero() {
		return out, ErrOccurrenceRequired
	}
	out.OccurrenceAt = out.OccurrenceAt.UTC()
	return out, nil
}

// Assign schedules a volunteer, as a DRAFT.
//
// Draft rather than published, because a team leader builds a month at a time
// and publishing each row as it is typed would send a volunteer six
// notifications for a rota still being thought about — and then more when it
// changes.
func (s *Service) Assign(ctx context.Context, in AssignInput) (*Assignment, error) {
	clean, err := in.normalise()
	if err != nil {
		return nil, err
	}
	svc, err := s.events.ByID(ctx, clean.EventID)
	if err != nil {
		return nil, err
	}
	// The date has to be a time the service actually happens. Without this a
	// mistyped occurrence — or a date copied from a different service — builds
	// a rota nobody will ever see, and the first anyone knows is the Sunday
	// nobody turns up.
	if !svc.Occurs(clean.OccurrenceAt) {
		return nil, ErrNotAnOccurrence
	}

	if !clean.Force {
		blocked, err := s.IsUnavailable(ctx, clean.MemberID, clean.OccurrenceAt)
		if err != nil {
			return nil, err
		}
		if blocked {
			return nil, ErrUnavailable
		}
	}

	// Double-booking is checked against every OTHER role at the same moment.
	// Two roles at 9am is a person who will do neither well.
	clash, err := s.committedAt(ctx, clean.MemberID, clean.OccurrenceAt, clean.Role)
	if err != nil {
		return nil, err
	}
	if clash {
		return nil, ErrDoubleBooked
	}

	scope, _ := tenancy.FromContext(ctx)
	now := s.now().UTC()
	doc := bson.M{
		"eventId":      svc.ID,
		"occurrenceAt": clean.OccurrenceAt,
		"role":         clean.Role,
		"memberId":     clean.MemberID,
		"status":       string(StatusDraft),
		"createdAt":    now,
		"updatedAt":    now,
	}
	if scope.UserID != "" {
		doc["assignedBy"] = mongodb.ID(scope.UserID)
	}

	res, err := s.assignments.InsertOne(ctx, doc)
	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			return nil, ErrAlreadyAssigned
		}
		return nil, fmt.Errorf("rota: assign: %w", err)
	}
	return s.byObjectID(ctx, res.InsertedID.(bson.ObjectID))
}

// committedAt reports whether a member is already serving at a moment, in any
// role other than the one being considered.
func (s *Service) committedAt(ctx context.Context, memberID string, at time.Time, exceptRole string) (bool, error) {
	var found []Assignment
	err := s.assignments.Find(ctx, bson.M{
		"memberId":     memberID,
		"occurrenceAt": at,
		"role":         bson.M{"$ne": exceptRole},
		"status": bson.M{"$in": []string{
			string(StatusDraft), string(StatusAssigned),
			string(StatusAccepted), string(StatusSwapRequested),
		}},
	}, &found, options.Find().SetLimit(1))
	if err != nil {
		return false, fmt.Errorf("rota: check double booking: %w", err)
	}
	return len(found) > 0, nil
}

// Publish makes a service's draft assignments real and tells the volunteers.
//
// Returns how many were published. Publishing an already-published rota is not
// an error — a team leader who adds one person to next Sunday and presses
// publish again should get that one person notified, not a refusal.
func (s *Service) Publish(ctx context.Context, eventID string, occurrenceAt time.Time) (int, error) {
	svc, err := s.events.ByID(ctx, eventID)
	if err != nil {
		return 0, err
	}

	var drafts []Assignment
	err = s.assignments.Find(ctx, bson.M{
		"eventId":      svc.ID,
		"occurrenceAt": occurrenceAt.UTC(),
		"status":       string(StatusDraft),
	}, &drafts)
	if err != nil {
		return 0, fmt.Errorf("rota: find drafts: %w", err)
	}

	now := s.now().UTC()
	published := 0
	for i := range drafts {
		// One at a time with a status guard, so two team leaders pressing
		// publish together cannot each notify the same volunteer.
		res, err := s.assignments.UpdateOne(ctx,
			bson.M{"_id": drafts[i].ID, "status": string(StatusDraft)},
			bson.M{"$set": bson.M{
				"status":      string(StatusAssigned),
				"publishedAt": now,
			}})
		if err != nil {
			return published, fmt.Errorf("rota: publish: %w", err)
		}
		if res.ModifiedCount == 0 {
			continue
		}
		published++
		s.tell(ctx, &drafts[i], svc,
			fmt.Sprintf("You are on %s for %s on %s. Reply in the app to confirm.",
				drafts[i].Role, svc.Title, humanDate(drafts[i].OccurrenceAt)),
			"rota:published")
	}
	return published, nil
}

// Respond records a volunteer's answer to their own assignment.
func (s *Service) Respond(ctx context.Context, assignmentID, memberID string, accept bool, note string) (*Assignment, error) {
	found, err := s.ByID(ctx, assignmentID)
	if err != nil {
		return nil, err
	}
	// A volunteer answers for THEMSELVES. Without this check, anybody holding a
	// rota permission could decline on somebody else's behalf, and the person
	// would find out by not being expected.
	if found.MemberID != strings.TrimSpace(memberID) {
		return nil, ErrNotYours
	}

	status := StatusAccepted
	if !accept {
		status = StatusDeclined
	}
	now := s.now().UTC()

	set := bson.M{"status": string(status), "respondedAt": now}
	if note = strings.TrimSpace(note); note != "" {
		set["note"] = note
	}
	if _, err := s.assignments.UpdateOne(ctx, bson.M{"_id": found.ID},
		bson.M{"$set": set}); err != nil {
		return nil, fmt.Errorf("rota: respond: %w", err)
	}

	// A decline is the thing a team leader has to know about NOW. An
	// acceptance is not news.
	if !accept {
		s.tellLeader(ctx, found, note)
	}
	return s.byObjectID(ctx, found.ID)
}

// RequestSwap asks to be replaced on a slot already accepted.
//
// The volunteer stays committed until somebody takes it. That is deliberate:
// the alternative frees the slot the moment somebody asks, and a team leader
// reading the rota on Saturday sees a gap they think is covered by whoever
// asked — or worse, sees it filled and it is not.
func (s *Service) RequestSwap(ctx context.Context, assignmentID, memberID, note string) (*Assignment, error) {
	found, err := s.ByID(ctx, assignmentID)
	if err != nil {
		return nil, err
	}
	if found.MemberID != strings.TrimSpace(memberID) {
		return nil, ErrNotYours
	}
	if !found.Status.Committed() {
		return nil, ErrNotOpen
	}

	set := bson.M{"status": string(StatusSwapRequested), "updatedAt": s.now().UTC()}
	if note = strings.TrimSpace(note); note != "" {
		set["note"] = note
	}
	if _, err := s.assignments.UpdateOne(ctx, bson.M{"_id": found.ID},
		bson.M{"$set": set}); err != nil {
		return nil, fmt.Errorf("rota: request swap: %w", err)
	}
	return s.byObjectID(ctx, found.ID)
}

// AcceptSwap takes over a slot somebody asked to be replaced on.
//
// The whole operation turns on ONE conditional update. Two volunteers accepting
// the same open slot within a second of each other is the normal case in a
// church coordinating over WhatsApp, and the loser has to be told they lost —
// not silently double-booked with the winner.
func (s *Service) AcceptSwap(ctx context.Context, assignmentID, memberID string) (*Assignment, error) {
	found, err := s.ByID(ctx, assignmentID)
	if err != nil {
		return nil, err
	}
	memberID = strings.TrimSpace(memberID)
	if memberID == "" {
		return nil, ErrMemberRequired
	}
	if memberID == found.MemberID {
		// Taking over your own slot is a no-op dressed as an action.
		return nil, ErrNotOpen
	}
	if found.Status != StatusSwapRequested {
		return nil, ErrNotOpen
	}

	blocked, err := s.IsUnavailable(ctx, memberID, found.OccurrenceAt)
	if err != nil {
		return nil, err
	}
	if blocked {
		return nil, ErrUnavailable
	}
	clash, err := s.committedAt(ctx, memberID, found.OccurrenceAt, "")
	if err != nil {
		return nil, err
	}
	if clash {
		return nil, ErrDoubleBooked
	}

	now := s.now().UTC()

	// The original assignment is retired rather than reassigned, so the
	// history says who was on it and who took it over. Guarded on the status
	// it was read at: if somebody else got here first it is no longer
	// swap_requested and this matches nothing.
	res, err := s.assignments.UpdateOne(ctx,
		bson.M{"_id": found.ID, "status": string(StatusSwapRequested)},
		bson.M{"$set": bson.M{"status": string(StatusSwappedOut), "updatedAt": now}})
	if err != nil {
		return nil, fmt.Errorf("rota: accept swap: %w", err)
	}
	if res.ModifiedCount == 0 {
		return nil, ErrNotOpen
	}

	scope, _ := tenancy.FromContext(ctx)
	doc := bson.M{
		"eventId":      found.EventID,
		"occurrenceAt": found.OccurrenceAt,
		"role":         found.Role,
		"memberId":     memberID,
		"status":       string(StatusAccepted),
		"swappedFrom":  found.MemberID,
		"publishedAt":  now,
		"respondedAt":  now,
		"createdAt":    now,
		"updatedAt":    now,
	}
	if scope.UserID != "" {
		doc["assignedBy"] = mongodb.ID(scope.UserID)
	}

	created, err := s.assignments.InsertOne(ctx, doc)
	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			// This person already had a row for this slot — they declined it
			// earlier and are now taking it back. Put the existing row into
			// the accepted state rather than failing.
			if _, uerr := s.assignments.UpdateOne(ctx, bson.M{
				"eventId": found.EventID, "occurrenceAt": found.OccurrenceAt,
				"role": found.Role, "memberId": memberID,
			}, bson.M{"$set": bson.M{
				"status": string(StatusAccepted), "swappedFrom": found.MemberID,
				"respondedAt": now,
			}}); uerr != nil {
				return nil, fmt.Errorf("rota: reinstate swap: %w", uerr)
			}
			return s.slotHolder(ctx, found, memberID)
		}
		// The original is already retired and this failed. Put it back rather
		// than leaving a service with nobody on it.
		_, _ = s.assignments.UpdateOne(ctx, bson.M{"_id": found.ID},
			bson.M{"$set": bson.M{"status": string(StatusSwapRequested)}})
		return nil, fmt.Errorf("rota: take over slot: %w", err)
	}

	if svc, err := s.events.ByID(ctx, found.EventID.Hex()); err == nil {
		s.tell(ctx, &Assignment{MemberID: found.MemberID, Role: found.Role,
			OccurrenceAt: found.OccurrenceAt}, svc,
			fmt.Sprintf("Your %s slot on %s has been covered. Thank you for letting us know.",
				found.Role, humanDate(found.OccurrenceAt)),
			"rota:swap-covered")
	}
	return s.byObjectID(ctx, created.InsertedID.(bson.ObjectID))
}

func (s *Service) slotHolder(ctx context.Context, from *Assignment, memberID string) (*Assignment, error) {
	var out Assignment
	err := s.assignments.FindOne(ctx, bson.M{
		"eventId": from.EventID, "occurrenceAt": from.OccurrenceAt,
		"role": from.Role, "memberId": memberID,
	}, &out)
	if err != nil {
		return nil, fmt.Errorf("rota: read slot holder: %w", err)
	}
	return &out, nil
}

// --- reading -------------------------------------------------------------------

// ByID returns one assignment within the caller's church.
func (s *Service) ByID(ctx context.Context, id string) (*Assignment, error) {
	oid, err := bson.ObjectIDFromHex(strings.TrimSpace(id))
	if err != nil {
		return nil, ErrNotFound
	}
	return s.byObjectID(ctx, oid)
}

func (s *Service) byObjectID(ctx context.Context, oid bson.ObjectID) (*Assignment, error) {
	var out Assignment
	err := s.assignments.FindOne(ctx, bson.M{"_id": oid}, &out)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("rota: read assignment: %w", err)
	}
	return &out, nil
}

// ForService returns one date's rota, grouped by role.
func (s *Service) ForService(ctx context.Context, eventID string, occurrenceAt time.Time) (*ServiceRota, error) {
	svc, err := s.events.ByID(ctx, eventID)
	if err != nil {
		return nil, err
	}

	var rows []Assignment
	err = s.assignments.Find(ctx, bson.M{
		"eventId":      svc.ID,
		"occurrenceAt": occurrenceAt.UTC(),
	}, &rows, options.Find().SetSort(bson.D{{Key: "role", Value: 1}}))
	if err != nil {
		return nil, fmt.Errorf("rota: read service rota: %w", err)
	}

	byRole := map[string][]Assignment{}
	order := []string{}
	for _, a := range rows {
		if _, seen := byRole[a.Role]; !seen {
			order = append(order, a.Role)
		}
		byRole[a.Role] = append(byRole[a.Role], a)
	}
	sort.Strings(order)

	out := &ServiceRota{
		EventID:      svc.ID,
		EventTitle:   svc.Title,
		OccurrenceAt: occurrenceAt.UTC(),
		Slots:        []Slot{},
	}
	for _, role := range order {
		slot := Slot{Role: role, OccurrenceAt: out.OccurrenceAt, Assignments: byRole[role]}
		for _, a := range byRole[role] {
			// Only what still represents somebody serving. A slot whose only
			// volunteer declined is NOT filled, and showing it as filled is how
			// a service arrives with no sound engineer.
			if a.Status.Committed() {
				slot.Filled++
			}
		}
		slot.NeedsCover = slot.Filled == 0
		if slot.NeedsCover {
			out.Unfilled++
		}
		out.Slots = append(out.Slots, slot)
	}
	return out, nil
}

// Mine returns a volunteer's own upcoming commitments.
func (s *Service) Mine(ctx context.Context, memberID string, from time.Time) ([]Assignment, error) {
	if from.IsZero() {
		from = s.now().UTC()
	}
	out := []Assignment{}
	err := s.assignments.Find(ctx, bson.M{
		"memberId":     strings.TrimSpace(memberID),
		"occurrenceAt": bson.M{"$gte": from.UTC()},
		// Drafts are excluded: they are not yet a commitment and showing them
		// would tell a volunteer they are serving before anybody decided.
		"status": bson.M{"$ne": string(StatusDraft)},
	}, &out, options.Find().SetSort(bson.D{{Key: "occurrenceAt", Value: 1}}).SetLimit(100))
	if err != nil {
		return nil, fmt.Errorf("rota: read my rota: %w", err)
	}
	return out, nil
}

// OpenSlots returns slots somebody has asked to be swapped out of.
func (s *Service) OpenSlots(ctx context.Context, from time.Time) ([]Assignment, error) {
	if from.IsZero() {
		from = s.now().UTC()
	}
	out := []Assignment{}
	err := s.assignments.Find(ctx, bson.M{
		"status":       bson.M{"$in": []string{string(StatusSwapRequested), string(StatusDeclined)}},
		"occurrenceAt": bson.M{"$gte": from.UTC()},
	}, &out, options.Find().SetSort(bson.D{{Key: "occurrenceAt", Value: 1}}).SetLimit(100))
	if err != nil {
		return nil, fmt.Errorf("rota: read open slots: %w", err)
	}
	return out, nil
}

// --- availability ---------------------------------------------------------------

// BlockDates records that a volunteer cannot serve in a window.
func (s *Service) BlockDates(ctx context.Context, memberID string, from, to time.Time, reason string) (*Unavailability, error) {
	memberID = strings.TrimSpace(memberID)
	if memberID == "" {
		return nil, ErrMemberRequired
	}
	if from.IsZero() || to.IsZero() || !to.After(from) {
		return nil, fmt.Errorf("%w: the end has to be after the start", ErrOccurrenceRequired)
	}

	res, err := s.unavailable.InsertOne(ctx, bson.M{
		"memberId":  memberID,
		"from":      from.UTC(),
		"to":        to.UTC(),
		"reason":    strings.TrimSpace(reason),
		"createdAt": s.now().UTC(),
	})
	if err != nil {
		return nil, fmt.Errorf("rota: block dates: %w", err)
	}

	var out Unavailability
	if err := s.unavailable.FindOne(ctx,
		bson.M{"_id": res.InsertedID}, &out); err != nil {
		return nil, fmt.Errorf("rota: read block: %w", err)
	}
	return &out, nil
}

// IsUnavailable reports whether a volunteer has blocked a moment.
func (s *Service) IsUnavailable(ctx context.Context, memberID string, at time.Time) (bool, error) {
	var found []Unavailability
	err := s.unavailable.Find(ctx, bson.M{
		"memberId": strings.TrimSpace(memberID),
		"from":     bson.M{"$lte": at.UTC()},
		"to":       bson.M{"$gt": at.UTC()},
	}, &found, options.Find().SetLimit(1))
	if err != nil {
		return false, fmt.Errorf("rota: check availability: %w", err)
	}
	return len(found) > 0, nil
}

// --- reminders --------------------------------------------------------------------

// reminderLead is how far ahead a volunteer is reminded.
//
// Three days, not one. A person who has forgotten they are on sound needs long
// enough to arrange a swap; a reminder the night before is an announcement that
// the service has a problem.
const reminderLead = 72 * time.Hour

// SendReminders tells volunteers about commitments coming up.
//
// Idempotent through remindedAt: a sweeper that runs every hour must not send
// an hourly reminder, and a process that crashes mid-run must be safe to re-run.
func (s *Service) SendReminders(ctx context.Context) (int, error) {
	now := s.now().UTC()

	var due []Assignment
	err := s.assignments.Find(ctx, bson.M{
		// Committed only. Reminding somebody about a slot they declined is
		// how a volunteer learns to ignore the reminders.
		"status": bson.M{"$in": []string{
			string(StatusAssigned), string(StatusAccepted),
		}},
		"occurrenceAt": bson.M{"$gte": now, "$lte": now.Add(reminderLead)},
		"remindedAt":   bson.M{"$exists": false},
	}, &due, options.Find().SetLimit(500))
	if err != nil {
		return 0, fmt.Errorf("rota: find due reminders: %w", err)
	}

	sent := 0
	for i := range due {
		// Stamped BEFORE sending, and guarded on it still being absent. Two
		// sweepers running together would otherwise both send. The cost of
		// this order is a reminder lost when a send fails; the cost of the
		// other order is a volunteer getting the same reminder every hour,
		// which is worse and is the one people complain about.
		res, err := s.assignments.UpdateOne(ctx,
			bson.M{"_id": due[i].ID, "remindedAt": bson.M{"$exists": false}},
			bson.M{"$set": bson.M{"remindedAt": now}})
		if err != nil {
			return sent, fmt.Errorf("rota: stamp reminder: %w", err)
		}
		if res.ModifiedCount == 0 {
			continue
		}

		svc, err := s.events.ByID(ctx, due[i].EventID.Hex())
		if err != nil {
			continue
		}
		s.tell(ctx, &due[i], svc,
			fmt.Sprintf("Reminder: you are on %s for %s on %s.",
				due[i].Role, svc.Title, humanDate(due[i].OccurrenceAt)),
			"rota:reminder")
		sent++
	}
	return sent, nil
}

// tell sends one volunteer a message about their own rota.
//
// KindTransactional, and this is a judgement worth stating. A rota message is
// church-initiated, which looks like an announcement — but the member ASKED for
// it by agreeing to serve, which is exactly the test the notification package
// applies: transactional is "necessary to perform the service the member asked
// for". Gating it on communications consent would mean a volunteer who declined
// a newsletter silently stops being told when they are on the sound desk, and
// the church finds out on a Sunday morning.
//
// The narrowness matters: this only ever goes to the ONE person the assignment
// names, and only about their own commitment. A broadcast to volunteers about
// anything else is an announcement and belongs in the communication service.
func (s *Service) tell(ctx context.Context, a *Assignment, svc *event.Event, body, tag string) {
	if s.notifier == nil || a.MemberID == "" {
		return
	}
	_, _ = s.notifier.Send(ctx, notification.Message{
		MemberID: a.MemberID,
		Channel:  notification.ChannelSMS,
		Kind:     notification.KindTransactional,
		Body:     body,
		// One key per (tag, member, service, role), so a re-run of a sweeper or
		// a re-pressed publish does not message anybody twice.
		DedupeKey: fmt.Sprintf("%s:%s:%s:%s:%s", tag, a.MemberID,
			a.OccurrenceAt.Format(time.RFC3339), a.Role, svc.ID.Hex()),
	})
}

// tellLeader notifies whoever scheduled the volunteer that they declined.
//
// The person who built the rota is the person who has to fix it, so the message
// goes to them rather than to a general channel where it is one of forty.
func (s *Service) tellLeader(ctx context.Context, a *Assignment, note string) {
	if s.notifier == nil || a.AssignedBy.IsZero() {
		return
	}
	body := fmt.Sprintf("A volunteer has declined %s on %s.",
		a.Role, humanDate(a.OccurrenceAt))
	if note != "" {
		body += " They said: " + note
	}
	_, _ = s.notifier.Send(ctx, notification.Message{
		MemberID:  a.AssignedBy.String(),
		Channel:   notification.ChannelSMS,
		Kind:      notification.KindTransactional,
		Body:      body,
		DedupeKey: "rota:declined:" + a.ID.Hex(),
	})
}

// humanDate is how a church says a date out loud.
func humanDate(at time.Time) string {
	return at.UTC().Format("Mon 2 Jan, 3:04pm")
}
