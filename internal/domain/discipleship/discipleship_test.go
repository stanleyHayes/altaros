package discipleship

import (
	"context"
	"testing"
	"time"

	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

const (
	churchA = "6a6d0a46536bf5e6e21cd001"
	churchB = "6a6d0a46536bf5e6e21cd002"

	visitor    = "6a6f3460a6b0e0738cd10001"
	usher      = "6a6f3460a6b0e0738cd10002"
	pastor     = "6a6f3460a6b0e0738cd10003"
	otherUsher = "6a6f3460a6b0e0738cd10004"
)

type harness struct {
	svc   *Service
	ctx   context.Context
	other context.Context
	// clock is what the service reads, so a 48-hour SLA can be tested without
	// a test that takes 48 hours.
	clock time.Time
}

func newHarness(t *testing.T) *harness {
	t.Helper()

	connectCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	db, err := mongodb.Connect(connectCtx, config.MongoConfig{
		URI:            testsupport.MongoURI(),
		Database:       "altar_test_discipleship",
		ConnectTimeout: 3 * time.Second,
	})
	if err != nil {
		testsupport.SkipOrFail(t, "MongoDB", err)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = db.Database().Drop(c)
		_ = db.Close(c)
	})

	h := &harness{
		svc:   NewService(db),
		clock: time.Date(2026, 8, 2, 11, 0, 0, 0, time.UTC), // a Sunday
	}
	h.svc.now = func() time.Time { return h.clock }
	h.ctx = tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: churchA, UserID: usher, Role: "DEPARTMENT_LEADER",
	})
	h.other = tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: churchB, UserID: usher, Role: "DEPARTMENT_LEADER",
	})
	if err := h.svc.EnsureIndexes(h.ctx); err != nil {
		t.Fatalf("EnsureIndexes: %v", err)
	}
	return h
}

// fixedEscalator sends everything to one person, which is what a small church
// actually does.
type fixedEscalator struct{ to string }

func (f fixedEscalator) SupervisorFor(context.Context, string) (string, error) {
	return f.to, nil
}

// WP-34 acceptance: "a first-timer recorded on Sunday generates an assigned
// follow-up task with an SLA and escalates if untouched."
func TestAFirstTimerGeneratesAnAssignedTaskThatEscalates(t *testing.T) {
	h := newHarness(t)

	// --- recorded on Sunday ---
	out, err := h.svc.Record(h.ctx, RecordInput{
		MemberID: visitor, Stage: StageFirstTimer,
		Source: "Sunday service", AssigneeID: usher, ActorID: usher,
	})
	if err != nil {
		t.Fatalf("Record: %v", err)
	}

	// --- generates an assigned follow-up task ---
	if out.Task == nil {
		t.Fatal("recording a first-timer generated no follow-up task")
	}
	if out.Task.AssigneeID.String() != usher {
		t.Errorf("task assigned to %q, want the usher", out.Task.AssigneeID)
	}
	if out.Task.Status != TaskOpen {
		t.Errorf("a new task is %s", out.Task.Status)
	}

	// --- with an SLA ---
	wantDue := h.clock.Add(48 * time.Hour)
	if !out.Task.DueAt.Equal(wantDue) {
		t.Errorf("due %s, want %s (48 hours)", out.Task.DueAt, wantDue)
	}
	if out.Journey.Stage != StageFirstTimer {
		t.Errorf("journey stage is %s", out.Journey.Stage)
	}

	// --- and escalates if untouched ---
	// Still inside the SLA: nothing escalates.
	h.clock = h.clock.Add(47 * time.Hour)
	res, err := h.svc.EscalateOverdue(h.ctx, fixedEscalator{to: pastor})
	if err != nil {
		t.Fatalf("EscalateOverdue: %v", err)
	}
	if res.Escalated != 0 {
		t.Fatalf("escalated %d tasks before the deadline", res.Escalated)
	}

	// Past the deadline, untouched.
	h.clock = h.clock.Add(2 * time.Hour)
	res, err = h.svc.EscalateOverdue(h.ctx, fixedEscalator{to: pastor})
	if err != nil {
		t.Fatalf("EscalateOverdue: %v", err)
	}
	if res.Escalated != 1 || res.Reassigned != 1 {
		t.Fatalf("escalated %d, reassigned %d — want 1 and 1",
			res.Escalated, res.Reassigned)
	}

	tasks, err := h.svc.Tasks(h.ctx, TaskFilter{OpenOnly: true})
	if err != nil {
		t.Fatalf("Tasks: %v", err)
	}
	if len(tasks) != 1 {
		t.Fatalf("got %d open tasks", len(tasks))
	}
	got := tasks[0]
	if got.Status != TaskEscalated {
		t.Errorf("status is %s after escalation", got.Status)
	}
	if got.AssigneeID.String() != pastor {
		t.Errorf("escalated task is assigned to %q, want the pastor", got.AssigneeID)
	}
	if got.EscalatedTo.String() != pastor || got.EscalatedAt == nil {
		t.Error("the escalation was not recorded on the task")
	}
}

