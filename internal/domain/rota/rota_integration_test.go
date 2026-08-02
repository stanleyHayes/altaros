package rota

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/domain/event"
	"github.com/hayfordstanley/altar-os/internal/domain/notification"
	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

// WP-33 acceptance: "a rota publishes, a volunteer declines, a swap is
// accepted, and reminders fire." Each is a test below, plus the three things
// the package comment says must not go wrong.

type stubEvents struct{ svc *event.Event }

func (s stubEvents) ByID(context.Context, string) (*event.Event, error) {
	return s.svc, nil
}

type capturedMessage struct {
	MemberID  string
	Body      string
	Kind      notification.Kind
	DedupeKey string
}

type stubNotifier struct {
	mu   sync.Mutex
	sent []capturedMessage
	// seen enforces dedupe the way the real notification service does, so a
	// test can prove a re-run does not message anybody twice.
	seen map[string]bool
}

func newNotifier() *stubNotifier {
	return &stubNotifier{seen: map[string]bool{}}
}

func (n *stubNotifier) Send(_ context.Context, msg notification.Message) (*notification.Notification, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if msg.DedupeKey != "" && n.seen[msg.DedupeKey] {
		return &notification.Notification{Status: notification.StatusSent}, nil
	}
	if msg.DedupeKey != "" {
		n.seen[msg.DedupeKey] = true
	}
	n.sent = append(n.sent, capturedMessage{
		MemberID: msg.MemberID, Body: msg.Body,
		Kind: msg.Kind, DedupeKey: msg.DedupeKey,
	})
	return &notification.Notification{Status: notification.StatusSent}, nil
}

func (n *stubNotifier) count() int {
	n.mu.Lock()
	defer n.mu.Unlock()
	return len(n.sent)
}

func (n *stubNotifier) to(memberID string) []capturedMessage {
	n.mu.Lock()
	defer n.mu.Unlock()
	out := []capturedMessage{}
	for _, m := range n.sent {
		if m.MemberID == memberID {
			out = append(out, m)
		}
	}
	return out
}

type fixture struct {
	svc      *Service
	ctx      context.Context
	notifier *stubNotifier
	event    *event.Event
	sunday   time.Time
	leader   string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()

	uri := testsupport.MongoURI()
	connect, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	db, err := mongodb.Connect(connect, config.MongoConfig{
		URI:            uri,
		Database:       "altar_test_rota",
		ConnectTimeout: 3 * time.Second,
	})
	if err != nil {
		testsupport.SkipOrFail(t, "MongoDB at "+uri, err)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = db.Database().Drop(c)
		_ = db.Close(c)
	})

	leader := bson.NewObjectID().Hex()
	ctx := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: bson.NewObjectID().Hex(),
		UserID:   leader,
	})

	// A real weekly service, because Assign now checks that the date is a time
	// the service actually happens. A stub with no schedule would make every
	// assignment in this file test a validation that cannot fire.
	start := time.Now().UTC().AddDate(0, 0, 21).Truncate(time.Hour)
	svc := &event.Event{
		ID: bson.NewObjectID(), Title: "Sunday Service",
		StartDate: start, EndDate: start.Add(2 * time.Hour),
		IsRecurring: true, RecurrenceRule: "FREQ=WEEKLY",
	}
	notifier := newNotifier()
	rota := NewService(db, stubEvents{svc: svc}, notifier)
	if err := rota.EnsureIndexes(ctx); err != nil {
		t.Fatalf("indexes: %v", err)
	}

	return &fixture{
		svc: rota, ctx: ctx, notifier: notifier, event: svc,
		// The series start: comfortably outside the reminder window, so a test
		// that is not about reminders does not accidentally trigger them.
		sunday: start,
		leader: leader,
	}
}

func (f *fixture) assign(t *testing.T, role, member string) *Assignment {
	t.Helper()
	a, err := f.svc.Assign(f.ctx, AssignInput{
		EventID: f.event.ID.Hex(), OccurrenceAt: f.sunday,
		Role: role, MemberID: member,
	})
	if err != nil {
		t.Fatalf("assign %s/%s: %v", role, member, err)
	}
	return a
}

