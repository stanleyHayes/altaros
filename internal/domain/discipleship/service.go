package discipleship

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// Service is the discipleship pipeline.
type Service struct {
	journeys *mongodb.TenantCollection
	tasks    *mongodb.TenantCollection
	// global is the tasks collection without a tenant filter, used by exactly
	// one caller: ChurchesWithOverdueTasks, which the escalation sweeper needs
	// because a timer has no request and therefore no church behind it.
	global *mongo.Collection

	now func() time.Time
}

// NewService builds the service.
func NewService(db *mongodb.DB) *Service {
	return &Service{
		journeys: db.Tenant(JourneyCollection),
		tasks:    db.Tenant(TaskCollection),
		global:   db.Global(TaskCollection),
		now:      func() time.Time { return time.Now().UTC() },
	}
}

// EnsureIndexes creates the indexes the pipeline needs.
func (s *Service) EnsureIndexes(ctx context.Context) error {
	if err := s.journeys.EnsureIndexes(ctx, []mongo.IndexModel{
		{
			// One journey per member. A second would give a church two
			// contradictory answers about where somebody is.
			Keys: bson.D{
				{Key: "churchId", Value: 1},
				{Key: "memberId", Value: 1},
			},
			Options: options.Index().SetName("church_member_journey").SetUnique(true),
		},
		{
			// "Who is at this stage, and who has been there longest."
			Keys: bson.D{
				{Key: "churchId", Value: 1},
				{Key: "stage", Value: 1},
				{Key: "enteredStageAt", Value: 1},
			},
			Options: options.Index().SetName("church_stage"),
		},
	}); err != nil {
		return fmt.Errorf("discipleship: journey indexes: %w", err)
	}

	if err := s.tasks.EnsureIndexes(ctx, []mongo.IndexModel{
		{
			// A volunteer's own list, soonest first.
			Keys: bson.D{
				{Key: "churchId", Value: 1},
				{Key: "assigneeId", Value: 1},
				{Key: "status", Value: 1},
				{Key: "dueAt", Value: 1},
			},
			Options: options.Index().SetName("church_assignee_due"),
		},
		{
			// THE escalation query: open, untouched, past due. Partial so the
			// index holds only work that can still escalate rather than every
			// task the church has ever completed.
			Keys: bson.D{
				{Key: "churchId", Value: 1},
				{Key: "dueAt", Value: 1},
			},
			Options: options.Index().SetName("church_escalation").
				SetPartialFilterExpression(bson.M{"status": string(TaskOpen)}),
		},
	}); err != nil {
		return fmt.Errorf("discipleship: task indexes: %w", err)
	}
	return nil
}

// RecordInput places somebody on the journey.
type RecordInput struct {
	MemberID string
	Stage    Stage
	Source   string
	Note     string
	// AssigneeID is who should follow up. When empty, a task is still created
	// and assigned to DefaultAssignee — see Record.
	AssigneeID string
	// ActorID is who recorded it.
	ActorID string
	// At overrides the clock, for recording last Sunday on Tuesday.
	At time.Time
}

// Outcome is a journey plus whatever follow-up it generated.
type Outcome struct {
	Journey *Record `json:"journey"`
	// Task is the follow-up this stage requires, or nil when the stage has no
	// SLA — a member or a leader is not somebody to chase.
	Task *Task `json:"task,omitempty"`
}

// Record places a member at a stage and creates the follow-up it requires.
//
// The two halves are ONE operation on purpose. WP-34's criterion is that
// recording a first-timer generates a task; a design where the task is a
// separate call somebody has to remember is the drawer the visitor card goes
// into.
func (s *Service) Record(ctx context.Context, in RecordInput) (*Outcome, error) {
	if strings.TrimSpace(in.MemberID) == "" {
		return nil, ErrMemberRequired
	}
	if in.Stage == "" {
		in.Stage = StageFirstTimer
	}
	if !in.Stage.Valid() {
		return nil, fmt.Errorf("%w: %q", ErrStageInvalid, in.Stage)
	}

	at := in.At
	if at.IsZero() {
		at = s.now()
	}
	at = at.UTC()

	journey, err := s.moveTo(ctx, in, at)
	if err != nil {
		return nil, err
	}

	out := &Outcome{Journey: journey}
	sla, wanted := DefaultSLAs[in.Stage]
	if !wanted {
		// A member or a leader has no follow-up SLA. That is not an omission:
		// generating a task for every stage would bury the ones that matter.
		return out, nil
	}

	assignee := strings.TrimSpace(in.AssigneeID)
	if assignee == "" {
		// Falls back to whoever recorded it. A task assigned to nobody is a
		// task nobody does, and the person holding the visitor card is a far
		// better default than an empty field.
		assignee = strings.TrimSpace(in.ActorID)
	}
	if assignee == "" {
		return nil, ErrNoOwner
	}

	task, err := s.createTask(ctx, journey, sla, assignee, at)
	if err != nil {
		return nil, err
	}
	out.Task = task
	return out, nil
}

