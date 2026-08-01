package invitation

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/domain/auth"
	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/phone"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

var (
	// ErrPasswordWeak means the supplied password is too short or too long.
	// bcrypt silently truncates past 72 bytes, so a longer one is refused
	// rather than accepted-and-shortened.
	ErrPasswordWeak = errors.New("invitation: a password must be between 8 and 72 characters")
	// ErrNameRequired means no name was given for the person being added.
	ErrNameRequired = errors.New("invitation: a name is required")
	// ErrEmailInvalid means the email address will not parse.
	ErrEmailInvalid = errors.New("invitation: that email address is not valid")
	// ErrPhoneInvalid means the phone number cannot be normalised.
	ErrPhoneInvalid = errors.New("invitation: that phone number is not valid")
)

// Service issues, revokes and redeems invitations.
type Service struct {
	// invites is tenant-scoped, for everything an admin does.
	invites *mongodb.TenantCollection
	// byToken is the same collection UNSCOPED, used only for the redemption
	// path. Accepting an invitation necessarily happens before any tenant
	// context exists — the caller is not signed in and by definition does not
	// yet belong to the church. The lookup is by a 32-byte secret, and the
	// church is then read FROM the stored invitation, so possession of the
	// token is the whole authorisation and nothing the caller sends chooses
	// the church.
	byToken  *mongo.Collection
	users    *mongo.Collection
	churches *mongo.Collection
	roles    *rbac.Service
	now      func() time.Time
}

// NewService builds the invitation service.
func NewService(db *mongodb.DB) *Service {
	return &Service{
		invites:  db.Tenant(Collection),
		byToken:  db.Global(Collection),
		users:    db.Global(auth.Collection),
		churches: db.Global("churches"),
		roles:    rbac.NewService(db),
		now:      time.Now,
	}
}

// EnsureIndexes creates the constraints invitations depend on.
func (s *Service) EnsureIndexes(ctx context.Context) error {
	err := mongodb.EnsureIndexes(ctx, s.byToken, []mongo.IndexModel{
		{
			// The redemption lookup, and unique because a token collision
			// would be a second door into someone else's church.
			Keys:    bson.D{{Key: "tokenHash", Value: 1}},
			Options: options.Index().SetName("uq_invitation_token").SetUnique(true),
		},
		{
			// One live invitation per email per church. A partial filter, not
			// a sparse index: a compound sparse index only skips a document
			// when EVERY indexed field is missing, so phone-only invitations
			// would all index as {churchId, null} and collide with each other.
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "email", Value: 1},
			},
			Options: options.Index().SetName("uq_pending_invitation_email").
				SetUnique(true).
				SetPartialFilterExpression(bson.M{
					"status": string(StatusPending),
					"email":  bson.M{"$exists": true},
				}),
		},
		{
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "phone", Value: 1},
			},
			Options: options.Index().SetName("uq_pending_invitation_phone").
				SetUnique(true).
				SetPartialFilterExpression(bson.M{
					"status": string(StatusPending),
					"phone":  bson.M{"$exists": true},
				}),
		},
		{
			// The admin's list view: this church's invitations, newest first.
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "status", Value: 1},
				{Key: "invitedAt", Value: -1},
			},
			Options: options.Index().SetName("church_invitation_status"),
		},
	})
	if err != nil {
		return fmt.Errorf("invitation: create indexes: %w", err)
	}
	return nil
}

// --- issuing ---------------------------------------------------------------

// InviteInput is what an admin supplies to invite someone.
type InviteInput struct {
	Email   string
	Phone   string
	Name    string
	RoleID  string
	Message string
}

