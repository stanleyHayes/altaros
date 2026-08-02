package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/discipleship"
	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

// A follow-up task belongs to the person it is assigned to. These tests exist
// because the first cut of this file guarded /journeys and /reassign and left
// /touch and /close open to any authenticated member of the church — which is
// worse than it sounds. Touching a task is what SUPPRESSES its escalation, so
// the hole silently disabled the safety net that WP-34 exists to provide: the
// visitor never gets called, and the mechanism that would have caught that is
// switched off by the same request.

const (
	dChurch   = "6a6d0a46536bf5e6e21ce001"
	dOwner    = "6a6f3460a6b0e0738ce10001"
	dStranger = "6a6f3460a6b0e0738ce10002"
	dVisitor  = "6a6f3460a6b0e0738ce10003"
)

func discipleshipTestService(t *testing.T) *discipleship.Service {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	db, err := mongodb.Connect(ctx, config.MongoConfig{
		URI:            testsupport.MongoURI(),
		Database:       "altar_test_discipleship_http",
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

	svc := discipleship.NewService(db)
	scoped := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: dChurch, UserID: dOwner,
	})
	if err := svc.EnsureIndexes(scoped); err != nil {
		t.Fatalf("EnsureIndexes: %v", err)
	}
	return svc
}

// asCaller builds a request carrying a signed-in caller and their permissions,
// which is what the handlers actually read.
func asCaller(t *testing.T, method, target, body, userID string, holds ...rbac.Permission) *http.Request {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("{}")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, target, reader)
	req.Header.Set("Content-Type", "application/json")

	ctx := tenancy.WithScope(req.Context(), tenancy.Scope{
		ChurchID: dChurch, UserID: userID, Role: "MEMBER",
	})
	ctx = withPermissions(ctx, rbac.NewSet(holds...))
	return req.WithContext(ctx)
}

// withURLParam attaches a chi route parameter, which the handlers read for {id}.
func withURLParam(req *http.Request, key, value string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add(key, value)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

// seedTask creates a follow-up assigned to dOwner and returns its id.
//
// Backdated four days, so its 48-hour SLA has already lapsed and the escalation
// check below is meaningful without a clock injected into production code.
func seedTask(t *testing.T, svc *discipleship.Service) string {
	t.Helper()
	scoped := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: dChurch, UserID: dOwner,
	})
	out, err := svc.Record(scoped, discipleship.RecordInput{
		MemberID: dVisitor, Stage: discipleship.StageFirstTimer,
		AssigneeID: dOwner, ActorID: dOwner,
		At: time.Now().UTC().Add(-96 * time.Hour),
	})
	if err != nil {
		t.Fatalf("Record: %v", err)
	}
	return out.Task.ID.Hex()
}

// A member who holds nothing must not be able to close somebody else's
// follow-up. Closing it means the church believes the visitor was contacted.
func TestAStrangerCannotCloseSomebodyElsesFollowUp(t *testing.T) {
	svc := discipleshipTestService(t)
	taskID := seedTask(t, svc)

	req := withURLParam(asCaller(t, http.MethodPost,
		"/discipleship/tasks/"+taskID+"/close",
		`{"status":"done","outcome":"Nothing to do here."}`, dStranger), "id", taskID)
	rec := httptest.NewRecorder()
	handleCloseTask(svc)(rec, req)

	if rec.Code != http.StatusNotFound && rec.Code != http.StatusForbidden {
		t.Fatalf("a stranger closed another member's follow-up: status %d, body %s",
			rec.Code, rec.Body.String())
	}

	// And the task is untouched in the database.
	scoped := tenancy.WithScope(context.Background(), tenancy.Scope{ChurchID: dChurch})
	tasks, err := svc.Tasks(scoped, discipleship.TaskFilter{OpenOnly: true})
	if err != nil {
		t.Fatalf("Tasks: %v", err)
	}
	if len(tasks) != 1 {
		t.Fatalf("the follow-up is no longer open — it was closed by a stranger")
	}
}

// Touching is what suppresses escalation, so an unauthorised touch is the
// quieter and more dangerous half: nothing visibly changes, and the safety net
// stops firing.
func TestAStrangerCannotTouchSomebodyElsesFollowUp(t *testing.T) {
	svc := discipleshipTestService(t)
	taskID := seedTask(t, svc)

	req := withURLParam(asCaller(t, http.MethodPost,
		"/discipleship/tasks/"+taskID+"/touch", "", dStranger), "id", taskID)
	rec := httptest.NewRecorder()
	handleTouchTask(svc)(rec, req)

	if rec.Code != http.StatusNotFound && rec.Code != http.StatusForbidden {
		t.Fatalf("a stranger touched another member's follow-up: status %d, body %s",
			rec.Code, rec.Body.String())
	}

	// The decisive check: the escalation must still fire. If firstTouchedAt was
	// set, this returns 0 and the visitor is never chased.
	scoped := tenancy.WithScope(context.Background(), tenancy.Scope{ChurchID: dChurch})
	res, err := svc.EscalateOverdue(scoped, nil)
	if err != nil {
		t.Fatalf("EscalateOverdue: %v", err)
	}
	if res.Escalated != 1 {
		t.Fatalf("escalation was suppressed by an unauthorised touch (escalated %d)",
			res.Escalated)
	}
}

// The assignee may of course work their own task.
func TestTheAssigneeCanTouchAndCloseTheirOwnFollowUp(t *testing.T) {
	svc := discipleshipTestService(t)
	taskID := seedTask(t, svc)

	req := withURLParam(asCaller(t, http.MethodPost,
		"/discipleship/tasks/"+taskID+"/touch", "", dOwner), "id", taskID)
	rec := httptest.NewRecorder()
	handleTouchTask(svc)(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("the assignee could not touch their own task: %d %s",
			rec.Code, rec.Body.String())
	}

	req = withURLParam(asCaller(t, http.MethodPost,
		"/discipleship/tasks/"+taskID+"/close",
		`{"status":"done","outcome":"Called; coming on Sunday."}`, dOwner), "id", taskID)
	rec = httptest.NewRecorder()
	handleCloseTask(svc)(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("the assignee could not close their own task: %d %s",
			rec.Code, rec.Body.String())
	}
}

// A leader reassigning and following up on behalf of the team is legitimate,
// and holding member:update is what says so.
func TestSomebodyWithMemberUpdateCanWorkAnybodysFollowUp(t *testing.T) {
	svc := discipleshipTestService(t)
	taskID := seedTask(t, svc)

	req := withURLParam(asCaller(t, http.MethodPost,
		"/discipleship/tasks/"+taskID+"/close",
		`{"status":"unreachable","outcome":"Number does not connect."}`,
		dStranger, rbac.NewPermission(rbac.ResourceMember, rbac.ActionUpdate)),
		"id", taskID)
	rec := httptest.NewRecorder()
	handleCloseTask(svc)(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("a leader with member:update could not close a task: %d %s",
			rec.Code, rec.Body.String())
	}
}
