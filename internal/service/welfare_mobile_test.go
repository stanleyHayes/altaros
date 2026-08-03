package service

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/domain/auth"
	"github.com/hayfordstanley/altar-os/internal/domain/welfare"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/token"
)

func TestMemberWelfareWireMappings(t *testing.T) {
	cases := []struct {
		input string
		want  welfare.Urgency
	}{
		{"low", welfare.UrgencyRoutine},
		{"medium", welfare.UrgencyElevated},
		{"high", welfare.UrgencyElevated},
		{"critical", welfare.UrgencyEmergency},
		{"emergency", ""},
	}
	for _, tc := range cases {
		if got := memberWelfareUrgency(tc.input); got != tc.want {
			t.Fatalf("member urgency %q = %q, want %q", tc.input, got, tc.want)
		}
	}

	statuses := map[welfare.Status]string{
		welfare.StatusOpen:       "pending",
		welfare.StatusInProgress: "under_review",
		welfare.StatusAwaiting:   "under_review",
		welfare.StatusReferred:   "approved",
		welfare.StatusResolved:   "fulfilled",
		welfare.StatusClosed:     "declined",
	}
	for input, want := range statuses {
		if got := mobileWelfareStatus(input); got != want {
			t.Fatalf("status %q = %q, want %q", input, got, want)
		}
	}
}

func TestMemberWelfareHTTPPagesOnlyOwnedPrivateProjections(t *testing.T) {
	db, churchID, userID, memberID := notificationHTTPFixture(t)
	d := newTestDeps(t)
	d.Mongo = db
	d.Config.WelfareKey = "member-welfare-test-key"
	churchOID, _ := bson.ObjectIDFromHex(churchID)
	userOID, _ := bson.ObjectIDFromHex(userID)
	now := time.Now().UTC()
	if _, err := db.Global(auth.Collection).InsertOne(context.Background(), bson.M{
		"_id": userOID, "churchId": churchOID, "name": "Ama Mensah",
		"email": "ama@example.com", "phone": "+233241234567", "role": RoleMember,
		"createdAt": now, "updatedAt": now,
	}); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	ctx := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: churchID, UserID: userID, Role: RoleMember,
	})
	svc := newWelfareService(d)
	for i := 0; i < 2; i++ {
		opened, err := svc.Open(ctx, welfare.Input{
			MemberID: memberID, Category: welfare.CategoryCounseling,
			Summary: "Private request", Detail: "Only the member sees this detail.",
		})
		if err != nil {
			t.Fatalf("open own case %d: %v", i, err)
		}
		if _, err := svc.AddNote(ctx, opened.ID.Hex(), "Pastoral note must never be projected."); err != nil {
			t.Fatalf("add note %d: %v", i, err)
		}
	}
	if _, err := svc.Open(ctx, welfare.Input{MemberID: bson.NewObjectID().Hex(), Summary: "Foreign"}); err != nil {
		t.Fatalf("open foreign case: %v", err)
	}

	router := standalone(welfareRoutes(d))
	access := tokenFor(t, d, token.Identity{UserID: userID, ChurchID: churchID, Role: RoleMember})
	first := socialMemberRequest(t, router, access, http.MethodGet,
		"/welfare/my-requests?page=1&limit=1", nil)
	second := socialMemberRequest(t, router, access, http.MethodGet,
		"/welfare/my-requests?page=2&limit=1", nil)
	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("paged welfare statuses = %d/%d, bodies = %s / %s",
			first.Code, second.Code, first.Body.String(), second.Body.String())
	}
	decodePage := func(raw []byte) (memberWelfareResponse, int) {
		t.Helper()
		var envelope struct {
			Data struct {
				Data  []memberWelfareResponse `json:"data"`
				Total int                     `json:"total"`
			} `json:"data"`
		}
		if err := json.Unmarshal(raw, &envelope); err != nil || len(envelope.Data.Data) != 1 {
			t.Fatalf("decode private page: %v, body=%s", err, string(raw))
		}
		return envelope.Data.Data[0], envelope.Data.Total
	}
	one, totalOne := decodePage(first.Body.Bytes())
	two, totalTwo := decodePage(second.Body.Bytes())
	if one.ID == two.ID || one.MemberID != memberID || two.MemberID != memberID ||
		totalOne != 2 || totalTwo != 2 {
		t.Fatalf("private pages crossed ownership or count: one=%+v two=%+v totals=%d/%d",
			one, two, totalOne, totalTwo)
	}
}

func TestMemberWelfareResponsePreservesOwnedSubmission(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Millisecond)
	item := &welfare.Case{
		ID: bson.NewObjectID(), ChurchID: mongodb.ID(bson.NewObjectID().Hex()),
		MemberID: bson.NewObjectID().Hex(), Category: welfare.CategoryCounseling,
		Urgency: welfare.UrgencyElevated, Status: welfare.StatusOpen,
		Summary: "Short summary", Detail: "Please arrange a private conversation.",
		IsAnonymous: true, CreatedAt: now,
	}
	got := memberWelfareCase(item)
	if got.ID != item.ID.Hex() || got.ChurchID != item.ChurchID.String() || got.MemberID != item.MemberID {
		t.Fatalf("response changed ownership: %#v", got)
	}
	if got.Category != "counseling" || got.Description != item.Detail || got.Urgency != "high" || !got.IsAnonymous || got.Status != "pending" {
		t.Fatalf("response changed the member submission: %#v", got)
	}
}

func TestMemberWelfareInputBoundsAndAnonymousPastoralRedaction(t *testing.T) {
	if !validMemberWelfareDescription("Please call me privately.\nTonight if possible.") {
		t.Fatal("a bounded multiline request was rejected")
	}
	if validMemberWelfareDescription("") || validMemberWelfareDescription(string([]byte{'x', 0, 'y'})) {
		t.Fatal("empty or control-character input was accepted")
	}
	tooLong := make([]byte, 2001)
	for i := range tooLong {
		tooLong[i] = 'x'
	}
	if validMemberWelfareDescription(string(tooLong)) {
		t.Fatal("an oversized welfare narrative was accepted")
	}

	item := &welfare.Case{
		MemberID: bson.NewObjectID().Hex(), RaisedBy: mongodb.ID(bson.NewObjectID().Hex()),
		IsAnonymous: true,
	}
	redacted := redactAnonymousWelfareCase(item)
	if redacted.MemberID != "" || redacted.RaisedBy != "" || item.MemberID == "" || item.RaisedBy == "" {
		t.Fatal("pastoral redaction either leaked the member or mutated the stored case")
	}
}