// Invite creates a pending invitation and returns the raw token ONCE.
//
// The raw token is returned rather than stored, so the only copy that survives
// this call is the one in the link that gets sent. The caller builds that link
// — the domain has no business knowing what a URL looks like.
//
// callerHolds is the inviting admin's own permissions. Inviting someone into a
// role you could not create is escalation by proxy: without this check, an
// admin with only user:create can invite an accomplice into the Admin role and
// then be handed back whatever they wanted.
func (s *Service) Invite(ctx context.Context, in InviteInput, callerHolds rbac.Set) (*Invitation, string, error) {
	email, phoneNumber, err := normaliseContact(in.Email, in.Phone)
	if err != nil {
		return nil, "", err
	}

	role, err := s.roleForInvite(ctx, in.RoleID, callerHolds)
	if err != nil {
		return nil, "", err
	}
	if err := s.refuseExistingUser(ctx, email, phoneNumber); err != nil {
		return nil, "", err
	}

	scope, err := tenancy.FromContext(ctx)
	if err != nil {
		return nil, "", err
	}

	raw, hashed, err := newToken()
	if err != nil {
		return nil, "", err
	}

	now := s.now().UTC()
	doc := bson.M{
		"name":      strings.TrimSpace(in.Name),
		"roleId":    role.ID.Hex(),
		"roleName":  role.Name,
		"tokenHash": hashed,
		"status":    string(StatusPending),
		"invitedBy": mongodb.ID(scope.UserID),
		"invitedAt": now,
		"expiresAt": now.Add(Lifetime),
		"message":   strings.TrimSpace(in.Message),
	}
	// Omitted rather than written empty, because the partial unique index keys
	// on existence: an empty string would make every phone-only invitation
	// collide on email "".
	if email != "" {
		doc["email"] = email
	}
	if phoneNumber != "" {
		doc["phone"] = phoneNumber
	}

	res, err := s.invites.InsertOne(ctx, doc)
	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			// Someone already has a live invitation. Resend rather than issue a
			// second one, so an admin clicking twice does not leave two working
			// links to the same church.
			return nil, "", ErrAlreadyInvited
		}
		return nil, "", fmt.Errorf("invitation: create: %w", err)
	}

	inv, err := s.byID(ctx, res.InsertedID.(bson.ObjectID))
	if err != nil {
		return nil, "", err
	}
	return inv, raw, nil
}

// ErrAlreadyInvited means a live invitation already exists for that person.
var ErrAlreadyInvited = errors.New("invitation: that person already has a pending invitation")

// Resend issues a NEW token for an existing invitation and extends it.
//
// The old token stops working, which is the point: "resend" after a link was
// forwarded to the wrong person has to invalidate what was forwarded, or it is
// not a resend, it is a second door.
func (s *Service) Resend(ctx context.Context, id string) (*Invitation, string, error) {
	inv, err := s.ByID(ctx, id)
	if err != nil {
		return nil, "", err
	}
	if inv.Status != StatusPending {
		// Accepted or revoked. Reviving either by resending would turn "revoke"
		// into a suggestion.
		return nil, "", ErrNotFound
	}

	raw, hashed, err := newToken()
	if err != nil {
		return nil, "", err
	}

	now := s.now().UTC()
	_, err = s.invites.UpdateOne(ctx, bson.M{"_id": inv.ID}, bson.M{
		"$set": bson.M{
			"tokenHash": hashed,
			"expiresAt": now.Add(Lifetime),
			"invitedAt": now,
		},
	})
	if err != nil {
		return nil, "", fmt.Errorf("invitation: resend: %w", err)
	}

	inv.TokenHash = hashed
	inv.ExpiresAt = now.Add(Lifetime)
	inv.InvitedAt = now
	return inv, raw, nil
}

// Revoke cancels a pending invitation.
//
// The token hash is cleared as well as the status changed. Status alone would
// be enough for the code as written, but a cleared hash means a leaked link is
// dead even against a future code path that forgets to check status.
func (s *Service) Revoke(ctx context.Context, id string) error {
	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return ErrNotFound
	}

	res, err := s.invites.UpdateOne(ctx,
		bson.M{"_id": oid, "status": string(StatusPending)},
		bson.M{"$set": bson.M{
			"status":    string(StatusRevoked),
			"revokedAt": s.now().UTC(),
			"tokenHash": "revoked:" + oid.Hex(),
		}})
	if err != nil {
		return fmt.Errorf("invitation: revoke: %w", err)
	}
	if res.MatchedCount == 0 {
		return ErrNotFound
	}
	return nil
}

