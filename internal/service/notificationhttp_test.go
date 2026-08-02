package service

import (
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/domain/notification"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

func TestNotificationForMemberMatchesMobileInboxContract(t *testing.T) {
	created := time.Date(2026, time.August, 1, 12, 0, 0, 0, time.UTC)
	read := created.Add(time.Minute)
	item := notificationForMember(notification.Notification{
		ID: bson.NewObjectID(), ChurchID: mongodb.ID(bson.NewObjectID().Hex()),
		MemberID: mongodb.ID(bson.NewObjectID().Hex()), Channel: notification.ChannelPush,
		Kind: notification.KindTransactional, Status: notification.StatusDelivered,
		Subject: "Giving receipt", Body: "Thank you.", CreatedAt: created, ReadAt: &read,
	})
	if item.Status != "READ" || item.Channel != "PUSH" || item.Type != "CUSTOM" {
		t.Fatalf("mobile contract status/channel/type = %q/%q/%q", item.Status, item.Channel, item.Type)
	}
	if item.Title != "Giving receipt" || item.Metadata == nil || item.ReadAt == nil {
		t.Fatalf("mobile contract omitted visible or required fields: %+v", item)
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
