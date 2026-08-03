package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/event"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

func TestMobileEventListReturnsCanonicalArrayData(t *testing.T) {
	db, churchID, userID, _ := notificationHTTPFixture(t)
	d := newTestDeps(t)
	d.Mongo = db
	svc := newEventService(d)
	ctx := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: churchID, UserID: userID, Role: RoleMember,
	})
	created, err := svc.Create(ctx, event.Input{
		Title: "Sunday worship", StartDate: time.Now().UTC().Add(time.Hour),
		EndDate: time.Now().UTC().Add(3 * time.Hour),
	})
	if err != nil {
		t.Fatalf("create event: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/events/church/"+churchID+"?limit=20", nil)
	route := chi.NewRouteContext()
	route.URLParams.Add("churchId", churchID)
	req = req.WithContext(context.WithValue(ctx, chi.RouteCtxKey, route))
	rec := httptest.NewRecorder()
	handleMobileEvents(svc)(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("mobile events status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var envelope struct {
		Success bool          `json:"success"`
		Data    []event.Event `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("mobile event response is not array data: %v; body=%s", err, rec.Body.String())
	}
	if !envelope.Success || len(envelope.Data) != 1 || envelope.Data[0].ID != created.ID {
		t.Fatalf("mobile event data = %+v, want created event %s", envelope, created.ID.Hex())
	}
}

func TestMobileEventListPagesOnlyEventsThatHaveNotEnded(t *testing.T) {
	db, churchID, userID, _ := notificationHTTPFixture(t)
	d := newTestDeps(t)
	d.Mongo = db
	svc := newEventService(d)
	ctx := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: churchID, UserID: userID, Role: RoleMember,
	})
	now := time.Now().UTC()
	for _, input := range []event.Input{
		{Title: "Already ended", StartDate: now.Add(-3 * time.Hour), EndDate: now.Add(-2 * time.Hour)},
		{Title: "In progress", StartDate: now.Add(-time.Hour), EndDate: now.Add(time.Hour)},
		{Title: "Next gathering", StartDate: now.Add(2 * time.Hour), EndDate: now.Add(3 * time.Hour)},
		{Title: "Later gathering", StartDate: now.Add(4 * time.Hour), EndDate: now.Add(5 * time.Hour)},
	} {
		if _, err := svc.Create(ctx, input); err != nil {
			t.Fatalf("create %q: %v", input.Title, err)
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/events/church/"+churchID+"?page=2&limit=1&upcoming=true", nil)
	route := chi.NewRouteContext()
	route.URLParams.Add("churchId", churchID)
	req = req.WithContext(context.WithValue(ctx, chi.RouteCtxKey, route))
	rec := httptest.NewRecorder()
	handleMobileEvents(svc)(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("mobile events status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var envelope struct {
		Success bool `json:"success"`
		Data    struct {
			Data  []event.Event `json:"data"`
			Total int64         `json:"total"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode paged mobile events: %v; body=%s", err, rec.Body.String())
	}
	if !envelope.Success || envelope.Data.Total != 3 || len(envelope.Data.Data) != 1 {
		t.Fatalf("paged mobile event data = %+v", envelope)
	}
	if got := envelope.Data.Data[0].Title; got != "Next gathering" {
		t.Fatalf("page 2 event = %q, want Next gathering", got)
	}
}

func TestMobileUpcomingEventsProjectRecurringSeriesOntoNextOccurrence(t *testing.T) {
	db, churchID, userID, _ := notificationHTTPFixture(t)
	d := newTestDeps(t)
	d.Mongo = db
	svc := newEventService(d)
	ctx := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: churchID, UserID: userID, Role: RoleMember,
	})
	seriesStart := time.Date(2019, time.January, 6, 9, 0, 0, 0, time.UTC)
	created, err := svc.Create(ctx, event.Input{
		Title: "Weekly worship", StartDate: seriesStart,
		EndDate: seriesStart.Add(2 * time.Hour), RecurrenceRule: "FREQ=WEEKLY",
	})
	if err != nil {
		t.Fatalf("create recurring event: %v", err)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/events/church/"+churchID+"?page=1&limit=25&upcoming=true", nil)
	listRoute := chi.NewRouteContext()
	listRoute.URLParams.Add("churchId", churchID)
	listReq = listReq.WithContext(context.WithValue(ctx, chi.RouteCtxKey, listRoute))
	listRec := httptest.NewRecorder()
	handleMobileEvents(svc)(listRec, listReq)
	var listEnvelope struct {
		Data struct {
			Data []event.Event `json:"data"`
		} `json:"data"`
	}
	if err := json.Unmarshal(listRec.Body.Bytes(), &listEnvelope); err != nil || len(listEnvelope.Data.Data) != 1 {
		t.Fatalf("decode recurring list: %v; body=%s", err, listRec.Body.String())
	}
	projected := listEnvelope.Data.Data[0]
	now := time.Now().UTC()
	if projected.ID != created.ID || projected.StartDate.Equal(seriesStart) {
		t.Fatalf("recurring event was not projected: %+v", projected)
	}
	if projected.EndDate.Before(now) || projected.StartDate.After(now.Add(7*24*time.Hour)) {
		t.Fatalf("projected occurrence is not current/next week: %s - %s", projected.StartDate, projected.EndDate)
	}
	if projected.EndDate.Sub(projected.StartDate) != 2*time.Hour {
		t.Fatalf("projected duration = %s, want 2h", projected.EndDate.Sub(projected.StartDate))
	}

	detailReq := httptest.NewRequest(http.MethodGet, "/events/"+created.ID.Hex()+"?upcoming=true", nil)
	detailRoute := chi.NewRouteContext()
	detailRoute.URLParams.Add("id", created.ID.Hex())
	detailReq = detailReq.WithContext(context.WithValue(ctx, chi.RouteCtxKey, detailRoute))
	detailRec := httptest.NewRecorder()
	handleGetEvent(svc)(detailRec, detailReq)
	var detailEnvelope struct {
		Data event.Event `json:"data"`
	}
	if err := json.Unmarshal(detailRec.Body.Bytes(), &detailEnvelope); err != nil {
		t.Fatalf("decode recurring detail: %v; body=%s", err, detailRec.Body.String())
	}
	if !detailEnvelope.Data.StartDate.Equal(projected.StartDate) || !detailEnvelope.Data.EndDate.Equal(projected.EndDate) {
		t.Fatalf("detail occurrence %s-%s differs from list %s-%s", detailEnvelope.Data.StartDate, detailEnvelope.Data.EndDate, projected.StartDate, projected.EndDate)
	}
}