// --- listing ---------------------------------------------------------------

// List returns this church's invitations, newest first.
func (s *Service) List(ctx context.Context, status Status) ([]Invitation, error) {
	filter := bson.M{}
	if status != "" {
		filter["status"] = string(status)
	}

	var out []Invitation
	err := s.invites.Find(ctx, filter, &out,
		options.Find().SetSort(bson.D{{Key: "invitedAt", Value: -1}}).SetLimit(500))
	if err != nil {
		return nil, fmt.Errorf("invitation: list: %w", err)
	}
	return out, nil
}

// ByID returns one invitation within the caller's church.
func (s *Service) ByID(ctx context.Context, id string) (*Invitation, error) {
	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return nil, ErrNotFound
	}
	return s.byID(ctx, oid)
}

func (s *Service) byID(ctx context.Context, oid bson.ObjectID) (*Invitation, error) {
	var inv Invitation
	err := s.invites.FindOne(ctx, bson.M{"_id": oid}, &inv)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("invitation: read: %w", err)
	}
	return &inv, nil
}

// --- redemption ------------------------------------------------------------

// Preview is what an invitee sees before accepting.
//
// Deliberately thin. It names the church and the role so the page is not a bare
// password form from an unnamed system — but it does not reveal who else is in
// the church, and it is reachable by anyone holding the token, so everything on
// it is something the invitee was already being told.
type Preview struct {
	ChurchID   string    `json:"churchId"`
	ChurchName string    `json:"churchName"`
	Name       string    `json:"name,omitempty"`
	Email      string    `json:"email,omitempty"`
	Phone      string    `json:"phone,omitempty"`
	RoleName   string    `json:"roleName,omitempty"`
	InvitedBy  string    `json:"invitedByName,omitempty"`
	Message    string    `json:"message,omitempty"`
	ExpiresAt  time.Time `json:"expiresAt"`
}

// Preview resolves an invitation token for the acceptance page.
func (s *Service) Preview(ctx context.Context, rawToken string) (*Preview, error) {
	inv, err := s.live(ctx, rawToken)
	if err != nil {
		return nil, err
	}

	out := &Preview{
		ChurchID:  inv.ChurchID.String(),
		Name:      inv.Name,
		Email:     inv.Email,
		Phone:     inv.Phone,
		RoleName:  inv.RoleName,
		Message:   inv.Message,
		ExpiresAt: inv.ExpiresAt,
	}

	if oid, err := inv.ChurchID.ObjectID(); err == nil {
		var church struct {
			Name string `bson:"name"`
		}
		if err := s.churches.FindOne(ctx, bson.M{"_id": oid}).Decode(&church); err == nil {
			out.ChurchName = church.Name
		}
	}
	if oid, err := inv.InvitedBy.ObjectID(); err == nil {
		var inviter struct {
			Name string `bson:"name"`
		}
		if err := s.users.FindOne(ctx, bson.M{"_id": oid}).Decode(&inviter); err == nil {
			out.InvitedBy = inviter.Name
		}
	}
	return out, nil
}

// AcceptInput is what an invitee supplies.
type AcceptInput struct {
	Name     string
	Phone    string
	Password string
}