func TestARotaPublishesDeclinesAndSwaps(t *testing.T) {
	// The acceptance criterion, end to end.
	f := newFixture(t)
	sound := bson.NewObjectID().Hex()
	usher := bson.NewObjectID().Hex()
	cover := bson.NewObjectID().Hex()

	f.assign(t, "Sound", sound)
	f.assign(t, "Usher", usher)

	// Drafts tell nobody. A team leader building next month must not spray
	// notifications while thinking.
	if f.notifier.count() != 0 {
		t.Fatalf("a draft rota sent %d messages", f.notifier.count())
	}

	// 1. It publishes.
	published, err := f.svc.Publish(f.ctx, f.event.ID.Hex(), f.sunday)
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	if published != 2 {
		t.Fatalf("published %d, want 2", published)
	}
	if len(f.notifier.to(sound)) != 1 {
		t.Fatalf("the sound volunteer got %d messages", len(f.notifier.to(sound)))
	}

	// Publishing again must not re-notify anybody.
	before := f.notifier.count()
	if again, err := f.svc.Publish(f.ctx, f.event.ID.Hex(), f.sunday); err != nil {
		t.Fatalf("re-publish: %v", err)
	} else if again != 0 {
		t.Fatalf("re-publish published %d, want 0", again)
	}
	if f.notifier.count() != before {
		t.Fatal("re-publishing messaged somebody again")
	}

	// 2. A volunteer declines.
	assignments, err := f.svc.Mine(f.ctx, usher, time.Time{})
	if err != nil || len(assignments) != 1 {
		t.Fatalf("mine: %v (%d)", err, len(assignments))
	}
	declined, err := f.svc.Respond(f.ctx, assignments[0].ID.Hex(), usher, false, "Away that weekend")
	if err != nil {
		t.Fatalf("decline: %v", err)
	}
	if declined.Status != StatusDeclined {
		t.Fatalf("status = %q, want declined", declined.Status)
	}
	// The team leader is told, because they are the one who has to fix it.
	leaderMsgs := f.notifier.to(f.leader)
	if len(leaderMsgs) != 1 {
		t.Fatalf("the leader got %d messages about a decline", len(leaderMsgs))
	}
	if !contains(leaderMsgs[0].Body, "Away that weekend") {
		t.Errorf("the decline reason was not passed on: %q", leaderMsgs[0].Body)
	}

	// A declined slot is NOT covered.
	view, err := f.svc.ForService(f.ctx, f.event.ID.Hex(), f.sunday)
	if err != nil {
		t.Fatalf("read rota: %v", err)
	}
	for _, slot := range view.Slots {
		if slot.Role == "Usher" && !slot.NeedsCover {
			t.Fatal("a slot whose only volunteer declined is shown as covered")
		}
	}

	// 3. A swap is accepted.
	mine, _ := f.svc.Mine(f.ctx, sound, time.Time{})
	if _, err := f.svc.Respond(f.ctx, mine[0].ID.Hex(), sound, true, ""); err != nil {
		t.Fatalf("accept: %v", err)
	}
	swapping, err := f.svc.RequestSwap(f.ctx, mine[0].ID.Hex(), sound, "Family visiting")
	if err != nil {
		t.Fatalf("request swap: %v", err)
	}
	if swapping.Status != StatusSwapRequested {
		t.Fatalf("status = %q, want swap_requested", swapping.Status)
	}
	// Still committed until somebody takes it.
	view, _ = f.svc.ForService(f.ctx, f.event.ID.Hex(), f.sunday)
	for _, slot := range view.Slots {
		if slot.Role == "Sound" && slot.NeedsCover {
			t.Fatal("a slot went uncovered the moment somebody ASKED to swap")
		}
	}

	taken, err := f.svc.AcceptSwap(f.ctx, swapping.ID.Hex(), cover)
	if err != nil {
		t.Fatalf("accept swap: %v", err)
	}
	if taken.MemberID != cover || taken.Status != StatusAccepted {
		t.Fatalf("the slot went to %q as %q", taken.MemberID, taken.Status)
	}
	if taken.SwappedFrom != sound {
		t.Errorf("history lost who it came from: %q", taken.SwappedFrom)
	}
}

func TestTwoVolunteersCannotBothTakeTheSameSlot(t *testing.T) {
	// The normal case in a church coordinating over WhatsApp, not the edge one.
	f := newFixture(t)
	original := bson.NewObjectID().Hex()
	a := f.assign(t, "Sound", original)
	if _, err := f.svc.Publish(f.ctx, f.event.ID.Hex(), f.sunday); err != nil {
		t.Fatalf("publish: %v", err)
	}
	if _, err := f.svc.Respond(f.ctx, a.ID.Hex(), original, true, ""); err != nil {
		t.Fatalf("accept: %v", err)
	}
	if _, err := f.svc.RequestSwap(f.ctx, a.ID.Hex(), original, ""); err != nil {
		t.Fatalf("swap: %v", err)
	}

	const racers = 6
	var wg sync.WaitGroup
	won := make([]bool, racers)
	errs := make([]error, racers)
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := f.svc.AcceptSwap(f.ctx, a.ID.Hex(), bson.NewObjectID().Hex())
			errs[i] = err
			won[i] = err == nil
		}(i)
	}
	wg.Wait()

	winners := 0
	for i := range won {
		if won[i] {
			winners++
		} else if !errors.Is(errs[i], ErrNotOpen) {
			t.Errorf("racer %d lost for the wrong reason: %v", i, errs[i])
		}
	}
	if winners != 1 {
		t.Fatalf("%d volunteers took the same slot — the database did not settle it", winners)
	}

	// And exactly one person is on it.
	view, err := f.svc.ForService(f.ctx, f.event.ID.Hex(), f.sunday)
	if err != nil {
		t.Fatalf("read rota: %v", err)
	}
	for _, slot := range view.Slots {
		if slot.Role == "Sound" && slot.Filled != 1 {
			t.Fatalf("the sound slot has %d people committed, want 1", slot.Filled)
		}
	}
}

