package discipleship

import (
	"context"
	"fmt"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// Escalation is the half that makes the SLA real.
//
// A deadline nobody is told about is a report. WP-34's criterion says the task
// "escalates if untouched", and untouched is a deliberately weaker test than
// unfinished: a volunteer who rang on Tuesday and got no answer has done their
// part, and escalating over their head would teach them the system is noise.
//
// # Escalated once, not repeatedly
//
// The status moves from open to escalated, and the escalation query only looks
// at open tasks. So a task escalates exactly once and then stays visible as
// escalated-and-still-untouched, which is the number a pastor actually needs —
// rather than generating a fresh alert every sweep until somebody mutes it.

// Escalator decides who an overdue task should go to.
//
// An interface because the answer is a church's org chart, which this package
// does not know: a small church escalates to the pastor, a large one to a
// department head. Nil means "escalate in place" — the status still changes and
// the task still surfaces, it simply does not change hands.
type Escalator interface {
	// SupervisorFor returns who to escalate to, or "" to leave it in place.
	SupervisorFor(ctx context.Context, assigneeID string) (string, error)
}

// EscalationResult reports one sweep of one church.
type EscalationResult struct {
	Examined  int `json:"examined"`
	Escalated int `json:"escalated"`
	// Reassigned is how many changed hands, which is at most Escalated: an
	// escalation with no supervisor still counts as escalated.
	Reassigned int `json:"reassigned"`
}

// maxPerSweep bounds one church's sweep.
//
// A church coming back from an outage with two thousand overdue tasks should
// escalate the oldest hundred and be swept again, rather than doing one
// enormous pass that times out and escalates none of them.
const maxPerSweep = 100

// EscalateOverdue escalates every open task past its deadline and untouched.
//
// Returns what it did rather than just an error, because "the sweeper ran and
// found nothing" and "the sweeper never ran" look identical in a log otherwise.
func (s *Service) EscalateOverdue(ctx context.Context, up Escalator) (*EscalationResult, error) {
	now := s.now()
	out := &EscalationResult{}

	var due []Task
	err := s.tasks.Find(ctx, bson.M{
		"status": string(TaskOpen),
		"dueAt":  bson.M{"$lt": now},
		// Untouched. A task somebody has picked up is not escalated, however
		// long it has been open — see the file comment.
		"firstTouchedAt": bson.M{"$exists": false},
	}, &due, options.Find().
		SetSort(bson.D{{Key: "dueAt", Value: 1}}).
		SetLimit(maxPerSweep))
	if err != nil {
		return nil, fmt.Errorf("discipleship: find overdue tasks: %w", err)
	}
	out.Examined = len(due)

	for i := range due {
		task := &due[i]

		supervisor := ""
		if up != nil {
			supervisor, err = up.SupervisorFor(ctx, task.AssigneeID.String())
			if err != nil {
				// One task's problem must not stop the sweep: a church whose
				// org chart has a gap should still get its other escalations.
				continue
			}
		}

		set := bson.M{
			"status":      string(TaskEscalated),
			"escalatedAt": now,
			"updatedAt":   now,
		}
		if supervisor != "" && supervisor != task.AssigneeID.String() {
			set["escalatedTo"] = mongodb.ID(supervisor)
			set["assigneeId"] = mongodb.ID(supervisor)
		}

		// Conditional on the status still being open. Two sweepers running at
		// once — which is the normal state of a service with more than one
		// replica — must not escalate the same task twice.
		res, err := s.tasks.UpdateOne(ctx, bson.M{
			"_id": task.ID, "status": string(TaskOpen),
		}, bson.M{"$set": set})
		if err != nil {
			return out, fmt.Errorf("discipleship: escalate task: %w", err)
		}
		if res.ModifiedCount == 0 {
			// Somebody else got there first.
			continue
		}

		out.Escalated++
		if _, changed := set["escalatedTo"]; changed {
			out.Reassigned++
		}
	}
	return out, nil
}

// ChurchesWithOverdueTasks lists churches with escalation work waiting.
//
// Global, because the sweeper runs on a timer and a timer has no request behind
// it and therefore no church. The caller re-enters each church's scope to do
// the work, so nothing crosses a tenant boundary — the same shape as the
// notification sweeper, and for the same reason.
func (s *Service) ChurchesWithOverdueTasks(ctx context.Context) ([]string, error) {
	var raw []any
	err := s.global.Distinct(ctx, mongodb.TenantField, bson.M{
		"status":         string(TaskOpen),
		"dueAt":          bson.M{"$lt": s.now()},
		"firstTouchedAt": bson.M{"$exists": false},
	}).Decode(&raw)
	if err != nil {
		return nil, fmt.Errorf("discipleship: find churches with overdue tasks: %w", err)
	}

	out := make([]string, 0, len(raw))
	for _, v := range raw {
		// churchId is an ObjectId when Mongoose wrote it and a string on older
		// Go rows (ADR-005). Handling only one form makes a sweeper that
		// silently skips half the platform — the same trap the notification
		// sweeper documents, and the same fix.
		switch id := v.(type) {
		case string:
			if id != "" {
				out = append(out, id)
			}
		case bson.ObjectID:
			out = append(out, id.Hex())
		}
	}
	return out, nil
}