// Accept redeems an invitation and creates the account.
//
// Single-use is enforced by claiming the invitation FIRST — a conditional
// update from pending, which only one of two concurrent requests can win — and
// creating the account after. The other order (create, then mark accepted)
// creates two accounts under a race and then has to delete one.
//
// The church is taken from the stored invitation and never from the request.
func (s *Service) Accept(ctx context.Context, rawToken string, in AcceptInput) (*auth.User, error) {
	inv, err := s.live(ctx, rawToken)
	if err != nil {
		return nil, err
	}

	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = inv.Name
	}
	if len(name) < 2 || len(name) > 120 {
		return nil, ErrNameRequired
	}
	if len(in.Password) < 8 || len(in.Password) > 72 {
		return nil, ErrPasswordWeak
	}

	phoneNumber := inv.Phone
	if raw := strings.TrimSpace(in.Phone); raw != "" {
		phoneNumber, err = phone.Normalize(raw, "GH")
		if err != nil {
			return nil, ErrPhoneInvalid
		}
	}
	if err := s.refuseExistingUser(ctx, inv.Email, phoneNumber); err != nil {
		return nil, err
	}

	passwordHash, err := auth.HashPassword(in.Password)
	if err != nil {
		return nil, err
	}

	now := s.now().UTC()

	// Claim it. Conditional on status so a second concurrent redemption of the
	// same link matches nothing and is told the invitation is spent.
	claim, err := s.byToken.UpdateOne(ctx,
		bson.M{"_id": inv.ID, "status": string(StatusPending)},
		bson.M{"$set": bson.M{"status": string(StatusAccepted), "acceptedAt": now}})
	if err != nil {
		return nil, fmt.Errorf("invitation: claim: %w", err)
	}
	if claim.MatchedCount == 0 {
		return nil, ErrNotFound
	}

	user, err := s.createUser(ctx, inv, name, phoneNumber, passwordHash, now)
	if err != nil {
		// Release the claim. Without this a failed account creation burns the
		// invitation and the person has to be invited again by an admin who
		// does not know why their link stopped working.
		_, releaseErr := s.byToken.UpdateOne(ctx,
			bson.M{"_id": inv.ID, "status": string(StatusAccepted)},
			bson.M{"$set": bson.M{"status": string(StatusPending)},
				"$unset": bson.M{"acceptedAt": ""}})
		if releaseErr != nil {
			return nil, fmt.Errorf("%w (and the invitation could not be released: %v)", err, releaseErr)
		}
		return nil, err
	}

	_, _ = s.byToken.UpdateOne(ctx, bson.M{"_id": inv.ID},
		bson.M{"$set": bson.M{"acceptedUserId": mongodb.ID(user.ID.Hex())}})

	return user, nil
}

// createUser writes the account an accepted invitation produces.
func (s *Service) createUser(
	ctx context.Context,
	inv *Invitation,
	name, phoneNumber, passwordHash string,
	now time.Time,
) (*auth.User, error) {
	role, err := s.roleByIDInChurch(ctx, inv.ChurchID.String(), inv.RoleID)
	if err != nil {
		return nil, err
	}

	// Arriving through the invitation link proves control of whichever address
	// it was sent to. An emailed invitation therefore does NOT prove control of
	// the phone number — but it does mean this account was vouched for, so the
	// phone-verification gate that exists to stop anonymous self-registration
	// does not apply. An SMS invitation proves the number outright.
	phoneVerified := inv.Phone != "" && phoneNumber == inv.Phone

	doc := bson.M{
		"churchId":      inv.ChurchID,
		"name":          name,
		"passwordHash":  passwordHash,
		"isActive":      true,
		"phoneVerified": phoneVerified,
		// The legacy enum, so a request proxied to the TypeScript API — which
		// has never heard of roleId — still authorises correctly.
		"role":       rbac.LegacyRoleFor(role.Slug),
		"roleId":     role.ID.Hex(),
		"roleSlug":   role.Slug,
		"invitedBy":  inv.InvitedBy,
		"acceptedAt": now,
		"createdAt":  now,
		"updatedAt":  now,
	}
	// OMITTED when empty, never written as "". The users collection carries
	// SPARSE unique indexes on email and phone, and sparse skips a document only
	// when the field is ABSENT — an empty string is a value like any other, so
	// writing "" makes every phone-less account collide with the first one.
	//
	// This is the same trap as the compound-sparse index on invitations, one
	// layer down, and it was got right there and wrong here. It does not show up
	// on the first invitation, only the second: a fresh test database never
	// holds two accounts that both lack a phone number.
	setIfPresent(doc, "email", inv.Email)
	setIfPresent(doc, "phone", phoneNumber)

	res, err := s.users.InsertOne(ctx, doc)
	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			return nil, ErrAlreadyMember
		}
		return nil, fmt.Errorf("invitation: create account: %w", err)
	}

	var user auth.User
	if err := s.users.FindOne(ctx, bson.M{"_id": res.InsertedID}).Decode(&user); err != nil {
		return nil, fmt.Errorf("invitation: read new account: %w", err)
	}
	return &user, nil
}