func TestAVolunteerIsNotDoubleBooked(t *testing.T) {
	f := newFixture(t)
	person := bson.NewObjectID().Hex()
	f.assign(t, "Sound", person)

	_, err := f.svc.Assign(f.ctx, AssignInput{
		EventID: f.event.ID.Hex(), OccurrenceAt: f.sunday,
		Role: "Usher", MemberID: person,
	})
	if !errors.Is(err, ErrDoubleBooked) {
		t.Fatalf("scheduling the same person twice at 9am returned %v", err)
	}

	// A DIFFERENT Sunday is fine — that is the whole point of keying on the
	// occurrence rather than the event.
	if _, err := f.svc.Assign(f.ctx, AssignInput{
		EventID: f.event.ID.Hex(), OccurrenceAt: f.sunday.AddDate(0, 0, 7),
		Role: "Usher", MemberID: person,
	}); err != nil {
		t.Fatalf("the next Sunday was refused: %v", err)
	}
}

func TestAWeeklyServiceCanBeRosteredEveryWeek(t *testing.T) {
	// The bug the occurrence key exists to prevent, the same one WP-21 hit: a
	// recurring service is ONE event, so a rota keyed on the event alone would
	// let somebody serve "Sunday service" exactly once, ever.
	f := newFixture(t)
	person := bson.NewObjectID().Hex()

	for week := 0; week < 4; week++ {
		if _, err := f.svc.Assign(f.ctx, AssignInput{
			EventID:      f.event.ID.Hex(),
			OccurrenceAt: f.sunday.AddDate(0, 0, 7*week),
			Role:         "Sound", MemberID: person,
		}); err != nil {
			t.Fatalf("week %d refused: %v", week, err)
		}
	}

	mine, err := f.svc.Mine(f.ctx, person, time.Time{})
	if err != nil {
		t.Fatalf("mine: %v", err)
	}
	// Drafts are excluded from a volunteer's own view — they are not a
	// commitment until somebody decided.
	if len(mine) != 0 {
		t.Fatalf("a volunteer sees %d unpublished assignments", len(mine))
	}
	for week := 0; week < 4; week++ {
		if _, err := f.svc.Publish(f.ctx, f.event.ID.Hex(),
			f.sunday.AddDate(0, 0, 7*week)); err != nil {
			t.Fatalf("publish week %d: %v", week, err)
		}
	}
	mine, _ = f.svc.Mine(f.ctx, person, time.Time{})
	if len(mine) != 4 {
		t.Fatalf("after publishing, the volunteer sees %d of 4 Sundays", len(mine))
	}
}

func TestStatedUnavailabilityIsRespectedUnlessOverriddenExplicitly(t *testing.T) {
	f := newFixture(t)
	person := bson.NewObjectID().Hex()

	if _, err := f.svc.BlockDates(f.ctx, person,
		f.sunday.AddDate(0, 0, -2), f.sunday.AddDate(0, 0, 2), "On holiday"); err != nil {
		t.Fatalf("block: %v", err)
	}

	_, err := f.svc.Assign(f.ctx, AssignInput{
		EventID: f.event.ID.Hex(), OccurrenceAt: f.sunday,
		Role: "Sound", MemberID: person,
	})
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("scheduling somebody who blocked the date returned %v", err)
	}

	// A team leader who has spoken to them can override — but has to say so.
	// A scheduler that silently ignored the block is one volunteers stop
	// bothering to update.
	if _, err := f.svc.Assign(f.ctx, AssignInput{
		EventID: f.event.ID.Hex(), OccurrenceAt: f.sunday,
		Role: "Sound", MemberID: person, Force: true,
	}); err != nil {
		t.Fatalf("an explicit override was refused: %v", err)
	}
}