// moveTo writes the journey, appending to its history.
func (s *Service) moveTo(ctx context.Context, in RecordInput, at time.Time) (*Record, error) {
	var existing Record
	err := s.journeys.FindOne(ctx, bson.M{"memberId": mongodb.ID(in.MemberID)}, &existing)
	switch {
	case errors.Is(err, mongo.ErrNoDocuments):
		// New to the journey.
	case err != nil:
		return nil, fmt.Errorf("discipleship: read journey: %w", err)
	case existing.Stage == in.Stage:
		// Already there. Recording it again must not append a no-op to the
		// history or reset the clock somebody is being measured against — a
		// second visitor card for the same person is common, and it should not
		// make them look newly arrived.
		return &existing, nil
	}

	transition := Transition{
		From: existing.Stage, To: in.Stage, At: at,
		By: mongodb.ID(in.ActorID), Note: strings.TrimSpace(in.Note),
	}
	set := bson.M{
		"stage":          string(in.Stage),
		"enteredStageAt": at,
		"updatedAt":      at,
	}
	if source := strings.TrimSpace(in.Source); source != "" {
		set["source"] = source
	}
	if note := strings.TrimSpace(in.Note); note != "" {
		set["note"] = note
	}

	if _, err := s.journeys.UpsertOne(ctx,
		bson.M{"memberId": mongodb.ID(in.MemberID)},
		bson.M{
			"$set":         set,
			"$push":        bson.M{"history": transition},
			"$setOnInsert": bson.M{"createdAt": at},
		}); err != nil {
		return nil, fmt.Errorf("discipleship: write journey: %w", err)
	}

	var out Record
	if err := s.journeys.FindOne(ctx,
		bson.M{"memberId": mongodb.ID(in.MemberID)}, &out); err != nil {
		return nil, fmt.Errorf("discipleship: read back journey: %w", err)
	}
	return &out, nil
}

// createTask writes the follow-up a stage requires.
func (s *Service) createTask(ctx context.Context, journey *Record, sla SLA, assignee string, at time.Time) (*Task, error) {
	doc := bson.M{
		"memberId":   journey.MemberID,
		"journeyId":  mongodb.ID(journey.ID.Hex()),
		"stage":      string(journey.Stage),
		"kind":       string(sla.Kind),
		"title":      titleFor(sla.Kind, journey.Stage),
		"assigneeId": mongodb.ID(assignee),
		"dueAt":      at.Add(sla.Duration()),
		"status":     string(TaskOpen),
		"createdAt":  at,
		"updatedAt":  at,
	}
	res, err := s.tasks.InsertOne(ctx, doc)
	if err != nil {
		return nil, fmt.Errorf("discipleship: create task: %w", err)
	}

	var out Task
	oid, _ := res.InsertedID.(bson.ObjectID)
	if err := s.tasks.FindOne(ctx, bson.M{"_id": oid}, &out); err != nil {
		return nil, fmt.Errorf("discipleship: read back task: %w", err)
	}
	return &out, nil
}

// JourneyFor reads one member's journey.
func (s *Service) JourneyFor(ctx context.Context, memberID string) (*Record, error) {
	var out Record
	err := s.journeys.FindOne(ctx, bson.M{"memberId": mongodb.ID(memberID)}, &out)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrJourneyNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("discipleship: read journey: %w", err)
	}
	return &out, nil
}

// TaskFilter narrows a task listing.
type TaskFilter struct {
	AssigneeID string
	Status     TaskStatus
	// OpenOnly returns both open and escalated.
	OpenOnly bool
	// OverdueOnly returns work that has already breached its SLA.
	OverdueOnly bool
	Limit       int
}

// Tasks lists follow-up work, soonest deadline first.
func (s *Service) Tasks(ctx context.Context, f TaskFilter) ([]Task, error) {
	filter := bson.M{}
	if id := strings.TrimSpace(f.AssigneeID); id != "" {
		filter["assigneeId"] = mongodb.ID(id)
	}
	switch {
	case f.Status != "":
		filter["status"] = string(f.Status)
	case f.OpenOnly || f.OverdueOnly:
		filter["status"] = bson.M{"$in": bson.A{string(TaskOpen), string(TaskEscalated)}}
	}
	if f.OverdueOnly {
		filter["dueAt"] = bson.M{"$lt": s.now()}
	}

	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 100
	}

	var out []Task
	err := s.tasks.Find(ctx, filter, &out,
		options.Find().SetSort(bson.D{{Key: "dueAt", Value: 1}}).SetLimit(int64(limit)))
	if err != nil {
		return nil, fmt.Errorf("discipleship: read tasks: %w", err)
	}
	if out == nil {
		out = []Task{}
	}
	return out, nil
}