// A task somebody has picked up must not escalate. "Untouched" is a weaker
// test than "unfinished" on purpose: a volunteer who rang and got no answer has
// done their part, and escalating over their head teaches them to ignore it.
func TestATouchedTaskDoesNotEscalate(t *testing.T) {
	h := newHarness(t)
	out, err := h.svc.Record(h.ctx, RecordInput{
		MemberID: visitor, AssigneeID: usher, ActorID: usher,
	})
	if err != nil {
		t.Fatalf("Record: %v", err)
	}

	h.clock = h.clock.Add(2 * time.Hour)
	if _, err := h.svc.Touch(h.ctx, out.Task.ID.Hex(), usher); err != nil {
		t.Fatalf("Touch: %v", err)
	}

	h.clock = h.clock.Add(72 * time.Hour) // well past the SLA
	res, err := h.svc.EscalateOverdue(h.ctx, fixedEscalator{to: pastor})
	if err != nil {
		t.Fatalf("EscalateOverdue: %v", err)
	}
	if res.Escalated != 0 {
		t.Fatalf("a task somebody had picked up escalated over their head")
	}
}

// Escalated once, not once per sweep. A fresh alert every five minutes until
// somebody mutes it is worse than no alert.
func TestATaskEscalatesOnlyOnce(t *testing.T) {
	h := newHarness(t)
	if _, err := h.svc.Record(h.ctx, RecordInput{
		MemberID: visitor, AssigneeID: usher, ActorID: usher,
	}); err != nil {
		t.Fatalf("Record: %v", err)
	}
	h.clock = h.clock.Add(72 * time.Hour)

	first, err := h.svc.EscalateOverdue(h.ctx, fixedEscalator{to: pastor})
	if err != nil {
		t.Fatalf("first sweep: %v", err)
	}
	if first.Escalated != 1 {
		t.Fatalf("first sweep escalated %d", first.Escalated)
	}

	for i := 0; i < 3; i++ {
		again, err := h.svc.EscalateOverdue(h.ctx, fixedEscalator{to: pastor})
		if err != nil {
			t.Fatalf("sweep %d: %v", i, err)
		}
		if again.Escalated != 0 {
			t.Fatalf("sweep %d escalated an already-escalated task", i)
		}
	}
}

// A closed task never escalates, whatever its deadline said.
func TestAClosedTaskDoesNotEscalate(t *testing.T) {
	h := newHarness(t)
	out, err := h.svc.Record(h.ctx, RecordInput{
		MemberID: visitor, AssigneeID: usher, ActorID: usher,
	})
	if err != nil {
		t.Fatalf("Record: %v", err)
	}
	if _, err := h.svc.Close(h.ctx, CloseInput{
		TaskID: out.Task.ID.Hex(), Status: TaskDone,
		Outcome: "Called; coming back next Sunday.", ActorID: usher,
	}); err != nil {
		t.Fatalf("Close: %v", err)
	}

	h.clock = h.clock.Add(96 * time.Hour)
	res, err := h.svc.EscalateOverdue(h.ctx, fixedEscalator{to: pastor})
	if err != nil {
		t.Fatalf("EscalateOverdue: %v", err)
	}
	if res.Escalated != 0 {
		t.Fatal("a completed follow-up escalated")
	}
}

// Closing without saying what happened is a tick to clear a list. It tells the
// next person nothing about whether the visitor was actually reached.
func TestClosingRequiresAnOutcome(t *testing.T) {
	h := newHarness(t)
	out, err := h.svc.Record(h.ctx, RecordInput{
		MemberID: visitor, AssigneeID: usher, ActorID: usher,
	})
	if err != nil {
		t.Fatalf("Record: %v", err)
	}
	if _, err := h.svc.Close(h.ctx, CloseInput{
		TaskID: out.Task.ID.Hex(), Status: TaskDone, Outcome: "  ",
	}); err == nil {
		t.Fatal("a task was closed with no outcome")
	}
}

