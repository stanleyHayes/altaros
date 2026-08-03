package service

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/domain/member"
	"github.com/hayfordstanley/altar-os/internal/domain/notification"
	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
	"github.com/hayfordstanley/altar-os/internal/platform/token"
)

func TestNotificationForMemberMatchesMobileInboxContract(t *testing.T) {
	created := time.Date(2026, time.August, 1, 12, 0, 0, 0, time.UTC)
	read := created.Add(time.Minute)
	item := notificationForMember(notification.Notification{
		ID: bson.NewObjectID(), ChurchID: mongodb.ID(bson.NewObjectID().Hex()),
		MemberID: mongodb.ID(bson.NewObjectID().Hex()), Channel: notification.ChannelPush,
		Kind: notification.KindTransactional, Status: notification.StatusDelivered,
		Subject: "Giving receipt", Body: "Thank you.", CreatedAt: created, ReadAt: &read,
		DeepLink: "altaros://giving/history",
	})
	if item.Status != "READ" || item.Channel != "PUSH" || item.Type != "CUSTOM" {
		t.Fatalf("mobile contract status/channel/type = %q/%q/%q", item.Status, item.Channel, item.Type)
	}
	if item.Title != "Giving receipt" || item.Metadata == nil || item.ReadAt == nil {
		t.Fatalf("mobile contract omitted visible or required fields: %+v", item)
	}
	if item.Metadata["deepLink"] != "altaros://giving/history" {
		t.Fatalf("mobile inbox omitted safe deep link: %+v", item.Metadata)
	}
}

func notificationHTTPFixture(t *testing.T) (*mongodb.DB, string, string, string) {
	t.Helper()
	uri := os.Getenv("MONGODB_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	db, err := mongodb.Connect(ctx, config.MongoConfig{
		URI: uri, Database: "altar_test_notificationhttp", ConnectTimeout: 5 * time.Second,
	})
	if err != nil {
		testsupport.SkipOrFail(t, "MongoDB", err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = db.Database().Drop(cleanup)
		_ = db.Close(cleanup)
	})
	churchID := bson.NewObjectID()
	userID := bson.NewObjectID()
	memberID := bson.NewObjectID()
	if _, err := db.Global("members").InsertOne(ctx, bson.M{
		"_id": memberID, "churchId": churchID, "userId": userID,
		"firstName": "Ama", "lastName": "Mensah", "status": "active",
		"createdAt": time.Now().UTC(), "updatedAt": time.Now().UTC(),
	}); err != nil {
		t.Fatalf("seed member: %v", err)
	}
	return db, churchID.Hex(), userID.Hex(), memberID.Hex()
}

