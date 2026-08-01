package auth

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
	"github.com/hayfordstanley/altar-os/internal/platform/token"
)

// captureSMS records messages instead of sending them, so tests can read the
// OTP the member would have received.
type captureSMS struct {
	mu   sync.Mutex
	sent []struct{ To, Message string }
}

func (c *captureSMS) Send(_ context.Context, to, message string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.sent = append(c.sent, struct{ To, Message string }{to, message})
	return nil
}

func (c *captureSMS) lastCode(t *testing.T) string {
	t.Helper()
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.sent) == 0 {
		t.Fatal("no SMS was sent")
	}
	msg := c.sent[len(c.sent)-1].Message
	// "Your ALTAR OS code is 123456. It expires ..."
	for i := 0; i+otpLength <= len(msg); i++ {
		candidate := msg[i : i+otpLength]
		allDigits := true
		for _, r := range candidate {
			if r < '0' || r > '9' {
				allDigits = false
				break
			}
		}
		if allDigits {
			return candidate
		}
	}
	t.Fatalf("no %d-digit code found in %q", otpLength, msg)
	return ""
}

type harness struct {
	svc  *Service
	sms  *captureSMS
	iss  *token.Issuer
	db   *mongodb.DB
	user *User
}

func newHarness(t *testing.T) (*harness, context.Context) {
	t.Helper()
	ctx := context.Background()

	mongoURI := os.Getenv("MONGODB_URI")
	if mongoURI == "" {
		mongoURI = "mongodb://localhost:27017"
	}
	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		redisAddr = "127.0.0.1:6379"
	}

	connectCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	db, err := mongodb.Connect(connectCtx, config.MongoConfig{
		URI:            mongoURI,
		Database:       "altar_test_auth",
		ConnectTimeout: 3 * time.Second,
	})
	if err != nil {
		testsupport.SkipOrFail(t, "MongoDB", err)
	}

	rdb := redis.NewClient(&redis.Options{Addr: redisAddr, DB: 14})
	if err := rdb.Ping(connectCtx).Err(); err != nil {
		testsupport.SkipOrFail(t, "Redis", err)
	}
	_ = rdb.FlushDB(ctx)

	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = db.Database().Drop(c)
		_ = rdb.FlushDB(c)
		_ = rdb.Close()
		_ = db.Close(c)
	})

	iss, err := token.NewIssuer(token.Options{
		Secret:     "test-secret",
		Issuer:     "altar-os-test",
		AccessTTL:  15 * time.Minute,
		RefreshTTL: 30 * 24 * time.Hour,
		Redis:      rdb,
	})
	if err != nil {
		t.Fatalf("NewIssuer: %v", err)
	}

	sms := &captureSMS{}
	svc := NewService(db, iss, rdb, sms)
	if err := svc.EnsureIndexes(ctx); err != nil {
		t.Fatalf("EnsureIndexes: %v", err)
	}

	// Seed a member: phone-first, as most members in this market will be.
	hash, err := HashPassword("CorrectHorseBattery1")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	user := &User{
		ChurchID:     "church_1",
		Email:        "ama@gracechapel.org",
		Phone:        "+233241234567",
		Name:         "Ama Owusu",
		Role:         "MEMBER",
		PasswordHash: hash,
		IsActive:     true,
		CreatedAt:    time.Now().UTC(),
		UpdatedAt:    time.Now().UTC(),
	}
	res, err := db.Global(Collection).InsertOne(ctx, user)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	user.ID = res.InsertedID.(bson.ObjectID)

	return &harness{svc: svc, sms: sms, iss: iss, db: db, user: user}, ctx
}