// "Unreachable" is a real outcome. Without it a church either marks a wrong
// number done — a lie — or leaves it open forever, burying the real work.
func TestUnreachableIsAClosingOutcome(t *testing.T) {
	h := newHarness(t)
	out, err := h.svc.Record(h.ctx, RecordInput{
		MemberID: visitor, AssigneeID: usher, ActorID: usher,
	})
	if err != nil {
		t.Fatalf("Record: %v", err)
	}
	closed, err := h.svc.Close(h.ctx, CloseInput{
		TaskID: out.Task.ID.Hex(), Status: TaskUnreachable,
		Outcome: "Number does not connect.",
	})
	if err != nil {
		t.Fatalf("Close: %v", err)
	}
	if closed.Status.Open() {
		t.Error("an unreachable task is still open")
	}

	open, err := h.svc.Tasks(h.ctx, TaskFilter{OpenOnly: true})
	if err != nil {
		t.Fatalf("Tasks: %v", err)
	}
	if len(open) != 0 {
		t.Errorf("%d tasks still open", len(open))
	}
}

// A second visitor card for the same person is common. It must not make
// somebody look newly arrived or reset the clock they are measured against.
func TestRecordingTheSameStageTwiceDoesNotResetTheClock(t *testing.T) {
	h := newHarness(t)
	first, err := h.svc.Record(h.ctx, RecordInput{
		MemberID: visitor, Stage: StageFirstTimer, AssigneeID: usher, ActorID: usher,
	})
	if err != nil {
		t.Fatalf("Record: %v", err)
	}

	h.clock = h.clock.Add(24 * time.Hour)
	second, err := h.svc.Record(h.ctx, RecordInput{
		MemberID: visitor, Stage: StageFirstTimer, AssigneeID: usher, ActorID: usher,
	})
	if err != nil {
		t.Fatalf("Record again: %v", err)
	}
	if !second.Journey.EnteredStageAt.Equal(first.Journey.EnteredStageAt) {
		t.Errorf("the stage clock reset to %s", second.Journey.EnteredStageAt)
	}
	if len(second.Journey.History) != 1 {
		t.Errorf("history has %d entries after a duplicate record", len(second.Journey.History))
	}
}

// Movement is what a church actually asks about, so history has to record it.
func TestTheJourneyRecordsEveryMove(t *testing.T) {
	h := newHarness(t)
	for _, stage := range []Stage{StageFirstTimer, StageNewConvert, StageBaptised, StageMember} {
		if _, err := h.svc.Record(h.ctx, RecordInput{
			MemberID: visitor, Stage: stage, AssigneeID: usher, ActorID: usher,
		}); err != nil {
			t.Fatalf("Record %s: %v", stage, err)
		}
		h.clock = h.clock.Add(30 * 24 * time.Hour)
	}

	journey, err := h.svc.JourneyFor(h.ctx, visitor)
	if err != nil {
		t.Fatalf("JourneyFor: %v", err)
	}
	if journey.Stage != StageMember {
		t.Errorf("stage is %s, want member", journey.Stage)
	}
	if len(journey.History) != 4 {
		t.Fatalf("history has %d entries, want 4", len(journey.History))
	}
	if journey.History[1].From != StageFirstTimer || journey.History[1].To != StageNewConvert {
		t.Errorf("second transition is %s -> %s",
			journey.History[1].From, journey.History[1].To)
	}
}

// A member or a leader has no follow-up SLA. Generating a task for every stage
// would bury the ones that matter.
func TestStagesWithoutAnSLAGenerateNoTask(t *testing.T) {
	h := newHarness(t)
	for _, stage := range []Stage{StageMember, StageLeader} {
		out, err := h.svc.Record(h.ctx, RecordInput{
			MemberID: visitor, Stage: stage, AssigneeID: usher, ActorID: usher,
		})
		if err != nil {
			t.Fatalf("Record %s: %v", stage, err)
		}
		if out.Task != nil {
			t.Errorf("stage %s generated a follow-up task", stage)
		}
	}
}

