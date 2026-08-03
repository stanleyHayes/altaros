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
	"go.mongodb.org/mongo-driver/v2/mongo"

	"github.com/hayfordstanley/altar-os/internal/domain/auth"
	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

func authMemberFixture(t *testing.T) (*mongodb.DB, bson.ObjectID) {
	t.Helper()
	uri := os.Getenv("MONGODB_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	db, err := mongodb.Connect(ctx, config.MongoConfig{
		URI: uri, Database: "altar_test_auth_member_http", ConnectTimeout: 5 * time.Second,
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
	if _, err := db.Global("churches").InsertOne(ctx, bson.M{
		"_id": churchID, "name": "Grace Chapel", "slug": "grace-member-http",
		"isActive": true, "createdAt": time.Now().UTC(), "updatedAt": time.Now().UTC(),
	}); err != nil {
		t.Fatalf("seed church: %v", err)
	}
	return db, churchID
}

func registerMemberRequest(t *testing.T, handler http.Handler, churchID string, body map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	body["churchId"] = churchID
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("encode request: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/auth/register", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestRegistrationReturnsDistinctAccountAndMemberIdentities(t *testing.T) {
	db, churchID := authMemberFixture(t)
	d := newTestDeps(t)
	d.Mongo = db
	d.Config.DataRegion = "GH"
	router := standalone(authRoutes(d))
	rec := registerMemberRequest(t, router, churchID.Hex(), map[string]string{
		"name": "Ama Mensah", "email": "ama@example.com",
		"phone": "+233241234567", "password": "StrongPass123",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("register status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var envelope struct {
		Data struct {
			User struct {
				ID, MemberID string
			} `json:"user"`
			Tokens any `json:"tokens"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode registration: %v", err)
	}
	if envelope.Data.User.ID == "" || envelope.Data.User.MemberID == "" || envelope.Data.User.ID == envelope.Data.User.MemberID {
		t.Fatalf("registration did not distinguish account and member ids: %+v", envelope.Data.User)
	}
	if envelope.Data.Tokens != nil {
		t.Fatal("registration issued a session before OTP verification")
	}
	userOID, _ := bson.ObjectIDFromHex(envelope.Data.User.ID)
	memberOID, _ := bson.ObjectIDFromHex(envelope.Data.User.MemberID)
	var linked bson.M
	if err := db.Global("members").FindOne(context.Background(), bson.M{
		"_id": memberOID, "churchId": churchID, "userId": userOID,
	}).Decode(&linked); err != nil {
		t.Fatalf("member roster link missing: %v", err)
	}
}

func TestRegistrationRollsBackAccountWhenRosterIdentityBelongsToAnotherUser(t *testing.T) {
	db, churchID := authMemberFixture(t)
	d := newTestDeps(t)
	d.Mongo = db
	d.Config.DataRegion = "GH"
	ctx := context.Background()
	if _, err := db.Global("members").InsertOne(ctx, bson.M{
		"_id": bson.NewObjectID(), "churchId": churchID, "userId": bson.NewObjectID(),
		"firstName": "Ama", "lastName": "Mensah", "phoneE164": "+233241234567",
		"email": "old@example.com", "status": "active",
		"createdAt": time.Now().UTC(), "updatedAt": time.Now().UTC(),
	}); err != nil {
		t.Fatalf("seed linked member: %v", err)
	}
	router := standalone(authRoutes(d))
	rec := registerMemberRequest(t, router, churchID.Hex(), map[string]string{
		"name": "Ama Mensah", "email": "new@example.com",
		"phone": "+233241234567", "password": "StrongPass123",
	})
	if rec.Code != http.StatusConflict {
		t.Fatalf("register status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if err := db.Global(auth.Collection).FindOne(ctx, bson.M{
		"churchId": churchID, "email": "new@example.com",
	}).Err(); err != mongo.ErrNoDocuments {
		t.Fatalf("failed registration stranded an account: %v", err)
	}
}