// Touch records that somebody has started on a task.
//
// This is what stops the escalation. It is separate from closing on purpose: a
// volunteer who rang on Tuesday and got no answer has TOUCHED the task, and
// escalating it over their head would teach them the system is noise.
func (s *Service) Touch(ctx context.Context, taskID, actorID string) (*Task, error) {
	oid, task, err := s.readTask(ctx, taskID)
	if err != nil {
		return nil, err
	}
	if !task.Status.Open() {
		return nil, ErrAlreadyClosed
	}
	if task.FirstTouchedAt != nil {
		return task, nil
	}

	now := s.now()
	if _, err := s.tasks.UpdateOne(ctx, bson.M{"_id": oid}, bson.M{"$set": bson.M{
		"firstTouchedAt": now,
		"updatedAt":      now,
	}}); err != nil {
		return nil, fmt.Errorf("discipleship: touch task: %w", err)
	}
	_ = actorID
	return s.taskByOID(ctx, oid)
}

// CloseInput finishes a task.
type CloseInput struct {
	TaskID  string
	Status  TaskStatus
	Outcome string
	ActorID string
}

// Close finishes a follow-up, with what happened.
func (s *Service) Close(ctx context.Context, in CloseInput) (*Task, error) {
	if in.Status == "" {
		in.Status = TaskDone
	}
	if !in.Status.Valid() || in.Status.Open() {
		return nil, fmt.Errorf("%w: %q is not a closing status", ErrAlreadyClosed, in.Status)
	}
	outcome := strings.TrimSpace(in.Outcome)
	if outcome == "" {
		// A closed task with no outcome is a tick somebody made to clear their
		// list, and it tells the next person nothing about whether the visitor
		// was actually reached.
		return nil, ErrOutcomeRequired
	}

	oid, task, err := s.readTask(ctx, in.TaskID)
	if err != nil {
		return nil, err
	}
	if !task.Status.Open() {
		return nil, ErrAlreadyClosed
	}

	now := s.now()
	set := bson.M{
		"status":    string(in.Status),
		"outcome":   outcome,
		"closedAt":  now,
		"updatedAt": now,
	}
	if task.FirstTouchedAt == nil {
		set["firstTouchedAt"] = now
	}
	if _, err := s.tasks.UpdateOne(ctx, bson.M{"_id": oid}, bson.M{"$set": set}); err != nil {
		return nil, fmt.Errorf("discipleship: close task: %w", err)
	}
	return s.taskByOID(ctx, oid)
}

// Reassign moves a task to somebody else.
func (s *Service) Reassign(ctx context.Context, taskID, assigneeID string) (*Task, error) {
	if strings.TrimSpace(assigneeID) == "" {
		return nil, ErrNoOwner
	}
	oid, task, err := s.readTask(ctx, taskID)
	if err != nil {
		return nil, err
	}
	if !task.Status.Open() {
		return nil, ErrAlreadyClosed
	}
	if _, err := s.tasks.UpdateOne(ctx, bson.M{"_id": oid}, bson.M{"$set": bson.M{
		"assigneeId": mongodb.ID(assigneeID),
		"updatedAt":  s.now(),
	}}); err != nil {
		return nil, fmt.Errorf("discipleship: reassign task: %w", err)
	}
	return s.taskByOID(ctx, oid)
}

func (s *Service) readTask(ctx context.Context, taskID string) (bson.ObjectID, *Task, error) {
	oid, err := bson.ObjectIDFromHex(strings.TrimSpace(taskID))
	if err != nil {
		return bson.ObjectID{}, nil, ErrTaskNotFound
	}
	task, err := s.taskByOID(ctx, oid)
	if err != nil {
		return bson.ObjectID{}, nil, err
	}
	return oid, task, nil
}

func (s *Service) taskByOID(ctx context.Context, oid bson.ObjectID) (*Task, error) {
	var out Task
	err := s.tasks.FindOne(ctx, bson.M{"_id": oid}, &out)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrTaskNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("discipleship: read task: %w", err)
	}
	return &out, nil
}

// tenantOf is the caller's church.
func tenantOf(ctx context.Context) (string, error) {
	scope, err := tenancy.FromContext(ctx)
	if err != nil {
		return "", err
	}
	return scope.ChurchID, nil
}
