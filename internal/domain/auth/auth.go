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
	"net/mail"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"golang.org/x/crypto/bcrypt"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/phone"
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
	// ErrPhoneInvalid means the supplied number cannot be represented safely as
	// E.164 for OTP lookup and delivery.
	ErrPhoneInvalid = errors.New("auth: phone number is invalid")
	// ErrPhoneVerificationRequired prevents a newly registered account from
	// bypassing the OTP ownership proof through password login. The persisted
	// flag is opt-in so legacy accounts created before this rollout continue to
	// work until they verify naturally.
	ErrPhoneVerificationRequired = errors.New("auth: phone verification is required")
	// ErrAccountExists deliberately does not identify which login identifier
	// collided; registration must not become an account-enumeration endpoint.
	ErrAccountExists       = errors.New("auth: account already exists")
	ErrRegistrationInvalid = errors.New("auth: registration details are invalid")
	ErrChurchUnavailable   = errors.New("auth: church is unavailable")
	// ErrSelfSignupClosed means the church has turned off self-registration
	// (Q-10 / R-17). Distinct from ErrChurchUnavailable so the person is told
	// to ask for an invitation rather than that the church does not exist.
	ErrSelfSignupClosed = errors.New("auth: this church is not accepting self-registration")
)

// User is an account. Users are global rather than tenant-scoped: the church
// is a field on the user, and a login by definition happens before any tenant
// context exists.
type User struct {
	ID bson.ObjectID `bson:"_id,omitempty"    json:"id"`
	// mongodb.ID, not string: the legacy TypeScript API stores these as
	// Mongoose ObjectIds while shared-types declares them as strings.
	ChurchID                  mongodb.ID `bson:"churchId"                 json:"churchId"`
	OrganizationID            mongodb.ID `bson:"organizationId,omitempty" json:"organizationId,omitempty"`
	Email                     string     `bson:"email"            json:"email"`
	Phone                     string     `bson:"phone"            json:"phone"`
	Name                      string     `bson:"name"             json:"name"`
	Role                      string     `bson:"role"             json:"role"`
	PasswordHash              string     `bson:"passwordHash"     json:"-"`
	AvatarURL                 string     `bson:"avatarUrl,omitempty" json:"avatarUrl,omitempty"`
	IsActive                  bool       `bson:"isActive"         json:"isActive"`
	PhoneVerified             bool       `bson:"phoneVerified"    json:"phoneVerified"`
	PhoneVerificationRequired bool       `bson:"phoneVerificationRequired,omitempty" json:"phoneVerificationRequired,omitempty"`
	// SelfRegistered marks an account somebody created for themselves rather
	// than one the church added or invited (Q-10, R-17).
	//
	// Recorded because the two are otherwise indistinguishable, and a church
	// looking at a name it does not recognise needs to know which it is
	// looking at. It grants nothing and withholds nothing — the role does that
	// — but it is the difference between "who is this" and "who let them in".
	SelfRegistered bool      `bson:"selfRegistered,omitempty" json:"selfRegistered,omitempty"`
	CreatedAt      time.Time `bson:"createdAt"        json:"createdAt"`
	UpdatedAt                 time.Time  `bson:"updatedAt"        json:"updatedAt"`
}

// SMSSender delivers the OTP. Kept as an interface so tests capture the code
// instead of paying for real SMS.
type SMSSender interface {
	Send(ctx context.Context, to, message string) error
}

// Service implements the auth use cases.
type Service struct {
	users    *mongo.Collection
	churches *mongo.Collection
	tokens   *token.Issuer
	otp      *otpStore
	sms      SMSSender
}

// NewService builds the auth service.
//
// Users are reached through Global() rather than Tenant(): authentication
// necessarily happens before a tenant is known, so this is one of the few
// legitimate cross-tenant collections (see mongodb.Global).
func NewService(db *mongodb.DB, issuer *token.Issuer, rdb *redis.Client, sms SMSSender) *Service {
	return &Service{
		users:    db.Global(Collection),
		churches: db.Global("churches"),
		tokens:   issuer,
		otp:      &otpStore{redis: rdb},
		sms:      sms,
	}
}