// Going dormant DOES generate follow-up — it is the one backwards move a
// church most needs to act on.
func TestGoingDormantGeneratesAVisit(t *testing.T) {
	h := newHarness(t)
	if _, err := h.svc.Record(h.ctx, RecordInput{
		MemberID: visitor, Stage: StageMember, ActorID: usher,
	}); err != nil {
		t.Fatalf("Record: %v", err)
	}
	out, err := h.svc.Record(h.ctx, RecordInput{
		MemberID: visitor, Stage: StageDormant, AssigneeID: usher, ActorID: usher,
	})
	if err != nil {
		t.Fatalf("Record dormant: %v", err)
	}
	if out.Task == nil {
		t.Fatal("somebody going dormant generated no follow-up")
	}
	if out.Task.Kind != KindVisit {
		t.Errorf("dormant follow-up is %s, want a visit", out.Task.Kind)
	}
}

// A task with no owner is a task nobody does. When no assignee is named, it
// falls to whoever recorded it — the person holding the visitor card.
func TestATaskWithoutAnAssigneeFallsToWhoeverRecordedIt(t *testing.T) {
	h := newHarness(t)
	out, err := h.svc.Record(h.ctx, RecordInput{
		MemberID: visitor, Stage: StageFirstTimer, ActorID: usher,
	})
	if err != nil {
		t.Fatalf("Record: %v", err)
	}
	if out.Task.AssigneeID.String() != usher {
		t.Errorf("task fell to %q, want the person who recorded it", out.Task.AssigneeID)
	}

	// And with nobody at all, it is refused rather than orphaned.
	if _, err := h.svc.Record(h.ctx, RecordInput{
		MemberID: "6a6f3460a6b0e0738cd10099", Stage: StageFirstTimer,
	}); err == nil {
		t.Error("a follow-up was created with nobody responsible")
	}
}

// A volunteer's list is theirs, soonest first.
func TestAVolunteerSeesTheirOwnListSoonestFirst(t *testing.T) {
	h := newHarness(t)
	// The usher's, due in 48h.
	if _, err := h.svc.Record(h.ctx, RecordInput{
		MemberID: visitor, Stage: StageFirstTimer, AssigneeID: usher, ActorID: usher,
	}); err != nil {
		t.Fatalf("Record: %v", err)
	}
	// Somebody else's, due in 168h.
	if _, err := h.svc.Record(h.ctx, RecordInput{
		MemberID: "6a6f3460a6b0e0738cd10011", Stage: StageBaptised,
		AssigneeID: otherUsher, ActorID: usher,
	}); err != nil {
		t.Fatalf("Record: %v", err)
	}

	mine, err := h.svc.Tasks(h.ctx, TaskFilter{AssigneeID: usher, OpenOnly: true})
	if err != nil {
		t.Fatalf("Tasks: %v", err)
	}
	if len(mine) != 1 {
		t.Fatalf("the usher sees %d tasks, want only their own", len(mine))
	}
	if mine[0].AssigneeID.String() != usher {
		t.Errorf("list contains %q's task", mine[0].AssigneeID)
	}
}

// Tenant scoping, on both collections.
func TestNothingCrossesChurches(t *testing.T) {
	h := newHarness(t)
	out, err := h.svc.Record(h.ctx, RecordInput{
		MemberID: visitor, Stage: StageFirstTimer, AssigneeID: usher, ActorID: usher,
	})
	if err != nil {
		t.Fatalf("Record: %v", err)
	}

	if _, err := h.svc.JourneyFor(h.other, visitor); err == nil {
		t.Error("church B read church A's journey")
	}
	tasks, err := h.svc.Tasks(h.other, TaskFilter{OpenOnly: true})
	if err != nil {
		t.Fatalf("Tasks: %v", err)
	}
	if len(tasks) != 0 {
		t.Errorf("church B sees %d of church A's tasks", len(tasks))
	}
	if _, err := h.svc.Touch(h.other, out.Task.ID.Hex(), usher); err == nil {
		t.Error("church B touched church A's task")
	}

	// And the escalation sweep stays inside one church.
	h.clock = h.clock.Add(72 * time.Hour)
	res, err := h.svc.EscalateOverdue(h.other, fixedEscalator{to: pastor})
	if err != nil {
		t.Fatalf("EscalateOverdue: %v", err)
	}
	if res.Escalated != 0 {
		t.Fatalf("church B escalated %d of church A's tasks", res.Escalated)
	}
}