func TestAnAssignmentMustFallOnARealOccurrence(t *testing.T) {
	// A mistyped date, or one copied from a different service, builds a rota
	// nobody will ever see. The first anyone knows is the Sunday nobody turns
	// up.
	f := newFixture(t)
	_, err := f.svc.Assign(f.ctx, AssignInput{
		EventID: f.event.ID.Hex(),
		// A Wednesday evening, for a service that runs on this weekday.
		OccurrenceAt: f.sunday.AddDate(0, 0, 3),
		Role:         "Sound", MemberID: bson.NewObjectID().Hex(),
	})
	if !errors.Is(err, ErrNotAnOccurrence) {
		t.Fatalf("a date the service does not run on was accepted: %v", err)
	}

	// And the real dates still work, a year out.
	if _, err := f.svc.Assign(f.ctx, AssignInput{
		EventID: f.event.ID.Hex(), OccurrenceAt: f.sunday.AddDate(0, 0, 7*30),
		Role: "Sound", MemberID: bson.NewObjectID().Hex(),
	}); err != nil {
		t.Fatalf("a real occurrence thirty weeks out was refused: %v", err)
	}
}

func TestOnlyTheVolunteerMayAnswerTheirOwnAssignment(t *testing.T) {
	f := newFixture(t)
	person := bson.NewObjectID().Hex()
	a := f.assign(t, "Sound", person)
	if _, err := f.svc.Publish(f.ctx, f.event.ID.Hex(), f.sunday); err != nil {
		t.Fatalf("publish: %v", err)
	}

	if _, err := f.svc.Respond(f.ctx, a.ID.Hex(), bson.NewObjectID().Hex(), false, ""); !errors.Is(err, ErrNotYours) {
		t.Fatalf("somebody else declined on their behalf: %v", err)
	}
	if _, err := f.svc.RequestSwap(f.ctx, a.ID.Hex(), bson.NewObjectID().Hex(), ""); !errors.Is(err, ErrNotYours) {
		t.Fatalf("somebody else requested a swap for them: %v", err)
	}
}

func TestRemindersFireOnceAndOnlyForCommitments(t *testing.T) {
	f := newFixture(t)
	// A service inside the reminder window. The whole SERIES moves, not just
	// the date, because an assignment must fall on a real occurrence.
	f.sunday = time.Now().UTC().Add(48 * time.Hour).Truncate(time.Hour)
	f.event.StartDate = f.sunday

	serving := bson.NewObjectID().Hex()
	declining := bson.NewObjectID().Hex()
	f.assign(t, "Sound", serving)
	declined := f.assign(t, "Usher", declining)
	if _, err := f.svc.Publish(f.ctx, f.event.ID.Hex(), f.sunday); err != nil {
		t.Fatalf("publish: %v", err)
	}
	if _, err := f.svc.Respond(f.ctx, declined.ID.Hex(), declining, false, ""); err != nil {
		t.Fatalf("decline: %v", err)
	}

	sent, err := f.svc.SendReminders(f.ctx)
	if err != nil {
		t.Fatalf("reminders: %v", err)
	}
	if sent != 1 {
		t.Fatalf("sent %d reminders, want 1 — the person who declined must not "+
			"be reminded about a slot they are not on", sent)
	}

	// A sweeper runs on a timer. Running it again must send nothing.
	again, err := f.svc.SendReminders(f.ctx)
	if err != nil {
		t.Fatalf("second sweep: %v", err)
	}
	if again != 0 {
		t.Fatalf("a second sweep sent %d reminders", again)
	}

	// And the reminder is TRANSACTIONAL, so a volunteer who opted out of
	// marketing still learns they are on the sound desk.
	reminders := f.notifier.to(serving)
	found := false
	for _, m := range reminders {
		if contains(m.Body, "Reminder") {
			found = true
			if m.Kind != notification.KindTransactional {
				t.Errorf("a rota reminder was sent as %q, which consent can "+
					"suppress — a volunteer who declined a newsletter would "+
					"silently stop being told they are serving", m.Kind)
			}
		}
	}
	if !found {
		t.Fatal("no reminder reached the volunteer")
	}
}

func TestConcurrentSweepersDoNotDoubleRemind(t *testing.T) {
	f := newFixture(t)
	f.sunday = time.Now().UTC().Add(48 * time.Hour).Truncate(time.Hour)
	f.event.StartDate = f.sunday
	for i := 0; i < 8; i++ {
		f.assign(t, "Team", bson.NewObjectID().Hex())
	}
	if _, err := f.svc.Publish(f.ctx, f.event.ID.Hex(), f.sunday); err != nil {
		t.Fatalf("publish: %v", err)
	}

	var wg sync.WaitGroup
	totals := make([]int, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			n, err := f.svc.SendReminders(f.ctx)
			if err != nil {
				t.Errorf("sweeper %d: %v", i, err)
			}
			totals[i] = n
		}(i)
	}
	wg.Wait()

	total := 0
	for _, n := range totals {
		total += n
	}
	if total != 8 {
		t.Fatalf("four sweepers sent %d reminders between them, want 8", total)
	}
}

func contains(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