func TestNotificationHTTPBridgesUserSessionToMemberOwnership(t *testing.T) {
	db, churchID, userID, memberID := notificationHTTPFixture(t)
	d := newTestDeps(t)
	d.Mongo = db
	d.Config.DataRegion = "GH"
	ctx := context.Background()
	churchOID, err := bson.ObjectIDFromHex(churchID)
	if err != nil {
		t.Fatalf("church id: %v", err)
	}
	notificationID := bson.NewObjectID()
	foreignID := bson.NewObjectID()
	now := time.Now().UTC()
	for _, row := range []bson.M{
		{"_id": notificationID, "churchId": churchOID, "memberId": memberID,
			"channel": "push", "kind": "transactional", "status": "sent",
			"subject": "Owned update", "body": "This belongs to the signed-in member.",
			"createdAt": now, "updatedAt": now},
		{"_id": foreignID, "churchId": churchOID, "memberId": bson.NewObjectID().Hex(),
			"channel": "push", "kind": "transactional", "status": "sent",
			"subject": "Foreign update", "body": "Must stay hidden.",
			"createdAt": now, "updatedAt": now},
	} {
		if _, err := db.Global(notification.Collection).InsertOne(ctx, row); err != nil {
			t.Fatalf("seed notification: %v", err)
		}
	}

	router := standalone(notificationRoutes(d))
	access := tokenFor(t, d, token.Identity{UserID: userID, ChurchID: churchID, Role: RoleMember})
	inbox := call(router, http.MethodGet, "/notifications", access)
	if inbox.Code != http.StatusOK {
		t.Fatalf("inbox status = %d, body = %s", inbox.Code, inbox.Body.String())
	}
	var envelope struct {
		Data []memberNotificationResponse `json:"data"`
	}
	if err := json.Unmarshal(inbox.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode inbox: %v", err)
	}
	items := envelope.Data
	if len(items) != 1 || items[0].ID != notificationID.Hex() {
		t.Fatalf("inbox crossed or missed member ownership: %+v", items)
	}
	paged := call(router, http.MethodGet, "/notifications?page=1&limit=1", access)
	if paged.Code != http.StatusOK {
		t.Fatalf("paged inbox status = %d, body = %s", paged.Code, paged.Body.String())
	}
	var pageEnvelope struct {
		Data struct {
			Data  []memberNotificationResponse `json:"data"`
			Total int                          `json:"total"`
		} `json:"data"`
	}
	if err := json.Unmarshal(paged.Body.Bytes(), &pageEnvelope); err != nil {
		t.Fatalf("decode paged inbox: %v", err)
	}
	if len(pageEnvelope.Data.Data) != 1 || pageEnvelope.Data.Total != 1 ||
		pageEnvelope.Data.Data[0].ID != notificationID.Hex() {
		t.Fatalf("paged inbox = %+v, want owned row and total 1", pageEnvelope.Data)
	}

	read := call(router, http.MethodPut, "/notifications/"+notificationID.Hex()+"/read", access)
	if read.Code != http.StatusOK {
		t.Fatalf("read status = %d, body = %s", read.Code, read.Body.String())
	}

	tokenValue := "ExponentPushToken[0123456789abcdefghijklmnopqrstuvwxyz]"
	body, _ := json.Marshal(map[string]string{"token": tokenValue, "platform": "android"})
	req := httptest.NewRequest(http.MethodPost, "/notifications/devices", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+access)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("device status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var device notification.DeviceRegistration
	if err := db.Global(notification.DeviceCollection).FindOne(ctx, bson.M{"token": tokenValue}).Decode(&device); err != nil {
		t.Fatalf("read device: %v", err)
	}
	if device.MemberID != memberID || device.MemberID == userID {
		t.Fatalf("device attached to %q, want member %q and never user %q", device.MemberID, memberID, userID)
	}
}

func TestLogoutDeviceCleanupRemovesMemberAndLegacyUserRows(t *testing.T) {
	db, churchID, userID, memberID := notificationHTTPFixture(t)
	d := newTestDeps(t)
	d.Mongo = db
	d.Config.DataRegion = "GH"
	ctx := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: churchID, UserID: userID, Role: RoleMember,
	})
	svc := newNotificationService(d)
	if err := svc.RegisterDevice(ctx, userID, "family-a", "legacy-user-token-0123456789abcdef", "android"); err != nil {
		t.Fatalf("register legacy device: %v", err)
	}
	if err := svc.RegisterDevice(ctx, memberID, "family-a", "member-device-token-0123456789abcdef", "ios"); err != nil {
		t.Fatalf("register member device: %v", err)
	}
	resolver := member.NewService(db, nil, "GH")
	if err := removeSessionDevices(ctx, svc, resolver, userID, "family-a"); err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	for _, owner := range []string{userID, memberID} {
		tokens, err := svc.DeviceTokens(ctx, owner)
		if err != nil || len(tokens) != 0 {
			t.Fatalf("owner %s retained tokens %v (err %v)", owner, tokens, err)
		}
	}
}

func TestNotificationForMemberUsesSafeTitleAndDeliveryStates(t *testing.T) {
	base := notification.Notification{
		ID: bson.NewObjectID(), ChurchID: mongodb.ID("church"), MemberID: mongodb.ID("member"),
		Channel: notification.ChannelSMS, Kind: notification.KindAnnouncement,
		Body: "Service begins at ten.", CreatedAt: time.Now().UTC(),
	}
	base.Status = notification.StatusQueued
	if got := notificationForMember(base); got.Status != "PENDING" || got.Title != "Church update" {
		t.Fatalf("queued fallback = %+v", got)
	}
	base.Status = notification.StatusSuppressed
	if got := notificationForMember(base); got.Status != "FAILED" {
		t.Fatalf("suppressed status = %q, want FAILED", got.Status)
	}
}

func TestNotificationServiceIsMountedByTheGateway(t *testing.T) {
	found := false
	for _, name := range Implemented() {
		if name == "notification" {
			found = true
		}
	}
	if !found {
		t.Fatal("notification is not reported as an implemented gateway service")
	}
}