// live resolves a token to an invitation that can still be accepted.
//
// Every failure returns the same ErrNotFound: expired, revoked, already used
// and never-existed are indistinguishable to the caller, so the endpoint cannot
// be used to learn which invitations were issued.
func (s *Service) live(ctx context.Context, rawToken string) (*Invitation, error) {
	token := strings.TrimSpace(rawToken)
	if token == "" {
		return nil, ErrNotFound
	}

	var inv Invitation
	err := s.byToken.FindOne(ctx, bson.M{"tokenHash": hashToken(token)}).Decode(&inv)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("invitation: resolve token: %w", err)
	}
	if !tokensMatch(inv.TokenHash, hashToken(token)) {
		return nil, ErrNotFound
	}
	if !inv.Live(s.now()) {
		return nil, ErrNotFound
	}
	return &inv, nil
}

// --- direct creation -------------------------------------------------------

// CreateInput adds a user directly, with a password the admin sets.
type CreateInput struct {
	Email    string
	Phone    string
	Name     string
	RoleID   string
	Password string
}

// Create adds a user without an invitation round trip.
//
// Requirement 9's other half — "with other information like password where
// necessary". It exists for the case invitations cannot serve: a church
// secretary sitting with someone who has no email address and a phone that
// receives SMS unreliably, entering them at the desk.
//
// The account is flagged to require a password change at first login. An admin
// who sets someone's password knows a working credential for that account, and
// on a platform holding giving records that is worth closing immediately rather
// than trusting to be changed later.
func (s *Service) Create(ctx context.Context, in CreateInput, callerHolds rbac.Set) (*auth.User, error) {
	email, phoneNumber, err := normaliseContact(in.Email, in.Phone)
	if err != nil {
		return nil, err
	}
	name := strings.TrimSpace(in.Name)
	if len(name) < 2 || len(name) > 120 {
		return nil, ErrNameRequired
	}
	if len(in.Password) < 8 || len(in.Password) > 72 {
		return nil, ErrPasswordWeak
	}

	role, err := s.roleForInvite(ctx, in.RoleID, callerHolds)
	if err != nil {
		return nil, err
	}
	if err := s.refuseExistingUser(ctx, email, phoneNumber); err != nil {
		return nil, err
	}

	scope, err := tenancy.FromContext(ctx)
	if err != nil {
		return nil, err
	}
	passwordHash, err := auth.HashPassword(in.Password)
	if err != nil {
		return nil, err
	}

	now := s.now().UTC()
	doc := bson.M{
		"churchId":           mongodb.ID(scope.ChurchID),
		"name":               name,
		"passwordHash":       passwordHash,
		"isActive":           true,
		"phoneVerified":      false,
		"mustChangePassword": true,
		"role":               rbac.LegacyRoleFor(role.Slug),
		"roleId":             role.ID.Hex(),
		"roleSlug":           role.Slug,
		"createdBy":          mongodb.ID(scope.UserID),
		"createdAt":          now,
		"updatedAt":          now,
	}
	// Omitted when empty — see createUser for why "" is not the same as absent
	// under a sparse unique index.
	setIfPresent(doc, "email", email)
	setIfPresent(doc, "phone", phoneNumber)

	res, err := s.users.InsertOne(ctx, doc)
	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			return nil, ErrAlreadyMember
		}
		return nil, fmt.Errorf("invitation: create user: %w", err)
	}

	var user auth.User
	if err := s.users.FindOne(ctx, bson.M{"_id": res.InsertedID}).Decode(&user); err != nil {
		return nil, fmt.Errorf("invitation: read new user: %w", err)
	}
	return &user, nil
}