// EnsureIndexes creates the uniqueness the auth flows depend on.
//
// It creates ONLY the compound pair. The global `email_unique` / `phone_unique`
// that this used to create are deliberately absent, and their absence is what
// makes the migration stick: recreating them here would have this run at every
// boot and quietly undo DropGlobalUniqueness — which is exactly what happened
// the first time, because DropGlobalUniqueness calls this to guarantee the
// replacements exist before removing anything.
//
// Adding the compound indexes is safe at any time; they are additive. Removing
// the global pair is a separate, deliberate operation, because dropping a
// unique index before both writers scope their lookups leaves a window in which
// two churches register the same address — after which the compound build fails
// and the fix is manual data surgery (R-10). See DropGlobalUniqueness and the
// preflight it refuses to run without.
func (s *Service) EnsureIndexes(ctx context.Context) error {
	err := mongodb.EnsureIndexes(ctx, s.users, []mongo.IndexModel{
		{
			// ADR-006: identity is scoped to a workspace. One address may hold
			// an account in each of two churches and never two in one.
			//
			// A PARTIAL filter, not sparse. A compound sparse index skips a
			// document only when EVERY indexed field is missing, so every
			// email-less account would index as {church, null} and collide with
			// the others — the same trap as the invitations index, and the same
			// one that made "phone": "" reject the second phone-less account.
			Keys: bson.D{
				{Key: "churchId", Value: 1},
				{Key: "email", Value: 1},
			},
			Options: options.Index().SetName("uq_church_email").SetUnique(true).
				SetPartialFilterExpression(bson.M{"email": bson.M{"$exists": true}}),
		},
		{
			Keys: bson.D{
				{Key: "churchId", Value: 1},
				{Key: "phone", Value: 1},
			},
			Options: options.Index().SetName("uq_church_phone").SetUnique(true).
				SetPartialFilterExpression(bson.M{"phone": bson.M{"$exists": true}}),
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

type RegisterRequest struct {
	ChurchID string
	Email    string
	Phone    string
	Name     string
	Password string
}

// Register creates an inactive-session member account inside an existing,
// active church. It intentionally returns no tokens: control of the supplied
// phone is proved only by VerifyOTP, which is the first point a session may be
// issued for a newly self-registered member.
func (s *Service) Register(ctx context.Context, req RegisterRequest) (*User, error) {
	name := strings.TrimSpace(req.Name)
	email := normalizeEmail(req.Email)
	if len(name) < 2 || len(name) > 120 || len(req.Password) < 8 || len(req.Password) > 72 {
		return nil, ErrRegistrationInvalid
	}
	parsedEmail, err := mail.ParseAddress(email)
	if err != nil || parsedEmail.Address != email {
		return nil, ErrRegistrationInvalid
	}
	phoneNumber, err := normalizeOTPPhone(req.Phone)
	if err != nil {
		return nil, err
	}
	churchID, err := bson.ObjectIDFromHex(strings.TrimSpace(req.ChurchID))
	if err != nil {
		return nil, ErrChurchUnavailable
	}
	var church struct {
		IsActive bool `bson:"isActive"`
		// A POINTER, because absent and false are different answers. Q-10
		// makes self-signup allowed by DEFAULT, so a church that predates the
		// setting — every church today — must read as open rather than closed.
		// A plain bool would close registration for all of them at once.
		SelfSignupEnabled *bool `bson:"selfSignupEnabled"`
	}
	if err := s.churches.FindOne(ctx, bson.M{"_id": churchID, "isActive": true}).Decode(&church); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, ErrChurchUnavailable
		}
		return nil, fmt.Errorf("auth: lookup registration church: %w", err)
	}
	// The kill switch (R-17). Self-signup is open by default, but a church
	// being targeted — or one that simply wants an invitation-only workspace —
	// can close it, and then this is the only door.
	if church.SelfSignupEnabled != nil && !*church.SelfSignupEnabled {
		return nil, ErrSelfSignupClosed
	}

	// Scoped to the church being joined (WP-35). A global check here is what
	// made one address one account across the whole platform; a person who
	// attends two churches must be able to hold an account in each.
	//
	// Both storage forms, because Mongoose writes churchId as an ObjectId and
	// early Go documents wrote it as a string (ADR-005) — matching only one
	// silently misses half the church's existing accounts and lets a duplicate
	// through.
	churchScope := bson.M{"$in": bson.A{churchID, churchID.Hex()}}
	if err := s.users.FindOne(ctx, bson.M{
		"churchId": churchScope,
		"$or": bson.A{
			bson.M{"email": email}, bson.M{"phone": phoneNumber},
		},
	}).Err(); err == nil {
		return nil, ErrAccountExists
	} else if !errors.Is(err, mongo.ErrNoDocuments) {
		return nil, fmt.Errorf("auth: check registration identity: %w", err)
	}

	passwordHash, err := HashPassword(req.Password)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	user := &User{
		ChurchID:                  mongodb.ID(churchID.Hex()),
		Email:                     email,
		Phone:                     phoneNumber,
		Name:                      name,
		Role:                      "MEMBER",
		PasswordHash:              passwordHash,
		IsActive:                  true,
		PhoneVerified:             false,
		PhoneVerificationRequired: true,
		SelfRegistered:            true,
		CreatedAt:                 now,
		UpdatedAt:                 now,
	}
	result, err := s.users.InsertOne(ctx, user)
	if mongo.IsDuplicateKeyError(err) {
		return nil, ErrAccountExists
	}
	if err != nil {
		return nil, fmt.Errorf("auth: create account: %w", err)
	}
	user.ID = result.InsertedID.(bson.ObjectID)
	return user, nil
}

// --- password login ---

// LoginWithPassword authenticates into a WORKSPACE (WP-35).
//
// The workspace is the church slug. An empty one falls back to a global lookup
// that only succeeds when exactly one account holds the address — see
// findOneCredential for why that fallback is safe and temporary.
//
// Every failure below costs the same and says the same thing. A wrong password,
// an address in no church, an address in a DIFFERENT church, an unknown
// workspace and an ambiguous one are indistinguishable to the caller, in both
// the message and the time taken. Distinguishing any of them turns the sign-in
// form into a directory of which churches are on the platform and who belongs
// to them — which for a congregation is a membership-disclosure risk, not a
// privacy nicety.
func (s *Service) LoginWithPassword(ctx context.Context, workspace, email, password string) (*Result, error) {
	churchID := ""
	if normalizeWorkspace(workspace) != "" {
		resolved, err := s.resolveWorkspace(ctx, workspace)
		if err != nil {
			if !errors.Is(err, ErrWorkspaceUnknown) {
				return nil, err
			}
			// Unknown workspace. Pay the bcrypt cost anyway: returning early
			// here makes response latency say "no such church", which is the
			// enumeration this whole path is written to avoid.
			_, _ = bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
			return nil, ErrInvalidCredentials
		}
		churchID = resolved
	}

	user, err := s.findOneCredential(ctx, "email", normalizeEmail(email), churchID)
	if err != nil {
		if errors.Is(err, ErrInvalidCredentials) {
			// Hash anyway so a missing account and a wrong password take the
			// same time. Skipping this makes response latency an account oracle.
			_, _ = bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
		}
		return nil, err
	}

	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) != nil {
		return nil, ErrInvalidCredentials
	}
	if !user.IsActive {
		return nil, ErrAccountDeactivated
	}
	if user.PhoneVerificationRequired && !user.PhoneVerified {
		return nil, ErrPhoneVerificationRequired
	}

	return s.issueFor(ctx, user)
}

// --- OTP login ---

// RequestOTP sends a login code to a phone number in a workspace.
//
// It returns success even when the number is unknown: a differing response
// would let anyone test which numbers belong to church members, which for a
// religious congregation is a membership-disclosure risk, not just a privacy
// nicety. The same silence covers an unknown workspace and a number that
// belongs to a different church.
func (s *Service) RequestOTP(ctx context.Context, workspace, phone string) error {
	phone, err := normalizeOTPPhone(phone)
	if err != nil {
		return err
	}

	churchID, err := s.workspaceForOTP(ctx, workspace)
	if err != nil {
		return nil // Unknown workspace, indistinguishable from an unknown number.
	}

	user, err := s.findOneCredential(ctx, "phone", phone, churchID)
	if err != nil {
		if errors.Is(err, ErrInvalidCredentials) {
			return nil // Silent no-op; see doc comment.
		}
		return err
	}
	if !user.IsActive {
		return nil // Same shape as unknown, for the same reason.
	}

	// Keyed by the account's church as well as the number. Without this, one
	// person with accounts in two churches has ONE outstanding code, and a code
	// requested for church A verifies a sign-in to church B — the workspace
	// separation undone in the one place it is least visible.
	code, err := s.otp.issue(ctx, user.ChurchID.String(), phone)
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
func (s *Service) VerifyOTP(ctx context.Context, workspace, phone, code string) (*Result, error) {
	phone, err := normalizeOTPPhone(phone)
	if err != nil {
		return nil, err
	}

	churchID, err := s.workspaceForOTP(ctx, workspace)
	if err != nil {
		return nil, ErrInvalidCredentials
	}

	// The user is resolved BEFORE the code is checked, because the code is
	// keyed by their church — there is no way to look up the right code
	// without knowing which account is being verified.
	user, err := s.findOneCredential(ctx, "phone", phone, churchID)
	if err != nil {
		return nil, err
	}

	if err := s.otp.verify(ctx, user.ChurchID.String(), phone, code); err != nil {
		return nil, err
	}
	if !user.IsActive {
		return nil, ErrAccountDeactivated
	}

	// A verified code proves control of the number.
	if !user.PhoneVerified {
		_, _ = s.users.UpdateOne(ctx,
			bson.M{"_id": user.ID},
			bson.M{"$set": bson.M{
				"phoneVerified":             true,
				"phoneVerificationRequired": false,
				"updatedAt":                 time.Now().UTC(),
			}},
		)
		user.PhoneVerified = true
		user.PhoneVerificationRequired = false
	}

	return s.issueFor(ctx, user)
}

// workspaceForOTP resolves an optional workspace for the OTP flows.
//
// An empty workspace is allowed and means "look globally", matching the
// password path's migration fallback. A NAMED workspace that does not exist is
// an error the callers turn into their usual silence.
func (s *Service) workspaceForOTP(ctx context.Context, workspace string) (string, error) {
	if normalizeWorkspace(workspace) == "" {
		return "", nil
	}
	return s.resolveWorkspace(ctx, workspace)
}

func normalizeOTPPhone(raw string) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return "", ErrPhoneRequired
	}
	normalized, err := phone.Normalize(raw, "GH")
	if err != nil {
		return "", ErrPhoneInvalid
	}
	return normalized, nil
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
	user, err := s.byIDString(ctx, claims.UserID)
	if err != nil {
		return nil, err
	}
	if !user.IsActive {
		return nil, ErrAccountDeactivated
	}
	return user, nil
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