func TestRegistrationRequiresOTPBeforeIssuingSession(t *testing.T) {
	h, ctx := newHarness(t)
	churchID := bson.NewObjectID()
	if _, err := h.db.Global("churches").InsertOne(ctx, bson.M{
		"_id": churchID, "name": "Grace East", "slug": "grace-east", "isActive": true,
	}); err != nil {
		t.Fatalf("seed church: %v", err)
	}

	user, err := h.svc.Register(ctx, RegisterRequest{
		ChurchID: churchID.Hex(), Email: " NEW@Example.com ", Phone: "024 555 0199",
		Name: "  Esi Boateng  ", Password: "StrongPass123",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	if user.ChurchID.String() != churchID.Hex() || user.Role != "MEMBER" || user.Phone != "+233245550199" {
		t.Fatalf("unexpected registered identity: %+v", user)
	}
	if user.PhoneVerified || !user.PhoneVerificationRequired {
		t.Fatal("new account must require phone ownership proof")
	}
	if _, err := h.svc.LoginWithPassword(ctx, "", user.Email, "StrongPass123"); !errors.Is(err, ErrPhoneVerificationRequired) {
		t.Fatalf("password login before OTP = %v, want verification required", err)
	}

	if err := h.svc.RequestOTP(ctx, "", user.Phone); err != nil {
		t.Fatalf("RequestOTP: %v", err)
	}
	verified, err := h.svc.VerifyOTP(ctx, "", user.Phone, h.sms.lastCode(t))
	if err != nil {
		t.Fatalf("VerifyOTP: %v", err)
	}
	if verified.Tokens.AccessToken == "" || !verified.User.PhoneVerified {
		t.Fatal("OTP should be the first operation to issue an authenticated session")
	}
}

func TestRegistrationRejectsUnavailableChurchAndDuplicateIdentity(t *testing.T) {
	h, ctx := newHarness(t)
	if _, err := h.svc.Register(ctx, RegisterRequest{
		ChurchID: bson.NewObjectID().Hex(), Email: "new@example.com", Phone: "+233245550199",
		Name: "Esi Boateng", Password: "StrongPass123",
	}); !errors.Is(err, ErrChurchUnavailable) {
		t.Fatalf("missing church error = %v", err)
	}

	churchID := bson.NewObjectID()
	if _, err := h.db.Global("churches").InsertOne(ctx, bson.M{
		"_id": churchID, "name": "Grace East", "slug": "grace-east", "isActive": true,
	}); err != nil {
		t.Fatalf("seed church: %v", err)
	}

	first := RegisterRequest{
		ChurchID: churchID.Hex(), Email: "esi@example.com", Phone: "+233245550199",
		Name: "Esi Boateng", Password: "StrongPass123",
	}
	if _, err := h.svc.Register(ctx, first); err != nil {
		t.Fatalf("first registration: %v", err)
	}

	// The SAME address in the SAME church is still a duplicate.
	if _, err := h.svc.Register(ctx, first); !errors.Is(err, ErrAccountExists) {
		t.Fatalf("duplicate identity error = %v", err)
	}

	// The same address in a DIFFERENT church is not (WP-35). Before workspace
	// scoping this was refused, which is what stopped a person who attends two
	// churches from holding an account in each.
	second := bson.NewObjectID()
	if _, err := h.db.Global("churches").InsertOne(ctx, bson.M{
		"_id": second, "name": "Grace West", "slug": "grace-west", "isActive": true,
	}); err != nil {
		t.Fatalf("seed second church: %v", err)
	}
	h.dropGlobalIndexes(t, ctx) // the old global index would still refuse it

	elsewhere := first
	elsewhere.ChurchID = second.Hex()
	elsewhere.Phone = "+233245550200" // a distinct number; only the email is shared
	if _, err := h.svc.Register(ctx, elsewhere); err != nil {
		t.Fatalf("the same address in another church was refused: %v", err)
	}
}

// WP-10 acceptance, end to end: OTP login -> refresh -> revoke.
func TestOTPLoginRefreshRevokeEndToEnd(t *testing.T) {
	h, ctx := newHarness(t)

	// 1. Request a code.
	if err := h.svc.RequestOTP(ctx, "", h.user.Phone); err != nil {
		t.Fatalf("RequestOTP: %v", err)
	}
	code := h.sms.lastCode(t)

	// 2. Exchange it for tokens.
	result, err := h.svc.VerifyOTP(ctx, "", h.user.Phone, code)
	if err != nil {
		t.Fatalf("VerifyOTP: %v", err)
	}
	if result.Tokens.AccessToken == "" || result.Tokens.RefreshToken == "" {
		t.Fatal("a verified code must yield both tokens")
	}
	if !result.User.PhoneVerified {
		t.Error("a verified code proves control of the number; phoneVerified should be set")
	}

	// 3. The access token resolves the user.
	me, err := h.svc.CurrentUser(ctx, result.Tokens.AccessToken)
	if err != nil {
		t.Fatalf("CurrentUser: %v", err)
	}
	if me.Phone != h.user.Phone {
		t.Errorf("wrong user resolved: %s", me.Phone)
	}

	// 4. Refresh rotates.
	refreshed, err := h.svc.Refresh(ctx, result.Tokens.RefreshToken)
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	if refreshed.Tokens.RefreshToken == result.Tokens.RefreshToken {
		t.Error("refresh must rotate the refresh token")
	}

	// 5. Revoke, and the token stops working.
	if err := h.svc.Logout(ctx, refreshed.Tokens.AccessToken); err != nil {
		t.Fatalf("Logout: %v", err)
	}
	if _, err := h.svc.CurrentUser(ctx, refreshed.Tokens.AccessToken); !errors.Is(err, token.ErrRevoked) {
		t.Fatalf("a revoked token must be rejected, got %v", err)
	}
}

// A code is single-use: replaying it must not yield a second session.
func TestOTPCodeIsSingleUse(t *testing.T) {
	h, ctx := newHarness(t)

	if err := h.svc.RequestOTP(ctx, "", h.user.Phone); err != nil {
		t.Fatalf("RequestOTP: %v", err)
	}
	code := h.sms.lastCode(t)

	if _, err := h.svc.VerifyOTP(ctx, "", h.user.Phone, code); err != nil {
		t.Fatalf("first verify: %v", err)
	}
	if _, err := h.svc.VerifyOTP(ctx, "", h.user.Phone, code); !errors.Is(err, ErrOTPNotFound) {
		t.Fatalf("a used code must not work twice, got %v", err)
	}
}

// Six digits is a million combinations; without a cap that is brute-forceable.
func TestOTPAttemptsAreCapped(t *testing.T) {
	h, ctx := newHarness(t)

	if err := h.svc.RequestOTP(ctx, "", h.user.Phone); err != nil {
		t.Fatalf("RequestOTP: %v", err)
	}
	realCode := h.sms.lastCode(t)

	for i := 0; i < otpMaxAttempts; i++ {
		if _, err := h.svc.VerifyOTP(ctx, "", h.user.Phone, "000000"); err != nil &&
			!errors.Is(err, ErrOTPIncorrect) && !errors.Is(err, ErrOTPTooManyAttempts) {
			t.Fatalf("attempt %d: unexpected error %v", i, err)
		}
	}

	// The code is burned even though it is the correct one.
	_, err := h.svc.VerifyOTP(ctx, "", h.user.Phone, realCode)
	if err == nil {
		t.Fatal("the code should be unusable after exhausting attempts")
	}
}

// Requesting a code for an unknown number must look identical to requesting
// one for a member, or the endpoint becomes a membership oracle.
func TestOTPForUnknownNumberIsSilent(t *testing.T) {
	h, ctx := newHarness(t)

	if err := h.svc.RequestOTP(ctx, "", "+233200000000"); err != nil {
		t.Fatalf("an unknown number must not error: %v", err)
	}
	h.sms.mu.Lock()
	sent := len(h.sms.sent)
	h.sms.mu.Unlock()
	if sent != 0 {
		t.Error("no SMS should be sent to a number that belongs to nobody")
	}
}

func TestOTPPhoneSpellingsUseOneCanonicalKey(t *testing.T) {
	h, ctx := newHarness(t)

	if err := h.svc.RequestOTP(ctx, "", "024 123 4567"); err != nil {
		t.Fatalf("domestic spelling should resolve: %v", err)
	}
	if _, err := h.svc.VerifyOTP(ctx, "", "00233 24 123 4567", h.sms.lastCode(t)); err != nil {
		t.Fatalf("international-prefix spelling should verify the same code: %v", err)
	}
}

func TestOTPRejectsUnusablePhoneBeforeLookup(t *testing.T) {
	h, ctx := newHarness(t)

	if err := h.svc.RequestOTP(ctx, "", "024"); !errors.Is(err, ErrPhoneInvalid) {
		t.Fatalf("invalid phone should be rejected, got %v", err)
	}
	if _, err := h.svc.VerifyOTP(ctx, "", "not-a-phone", "123456"); !errors.Is(err, ErrPhoneInvalid) {
		t.Fatalf("invalid verification phone should be rejected, got %v", err)
	}
}

// SMS costs money; the endpoint must not be usable as a bulk sender.
func TestOTPResendIsThrottled(t *testing.T) {
	h, ctx := newHarness(t)

	if err := h.svc.RequestOTP(ctx, "", h.user.Phone); err != nil {
		t.Fatalf("first request: %v", err)
	}
	if err := h.svc.RequestOTP(ctx, "", h.user.Phone); !errors.Is(err, ErrOTPTooSoon) {
		t.Fatalf("an immediate resend must be throttled, got %v", err)
	}
}

func TestPasswordLoginSucceeds(t *testing.T) {
	h, ctx := newHarness(t)

	result, err := h.svc.LoginWithPassword(ctx, "", h.user.Email, "CorrectHorseBattery1")
	if err != nil {
		t.Fatalf("LoginWithPassword: %v", err)
	}
	if result.Tokens.AccessToken == "" {
		t.Error("login should issue tokens")
	}
}

func TestNewAccountCannotBypassPhoneVerificationWithPassword(t *testing.T) {
	h, ctx := newHarness(t)
	if _, err := h.svc.users.UpdateOne(ctx,
		bson.M{"_id": h.user.ID},
		bson.M{"$set": bson.M{
			"phoneVerified":             false,
			"phoneVerificationRequired": true,
		}},
	); err != nil {
		t.Fatalf("mark verification required: %v", err)
	}

	if _, err := h.svc.LoginWithPassword(ctx, "", h.user.Email, "CorrectHorseBattery1"); !errors.Is(err, ErrPhoneVerificationRequired) {
		t.Fatalf("password must not bypass phone ownership proof, got %v", err)
	}

	if err := h.svc.RequestOTP(ctx, "", h.user.Phone); err != nil {
		t.Fatalf("request OTP: %v", err)
	}
	if _, err := h.svc.VerifyOTP(ctx, "", h.user.Phone, h.sms.lastCode(t)); err != nil {
		t.Fatalf("verify OTP: %v", err)
	}
	if _, err := h.svc.LoginWithPassword(ctx, "", h.user.Email, "CorrectHorseBattery1"); err != nil {
		t.Fatalf("password should work after verification: %v", err)
	}
}

// Email is normalised, so one account is not two.
func TestEmailLoginIsCaseInsensitive(t *testing.T) {
	h, ctx := newHarness(t)

	if _, err := h.svc.LoginWithPassword(ctx, "", "  AMA@GraceChapel.ORG ", "CorrectHorseBattery1"); err != nil {
		t.Fatalf("email should be normalised before lookup: %v", err)
	}
}

// A wrong password and an unknown account must be indistinguishable.
func TestLoginDoesNotRevealAccountExistence(t *testing.T) {
	h, ctx := newHarness(t)

	_, wrongPassword := h.svc.LoginWithPassword(ctx, "", h.user.Email, "not-the-password")
	_, noSuchUser := h.svc.LoginWithPassword(ctx, "", "nobody@example.org", "not-the-password")

	if !errors.Is(wrongPassword, ErrInvalidCredentials) || !errors.Is(noSuchUser, ErrInvalidCredentials) {
		t.Fatalf("both must be ErrInvalidCredentials, got %v and %v", wrongPassword, noSuchUser)
	}
	if wrongPassword.Error() != noSuchUser.Error() {
		t.Error("the two failures must be indistinguishable to the caller")
	}
}

func TestDeactivatedAccountCannotLogIn(t *testing.T) {
	h, ctx := newHarness(t)

	// Deactivate.
	if _, err := h.svc.users.UpdateOne(ctx,
		bson.M{"_id": h.user.ID},
		bson.M{"$set": bson.M{"isActive": false}},
	); err != nil {
		t.Fatalf("deactivate: %v", err)
	}

	if _, err := h.svc.LoginWithPassword(ctx, "", h.user.Email, "CorrectHorseBattery1"); !errors.Is(err, ErrAccountDeactivated) {
		t.Fatalf("want ErrAccountDeactivated, got %v", err)
	}
}

// Deactivation must take effect at refresh rather than persisting for the
// token's full 30-day life.
func TestDeactivationTakesEffectAtRefresh(t *testing.T) {
	h, ctx := newHarness(t)

	result, err := h.svc.LoginWithPassword(ctx, "", h.user.Email, "CorrectHorseBattery1")
	if err != nil {
		t.Fatalf("login: %v", err)
	}

	if _, err := h.svc.users.UpdateOne(ctx,
		bson.M{"_id": h.user.ID},
		bson.M{"$set": bson.M{"isActive": false}},
	); err != nil {
		t.Fatalf("deactivate: %v", err)
	}

	if _, err := h.svc.CurrentUser(ctx, result.Tokens.AccessToken); !errors.Is(err, ErrAccountDeactivated) {
		t.Fatalf("current-user reconciliation must refuse a deactivated account, got %v", err)
	}

	if _, err := h.svc.Refresh(ctx, result.Tokens.RefreshToken); !errors.Is(err, ErrAccountDeactivated) {
		t.Fatalf("refresh must refuse a deactivated account, got %v", err)
	}

	// And the still-unexpired access token is killed with the family.
	if _, err := h.svc.CurrentUser(ctx, result.Tokens.AccessToken); !errors.Is(err, token.ErrRevoked) {
		t.Errorf("the outstanding access token should be revoked too, got %v", err)
	}
}

// Signing out everywhere must invalidate other sessions, not just this one.
func TestLogoutEverywhereEndsAllSessions(t *testing.T) {
	h, ctx := newHarness(t)

	first, err := h.svc.LoginWithPassword(ctx, "", h.user.Email, "CorrectHorseBattery1")
	if err != nil {
		t.Fatalf("login: %v", err)
	}

	if err := h.svc.LogoutEverywhere(ctx, first.Tokens.AccessToken); err != nil {
		t.Fatalf("LogoutEverywhere: %v", err)
	}

	if _, err := h.svc.CurrentUser(ctx, first.Tokens.AccessToken); !errors.Is(err, token.ErrRevoked) {
		t.Errorf("access token should be revoked, got %v", err)
	}
	if _, err := h.svc.Refresh(ctx, first.Tokens.RefreshToken); !errors.Is(err, token.ErrRevoked) {
		t.Errorf("refresh token should be revoked, got %v", err)
	}
}

// Regression: replaying a rotated refresh token must revoke the whole family
// THROUGH THE SERVICE, not just through the issuer.
//
// The first implementation called tokens.Verify() before rotating, which
// returned ErrRevoked and returned early — so the issuer's family-revocation
// never ran and theft detection was dead code in the real request path. The
// issuer-level unit test passed because it bypassed the service entirely.
// Only an end-to-end call caught it, which is why this test exists here.
func TestRefreshReplayRevokesFamilyThroughService(t *testing.T) {
	h, ctx := newHarness(t)

	first, err := h.svc.LoginWithPassword(ctx, "", h.user.Email, "CorrectHorseBattery1")
	if err != nil {
		t.Fatalf("login: %v", err)
	}

	second, err := h.svc.Refresh(ctx, first.Tokens.RefreshToken)
	if err != nil {
		t.Fatalf("first refresh: %v", err)
	}

	// Attacker replays the token the legitimate client already rotated away.
	if _, err := h.svc.Refresh(ctx, first.Tokens.RefreshToken); !errors.Is(err, token.ErrRevoked) {
		t.Fatalf("replayed refresh must be refused, got %v", err)
	}

	// The legitimate session must now be dead too — otherwise the attacker
	// and the member share a live session.
	if _, err := h.svc.CurrentUser(ctx, second.Tokens.AccessToken); !errors.Is(err, token.ErrRevoked) {
		t.Fatalf("replay must revoke the whole family, got %v", err)
	}
	if _, err := h.svc.Refresh(ctx, second.Tokens.RefreshToken); !errors.Is(err, token.ErrRevoked) {
		t.Fatalf("the rotated refresh token must be revoked with its family, got %v", err)
	}
}

// A role change must take effect on the next refresh rather than persisting
// for the token's full lifetime.
func TestRefreshPicksUpRoleChange(t *testing.T) {
	h, ctx := newHarness(t)

	first, err := h.svc.LoginWithPassword(ctx, "", h.user.Email, "CorrectHorseBattery1")
	if err != nil {
		t.Fatalf("login: %v", err)
	}

	if _, err := h.svc.users.UpdateOne(ctx,
		bson.M{"_id": h.user.ID},
		bson.M{"$set": bson.M{"role": "CHURCH_ADMIN"}},
	); err != nil {
		t.Fatalf("promote: %v", err)
	}

	refreshed, err := h.svc.Refresh(ctx, first.Tokens.RefreshToken)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}

	claims, err := h.iss.Verify(ctx, refreshed.Tokens.AccessToken, token.KindAccess)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims.Role != "CHURCH_ADMIN" {
		t.Errorf("refreshed token should carry the new role, got %s", claims.Role)
	}
}

// Codes must be unpredictable: a run of identical codes would mean a broken
// generator, which is a silent account-takeover.
func TestGeneratedCodesVaryAndAreWellFormed(t *testing.T) {
	seen := make(map[string]int)
	for i := 0; i < 200; i++ {
		code, err := generateCode()
		if err != nil {
			t.Fatalf("generateCode: %v", err)
		}
		if len(code) != otpLength {
			t.Fatalf("code %q must be exactly %d digits (zero-padded)", code, otpLength)
		}
		for _, r := range code {
			if r < '0' || r > '9' {
				t.Fatalf("code %q must be numeric", code)
			}
		}
		seen[code]++
	}
	if len(seen) < 150 {
		t.Errorf("codes look insufficiently random: only %d distinct of 200", len(seen))
	}
}
