// Package auth handles identity: registration, login, tokens (WP-10).
//
// Ported from apps/api/src/domain/auth, with three things the TypeScript
// version left unfinished or unsafe:
//
//   - Phone OTP login was a 501 stub, despite being the primary login method
//     for a mobile-money-first market. It is implemented here (see otp.go).
//   - There was no token revocation: refresh re-issued from any valid token
//     and nothing could be invalidated, so a stolen refresh token worked for
//     up to 30 days. Tokens are now revocable and refresh rotates.
//   - Login leaked account existence: a missing user and a wrong password
//     returned different paths. Both now cost the same and say the same thing.
package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"golang.org/x/crypto/bcrypt"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/token"
)

// Collection holding user accounts. Shared with the legacy TypeScript API
// during migration, so field names match what it already writes.
const Collection = "users"

// bcryptCost of 12 matches the TypeScript implementation, keeping existing
// hashes verifiable so members do not have to reset passwords at cutover.
const bcryptCost = 12

var (
	// ErrInvalidCredentials is returned for every failed login regardless of
	// cause. Distinguishing "no such user" from "wrong password" turns the
	// login form into an account-enumeration oracle.
	ErrInvalidCredentials = errors.New("auth: invalid credentials")
	// ErrAccountDeactivated means the account exists but is disabled.
	ErrAccountDeactivated = errors.New("auth: account is deactivated")
	// ErrUserNotFound is for lookups by id, not for login.
	ErrUserNotFound = errors.New("auth: user not found")
	// ErrPhoneRequired is returned when an OTP flow is missing a number.
	ErrPhoneRequired = errors.New("auth: phone number is required")
)

// User is an account. Users are global rather than tenant-scoped: the church
// is a field on the user, and a login by definition happens before any tenant
// context exists.
type User struct {
	ID bson.ObjectID `bson:"_id,omitempty"    json:"id"`
	// mongodb.ID, not string: the legacy TypeScript API stores these as
	// Mongoose ObjectIds while shared-types declares them as strings.
	ChurchID       mongodb.ID `bson:"churchId"                 json:"churchId"`
	OrganizationID mongodb.ID `bson:"organizationId,omitempty" json:"organizationId,omitempty"`
	Email          string     `bson:"email"            json:"email"`
	Phone          string     `bson:"phone"            json:"phone"`
	Name           string     `bson:"name"             json:"name"`
	Role           string     `bson:"role"             json:"role"`
	PasswordHash   string     `bson:"passwordHash"     json:"-"`
	AvatarURL      string     `bson:"avatarUrl,omitempty" json:"avatarUrl,omitempty"`
	IsActive       bool       `bson:"isActive"         json:"isActive"`
	PhoneVerified  bool       `bson:"phoneVerified"    json:"phoneVerified"`
	CreatedAt      time.Time  `bson:"createdAt"        json:"createdAt"`
	UpdatedAt      time.Time  `bson:"updatedAt"        json:"updatedAt"`
}

// SMSSender delivers the OTP. Kept as an interface so tests capture the code
// instead of paying for real SMS.
type SMSSender interface {
	Send(ctx context.Context, to, message string) error
}

// Service implements the auth use cases.
type Service struct {
	users  *mongo.Collection
	tokens *token.Issuer
	otp    *otpStore
	sms    SMSSender
}

// NewService builds the auth service.
//
// Users are reached through Global() rather than Tenant(): authentication
// necessarily happens before a tenant is known, so this is one of the few
// legitimate cross-tenant collections (see mongodb.Global).
func NewService(db *mongodb.DB, issuer *token.Issuer, rdb *redis.Client, sms SMSSender) *Service {
	return &Service{
		users:  db.Global(Collection),
		tokens: issuer,
		otp:    &otpStore{redis: rdb},
		sms:    sms,
	}
}

// EnsureIndexes creates the uniqueness the auth flows depend on.
func (s *Service) EnsureIndexes(ctx context.Context) error {
	err := mongodb.EnsureIndexes(ctx, s.users, []mongo.IndexModel{
		{
			Keys:    bson.D{{Key: "email", Value: 1}},
			Options: options.Index().SetName("email_unique").SetUnique(true).SetSparse(true),
		},
		{
			// Phone is the primary login identifier, so it must be unique.
			Keys:    bson.D{{Key: "phone", Value: 1}},
			Options: options.Index().SetName("phone_unique").SetUnique(true).SetSparse(true),
		},
	})
	if err != nil {
		return fmt.Errorf("auth: create indexes: %w", err)
	}
	return nil
}

// Result is a successful authentication.
type Result struct {
	User   *User       `json:"user"`
	Tokens *token.Pair `json:"tokens"`
}

// --- password login ---

// LoginWithPassword authenticates by email and password.
func (s *Service) LoginWithPassword(ctx context.Context, email, password string) (*Result, error) {
	var user User
	err := s.users.FindOne(ctx, bson.M{"email": normalizeEmail(email)}).Decode(&user)

	if errors.Is(err, mongo.ErrNoDocuments) {
		// Hash anyway so a missing account and a wrong password take the same
		// time. Skipping this makes response latency an account oracle.
		_, _ = bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, fmt.Errorf("auth: lookup by email: %w", err)
	}

	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) != nil {
		return nil, ErrInvalidCredentials
	}
	if !user.IsActive {
		return nil, ErrAccountDeactivated
	}

	return s.issueFor(ctx, &user)
}

// --- OTP login ---

