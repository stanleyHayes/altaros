package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/domain/spiritual"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

func TestPrayerMemberProjectionProtectsAnonymousOwnership(t *testing.T) {
	name := "Ama Mensah"
	item := spiritual.PrayerRequest{
		ID: bson.NewObjectID(), ChurchID: mongodb.ID(bson.NewObjectID().Hex()),
		MemberID: mongodb.ID(bson.NewObjectID().Hex()), Title: "Please pray",
		Description: "A private concern.", IsAnonymous: true, PrayerCount: 2,
		AuthorName: &name, CreatedAt: time.Now().UTC(),
	}

	publicJSON, err := json.Marshal(prayerForMember(item, false))
	if err != nil {
		t.Fatalf("marshal public prayer: %v", err)
	}
	var public map[string]any
	if err := json.Unmarshal(publicJSON, &public); err != nil {
		t.Fatalf("decode public prayer: %v", err)
	}
	if _, exposed := public["memberId"]; exposed {
		t.Fatal("anonymous congregation response exposed memberId")
	}
	if _, exposed := public["authorName"]; exposed {
		t.Fatal("anonymous congregation response exposed authorName")
	}

	owner := prayerForMember(item, true)
	if owner.MemberID != item.MemberID.String() {
		t.Fatalf("creator response memberId = %q, want %q", owner.MemberID, item.MemberID)
	}
}

func TestSermonPagesRemainStableWhenPublishedDatesMatch(t *testing.T) {
	db, churchID, userID, _ := notificationHTTPFixture(t)
	ctx := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: churchID, UserID: userID, Role: RoleMember,
	})
	collection := db.Tenant(spiritual.SermonCollection)
	published := time.Now().UTC().Truncate(time.Second)
	for _, title := range []string{"First recording", "Second recording"} {
		if _, err := collection.InsertOne(ctx, bson.M{
			"title": title, "speaker": "Pastor Ama", "date": published,
			"duration": "42:00", "description": "A recorded message.",
		}); err != nil {
			t.Fatalf("insert sermon %q: %v", title, err)
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/spiritual/sermons?page=2&limit=1", nil).WithContext(ctx)
	rec := httptest.NewRecorder()
	handleSermons(spiritual.NewService(db))(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("sermon page status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var envelope struct {
		Success bool `json:"success"`
		Data    struct {
			Sermons []spiritual.Sermon `json:"sermons"`
			Total   int64              `json:"total"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode sermon page: %v", err)
	}
	if !envelope.Success || envelope.Data.Total != 2 || len(envelope.Data.Sermons) != 1 {
		t.Fatalf("sermon page = %+v", envelope)
	}
	if got := envelope.Data.Sermons[0].Title; got != "First recording" {
		t.Fatalf("stable page two sermon = %q, want First recording", got)
	}
}

func TestPrayerMemberProjectionDoesNotExposeRosterIDInCongregationList(t *testing.T) {
	name := "Ama Mensah"
	item := spiritual.PrayerRequest{
		ID: bson.NewObjectID(), ChurchID: mongodb.ID(bson.NewObjectID().Hex()),
		MemberID: mongodb.ID(bson.NewObjectID().Hex()), Title: "Thanksgiving",
		Description: "We are grateful.", AuthorName: &name, CreatedAt: time.Now().UTC(),
	}
	view := prayerForMember(item, false)
	if view.MemberID != "" || view.AuthorName == nil || *view.AuthorName != name {
		t.Fatalf("public named prayer projection = %+v", view)
	}
}