// --- shared checks ---------------------------------------------------------

// roleForInvite resolves the role and refuses an escalation.
func (s *Service) roleForInvite(ctx context.Context, roleID string, callerHolds rbac.Set) (*rbac.Role, error) {
	if strings.TrimSpace(roleID) == "" {
		return nil, ErrRoleRequired
	}

	// RoleByID is tenant-scoped, so a role id belonging to another church
	// resolves to nothing rather than to that church's role.
	role, err := s.roles.RoleByID(ctx, roleID)
	if err != nil {
		return nil, err
	}

	// Inviting into a role is granting its permissions (requirement 4). An
	// admin who could not create that role must not be able to hand it out.
	if err := rbac.RefuseEscalation(role.PermissionSet(), callerHolds); err != nil {
		return nil, err
	}
	return role, nil
}

// roleByIDInChurch resolves a role during redemption, when there is no tenant
// in context because the caller is not signed in yet. The church comes from the
// invitation, never from the request.
func (s *Service) roleByIDInChurch(ctx context.Context, churchID, roleID string) (*rbac.Role, error) {
	scoped := tenancy.WithScope(ctx, tenancy.Scope{ChurchID: churchID})
	return s.roles.RoleByID(scoped, roleID)
}

// refuseExistingUser stops an invitation landing on an address that already has
// an account.
//
// Until WP-35 makes identity workspace-scoped, email and phone are globally
// unique across every church, so this also catches someone who belongs to a
// DIFFERENT church. That is the correct answer today — the insert would fail on
// the unique index regardless — and this turns a duplicate-key error into a
// sentence an admin can act on.
func (s *Service) refuseExistingUser(ctx context.Context, email, phoneNumber string) error {
	var or bson.A
	if email != "" {
		or = append(or, bson.M{"email": email})
	}
	if phoneNumber != "" {
		or = append(or, bson.M{"phone": phoneNumber})
	}
	if len(or) == 0 {
		return ErrContactRequired
	}

	err := s.users.FindOne(ctx, bson.M{"$or": or}).Err()
	if err == nil {
		return ErrAlreadyMember
	}
	if !errors.Is(err, mongo.ErrNoDocuments) {
		return fmt.Errorf("invitation: check existing account: %w", err)
	}
	return nil
}

// setIfPresent writes a field only when it has a value.
//
// The distinction between an absent field and an empty string is invisible in
// Go and decisive in MongoDB: a SPARSE unique index skips documents where the
// field is missing, and treats "" as an ordinary value that only one document
// may hold. Writing "" therefore turns "this column is optional" into "exactly
// one row may leave it blank".
func setIfPresent(doc bson.M, field, value string) {
	if value != "" {
		doc[field] = value
	}
}

// normaliseContact validates and canonicalises the two ways to reach someone.
func normaliseContact(rawEmail, rawPhone string) (email, phoneNumber string, err error) {
	email = strings.ToLower(strings.TrimSpace(rawEmail))
	if email != "" {
		parsed, parseErr := mail.ParseAddress(email)
		if parseErr != nil || parsed.Address != email {
			return "", "", ErrEmailInvalid
		}
	}

	if raw := strings.TrimSpace(rawPhone); raw != "" {
		// Normalised to E.164 for the same reason member import does it: a
		// number written 024 555 0101 by one secretary and +233245550101 by
		// another must be one person, not two.
		phoneNumber, err = phone.Normalize(raw, "GH")
		if err != nil {
			return "", "", ErrPhoneInvalid
		}
	}

	if email == "" && phoneNumber == "" {
		return "", "", ErrContactRequired
	}
	return email, phoneNumber, nil
}