// RequestOTP sends a login code to a phone number.
//
// It returns success even when the number is unknown: a differing response
// would let anyone test which numbers belong to church members, which for a
// religious congregation is a membership-disclosure risk, not just a privacy
// nicety.
func (s *Service) RequestOTP(ctx context.Context, phone string) error {
	phone = strings.TrimSpace(phone)
	if phone == "" {
		return ErrPhoneRequired
	}

	var user User
	err := s.users.FindOne(ctx, bson.M{"phone": phone}).Decode(&user)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil // Silent no-op; see doc comment.
	}
	if err != nil {
		return fmt.Errorf("auth: lookup by phone: %w", err)
	}
	if !user.IsActive {
		return nil // Same shape as unknown, for the same reason.
	}

	code, err := s.otp.issue(ctx, phone)
	if err != nil {
		// ErrOTPTooSoon is surfaced: the member is waiting for a code and
		// needs to know one was already sent.
		return err
	}

	msg := fmt.Sprintf("Your ALTAR OS code is %s. It expires in %d minutes. Do not share it.",
		code, int(otpTTL.Minutes()))
	if err := s.sms.Send(ctx, phone, msg); err != nil {
		return fmt.Errorf("auth: send otp: %w", err)
	}
	return nil
}

// VerifyOTP exchanges a code for tokens.
func (s *Service) VerifyOTP(ctx context.Context, phone, code string) (*Result, error) {
	phone = strings.TrimSpace(phone)
	if phone == "" {
		return nil, ErrPhoneRequired
	}

	if err := s.otp.verify(ctx, phone, code); err != nil {
		return nil, err
	}

	var user User
	err := s.users.FindOne(ctx, bson.M{"phone": phone}).Decode(&user)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, fmt.Errorf("auth: lookup by phone: %w", err)
	}
	if !user.IsActive {
		return nil, ErrAccountDeactivated
	}

	// A verified code proves control of the number.
	if !user.PhoneVerified {
		_, _ = s.users.UpdateOne(ctx,
			bson.M{"_id": user.ID},
			bson.M{"$set": bson.M{"phoneVerified": true, "updatedAt": time.Now().UTC()}},
		)
		user.PhoneVerified = true
	}

	return s.issueFor(ctx, &user)
}

// --- tokens ---

// Refresh rotates a refresh token, re-reading the user so a deactivation or
// role change takes effect at refresh rather than persisting for the token's
// full lifetime.
func (s *Service) Refresh(ctx context.Context, refreshToken string) (*Result, error) {
	// ConsumeRefresh, not Verify: verifying here would return ErrRevoked for a
	// replayed token and return before the issuer could revoke the family,
	// silently disabling theft detection.
	claims, err := s.tokens.ConsumeRefresh(ctx, refreshToken)
	if err != nil {
		return nil, err
	}

	user, err := s.byIDString(ctx, claims.UserID)
	if err != nil {
		return nil, err
	}
	if !user.IsActive {
		// Deactivated between issue and refresh: revoke the whole family so
		// the still-valid access token dies with it.
		_ = s.tokens.RevokeFamily(ctx, claims.Family, 30*24*time.Hour)
		return nil, ErrAccountDeactivated
	}

	// Re-read identity from the user, so a role or church change takes effect
	// now rather than persisting for the token's full lifetime.
	pair, err := s.tokens.IssueInFamily(ctx, token.Identity{
		UserID:         user.ID.Hex(),
		ChurchID:       user.ChurchID.String(),
		OrganizationID: user.OrganizationID.String(),
		Role:           user.Role,
	}, claims.Family)
	if err != nil {
		return nil, err
	}
	return &Result{User: user, Tokens: pair}, nil
}

// Logout revokes a single token pair.
func (s *Service) Logout(ctx context.Context, accessToken string) error {
	return s.tokens.Revoke(ctx, accessToken)
}

// LogoutEverywhere revokes every session descended from this login. Used on
// password change and on "sign out of all devices".
func (s *Service) LogoutEverywhere(ctx context.Context, accessToken string) error {
	claims, err := s.tokens.Verify(ctx, accessToken, token.KindAccess)
	if err != nil {
		return err
	}
	return s.tokens.RevokeFamily(ctx, claims.Family, 30*24*time.Hour)
}

// CurrentUser resolves the user behind an access token.
func (s *Service) CurrentUser(ctx context.Context, accessToken string) (*User, error) {
	claims, err := s.tokens.Verify(ctx, accessToken, token.KindAccess)
	if err != nil {
		return nil, err
	}
	return s.byIDString(ctx, claims.UserID)
}

func (s *Service) issueFor(ctx context.Context, user *User) (*Result, error) {
	pair, err := s.tokens.Issue(ctx, token.Identity{
		UserID:         user.ID.Hex(),
		ChurchID:       user.ChurchID.String(),
		OrganizationID: user.OrganizationID.String(),
		Role:           user.Role,
	})
	if err != nil {
		return nil, err
	}
	return &Result{User: user, Tokens: pair}, nil
}

func (s *Service) byIDString(ctx context.Context, id string) (*User, error) {
	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return nil, ErrUserNotFound
	}

	var user User
	if err := s.users.FindOne(ctx, bson.M{"_id": oid}).Decode(&user); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("auth: lookup by id: %w", err)
	}
	return &user, nil
}

// HashPassword hashes a password for storage.
func HashPassword(plain string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(plain), bcryptCost)
	if err != nil {
		return "", fmt.Errorf("auth: hash password: %w", err)
	}
	return string(h), nil
}

// normalizeEmail lower-cases and trims, so Pastor@Church.org and
// pastor@church.org are one account rather than two.
func normalizeEmail(e string) string {
	return strings.ToLower(strings.TrimSpace(e))
}
