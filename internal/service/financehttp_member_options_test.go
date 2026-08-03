package service

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/domain/auth"
	"github.com/hayfordstanley/altar-os/internal/domain/finance"
	"github.com/hayfordstanley/altar-os/internal/platform/token"
)

func TestFinanceHTTPReturnsOnlyTheMembersAttributableGivingOptions(t *testing.T) {
	db, churchID, userID, memberID := notificationHTTPFixture(t)
	d := newTestDeps(t)
	d.Mongo = db
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
	campaignID := bson.NewObjectID()
	if _, err := db.Global(finance.CampaignCollection).InsertOne(context.Background(), bson.M{
		"_id": campaignID, "churchId": churchOID, "title": "New sanctuary",
		"targetAmount": int64(1_000_000), "currency": "GHS", "isActive": true,
		"startDate": now.Add(-time.Hour), "endDate": now.Add(30 * 24 * time.Hour),
		"createdAt": now, "updatedAt": now,
	}); err != nil {
		t.Fatalf("seed campaign: %v", err)
	}
	otherCampaignID := bson.NewObjectID()
	if _, err := db.Global(finance.CampaignCollection).InsertOne(context.Background(), bson.M{
		"_id": otherCampaignID, "churchId": churchOID, "title": "Closed appeal",
		"targetAmount": int64(500_000), "currency": "GHS", "isActive": false,
		"startDate": now.Add(-48 * time.Hour), "endDate": now.Add(24 * time.Hour),
		"createdAt": now, "updatedAt": now,
	}); err != nil {
		t.Fatalf("seed closed campaign: %v", err)
	}
	if _, err := db.Global(finance.PledgeCollection).InsertOne(context.Background(), bson.M{
		"churchId": churchOID, "memberId": memberID, "campaignId": campaignID,
		"totalMinor": int64(100_000), "currency": "GHS", "frequency": "monthly",
		"instalments": 10, "startDate": now, "note": "Building promise",
		"createdAt": now, "updatedAt": now,
	}); err != nil {
		t.Fatalf("seed own pledge: %v", err)
	}
	otherPledge, err := db.Global(finance.PledgeCollection).InsertOne(context.Background(), bson.M{
		"churchId": churchOID, "memberId": bson.NewObjectID().Hex(),
		"totalMinor": int64(50_000), "currency": "GHS", "frequency": "monthly",
		"instalments": 5, "startDate": now, "createdAt": now, "updatedAt": now,
	})
	if err != nil {
		t.Fatalf("seed other pledge: %v", err)
	}

	router := standalone(financeRoutes(d))
	access := tokenFor(t, d, token.Identity{UserID: userID, ChurchID: churchID, Role: RoleMember})
	rec := socialMemberRequest(t, router, access, http.MethodGet, "/finance/me/giving-options", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("options status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var envelope struct {
		Data struct {
			Campaigns []struct {
				ID string `json:"id"`
			} `json:"campaigns"`
			Pledges []finance.PledgeProgress `json:"pledges"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode options: %v", err)
	}
	if len(envelope.Data.Campaigns) != 1 || envelope.Data.Campaigns[0].ID != campaignID.Hex() {
		t.Fatalf("campaigns = %#v, want only active campaign", envelope.Data.Campaigns)
	}
	if len(envelope.Data.Pledges) != 1 || envelope.Data.Pledges[0].Pledge.MemberID != memberID {
		t.Fatalf("pledges = %#v, want only member %q", envelope.Data.Pledges, memberID)
	}

	owned := socialMemberRequest(t, router, access, http.MethodGet,
		"/finance/pledges?memberId="+memberID, nil)
	if owned.Code != http.StatusOK {
		t.Fatalf("own pledge status = %d, body = %s", owned.Code, owned.Body.String())
	}

	unattributed := socialMemberRequest(t, router, access, http.MethodPost, "/finance/give", map[string]any{
		"type": "campaign", "amount": "10.00", "currency": "GHS",
		"channel": "mobile_money", "acceptedTotalMinor": 1000,
	})
	if unattributed.Code != http.StatusBadRequest {
		t.Fatalf("unattributed campaign status = %d, body = %s", unattributed.Code, unattributed.Body.String())
	}
	otherPledgeID := otherPledge.InsertedID.(bson.ObjectID).Hex()
	crossMember := socialMemberRequest(t, router, access, http.MethodPost, "/finance/give", map[string]any{
		"type": "pledge_payment", "pledgeId": otherPledgeID, "amount": "10.00",
		"currency": "GHS", "channel": "mobile_money", "acceptedTotalMinor": 1000,
	})
	if crossMember.Code != http.StatusBadRequest {
		t.Fatalf("cross-member pledge status = %d, body = %s", crossMember.Code, crossMember.Body.String())
	}
}