// The sweeper runs on a timer with no church behind it, so it has to be able
// to ask which churches have work — and see both ADR-005 storage forms.
func TestChurchesWithOverdueTasksFindsTheWork(t *testing.T) {
	h := newHarness(t)
	if _, err := h.svc.Record(h.ctx, RecordInput{
		MemberID: visitor, Stage: StageFirstTimer, AssigneeID: usher, ActorID: usher,
	}); err != nil {
		t.Fatalf("Record: %v", err)
	}

	// Nothing overdue yet.
	churches, err := h.svc.ChurchesWithOverdueTasks(context.Background())
	if err != nil {
		t.Fatalf("ChurchesWithOverdueTasks: %v", err)
	}
	if len(churches) != 0 {
		t.Fatalf("found %d churches with work before any deadline passed", len(churches))
	}

	h.clock = h.clock.Add(72 * time.Hour)
	churches, err = h.svc.ChurchesWithOverdueTasks(context.Background())
	if err != nil {
		t.Fatalf("ChurchesWithOverdueTasks: %v", err)
	}
	if len(churches) != 1 || churches[0] != churchA {
		t.Fatalf("found %v, want just church A", churches)
	}
}

// With no escalator the task still escalates; it simply does not change hands.
// A small church has nobody to escalate TO, and the status change is what
// surfaces it.
func TestEscalationWithoutASupervisorStillEscalates(t *testing.T) {
	h := newHarness(t)
	if _, err := h.svc.Record(h.ctx, RecordInput{
		MemberID: visitor, Stage: StageFirstTimer, AssigneeID: usher, ActorID: usher,
	}); err != nil {
		t.Fatalf("Record: %v", err)
	}
	h.clock = h.clock.Add(72 * time.Hour)

	res, err := h.svc.EscalateOverdue(h.ctx, nil)
	if err != nil {
		t.Fatalf("EscalateOverdue: %v", err)
	}
	if res.Escalated != 1 {
		t.Fatalf("escalated %d with no escalator", res.Escalated)
	}
	if res.Reassigned != 0 {
		t.Errorf("reassigned %d with nobody to reassign to", res.Reassigned)
	}

	tasks, err := h.svc.Tasks(h.ctx, TaskFilter{OpenOnly: true})
	if err != nil {
		t.Fatalf("Tasks: %v", err)
	}
	if tasks[0].Status != TaskEscalated {
		t.Errorf("status is %s", tasks[0].Status)
	}
	if tasks[0].AssigneeID.String() != usher {
		t.Errorf("the task changed hands to %q with no supervisor", tasks[0].AssigneeID)
	}
}

// A sweep is bounded, so what it LOOKS at matters as much as what it escalates.
//
// An escalated task keeps a past deadline and is still untouched, so without a
// status filter every sweep rescans every task ever escalated. A church with
// three hundred of them would spend its whole per-sweep budget on work it has
// already actioned and never reach the visitor recorded this morning. Silent
// starvation: nothing errors, the sweeper just stops getting to new people.
func TestAlreadyEscalatedTasksDoNotConsumeTheSweepBudget(t *testing.T) {
	h := newHarness(t)

	for i, id := range []string{
		"6a6f3460a6b0e0738cd10021", "6a6f3460a6b0e0738cd10022",
		"6a6f3460a6b0e0738cd10023",
	} {
		if _, err := h.svc.Record(h.ctx, RecordInput{
			MemberID: id, Stage: StageFirstTimer, AssigneeID: usher, ActorID: usher,
		}); err != nil {
			t.Fatalf("Record %d: %v", i, err)
		}
	}
	h.clock = h.clock.Add(72 * time.Hour)

	first, err := h.svc.EscalateOverdue(h.ctx, fixedEscalator{to: pastor})
	if err != nil {
		t.Fatalf("first sweep: %v", err)
	}
	if first.Examined != 3 || first.Escalated != 3 {
		t.Fatalf("first sweep examined %d and escalated %d, want 3 and 3",
			first.Examined, first.Escalated)
	}

	// Nothing new has happened, and every task is still untouched with a
	// deadline in the past. The next sweep must find nothing to look at.
	second, err := h.svc.EscalateOverdue(h.ctx, fixedEscalator{to: pastor})
	if err != nil {
		t.Fatalf("second sweep: %v", err)
	}
	if second.Examined != 0 {
		t.Fatalf("the second sweep examined %d already-escalated tasks — "+
			"they will crowd out new work as they accumulate", second.Examined)
	}
}
