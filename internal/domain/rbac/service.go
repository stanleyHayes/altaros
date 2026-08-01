package rbac

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// Service manages roles and the permissions users hold.
type Service struct {
	roles *mongodb.TenantCollection
	users *mongodb.TenantCollection
	now   func() time.Time
}

// NewService builds the RBAC service.
func NewService(db *mongodb.DB) *Service {
	return &Service{
		roles: db.Tenant(RoleCollection),
		users: db.Tenant(UserCollection),
		now:   time.Now,
	}
}

// EnsureIndexes creates the constraints roles depend on.
func (s *Service) EnsureIndexes(ctx context.Context) error {
	err := s.roles.EnsureIndexes(ctx, []mongo.IndexModel{
		{
			// One role slug per church. Two churches may both have "Ushers";
			// one church may not have two.
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "slug", Value: 1},
			},
			Options: options.Index().SetName("uq_church_role_slug").SetUnique(true),
		},
		{
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "name", Value: 1},
			},
			Options: options.Index().SetName("church_role_name"),
		},
	})
	if err != nil {
		return fmt.Errorf("rbac: create role indexes: %w", err)
	}
	return nil
}

// EnsureSystemRoles creates the three roles every church starts with.
//
// Idempotent: an existing system role is left alone rather than reset, because
// a church that has deliberately widened its Staff role should not have that
// undone by a deploy.
func (s *Service) EnsureSystemRoles(ctx context.Context) error {
	now := s.now().UTC()

	for _, sr := range systemRoles() {
		var existing Role
		err := s.roles.FindOne(ctx, bson.M{"slug": sr.slug}, &existing)
		if err == nil {
			continue
		}
		if !errors.Is(err, mongo.ErrNoDocuments) {
			return fmt.Errorf("rbac: look up system role %s: %w", sr.slug, err)
		}

		_, err = s.roles.InsertOne(ctx, bson.M{
			"name":        sr.name,
			"slug":        sr.slug,
			"description": sr.description,
			"permissions": sr.permissions.Strings(),
			"system":      true,
			"version":     int64(1),
			"createdAt":   now,
			"updatedAt":   now,
		})
		if err != nil && !mongo.IsDuplicateKeyError(err) {
			return fmt.Errorf("rbac: create system role %s: %w", sr.slug, err)
		}
	}
	return nil
}

// --- roles -----------------------------------------------------------------

// RoleInput is what is needed to create or update a role.
type RoleInput struct {
	Name        string
	Description string
	Permissions Set
}

// CreateRole adds a role. Requirement 1: an admin with `role:create` may do
// this; the permission check lives in the HTTP layer, and the escalation check
// lives here because only this layer knows what the caller holds.
func (s *Service) CreateRole(ctx context.Context, in RoleInput, callerHolds Set) (*Role, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return nil, ErrNameRequired
	}

	permissions := Expand(in.Permissions)
	if err := ValidateStrict(permissions); err != nil {
		return nil, err
	}
	if err := s.refuseEscalation(permissions, callerHolds); err != nil {
		return nil, err
	}

	scope, err := tenancy.FromContext(ctx)
	if err != nil {
		return nil, err
	}

	now := s.now().UTC()
	res, err := s.roles.InsertOne(ctx, bson.M{
		"name":        name,
		"slug":        slugify(name),
		"description": strings.TrimSpace(in.Description),
		"permissions": permissions.Strings(),
		"system":      false,
		"version":     int64(1),
		"createdBy":   scope.UserID,
		"createdAt":   now,
		"updatedAt":   now,
	})
	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			return nil, ErrRoleNameTaken
		}
		return nil, fmt.Errorf("rbac: create role: %w", err)
	}
	return s.RoleByID(ctx, res.InsertedID.(bson.ObjectID).Hex())
}

// UpdateRole changes a role's permissions (requirement 8).
//
// The version increments, which is what makes every holder's token stale and
// forces the new permissions to take effect within one refresh — including
// REMOVALS, which is the direction that matters.
func (s *Service) UpdateRole(ctx context.Context, id string, in RoleInput, callerHolds Set) (*Role, error) {
	role, err := s.RoleByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if role.System {
		// A system role can be copied and then edited; editing it in place
		// would let a church remove its own last route back in.
		return nil, ErrSystemRole
	}

	permissions := Expand(in.Permissions)
	if err := ValidateStrict(permissions); err != nil {
		return nil, err
	}
	if err := s.refuseEscalation(permissions, callerHolds); err != nil {
		return nil, err
	}

	set := bson.M{
		"permissions": permissions.Strings(),
		"updatedAt":   s.now().UTC(),
	}
	if name := strings.TrimSpace(in.Name); name != "" {
		set["name"] = name
		set["slug"] = slugify(name)
	}
	if in.Description != "" {
		set["description"] = strings.TrimSpace(in.Description)
	}

	_, err = s.roles.UpdateOne(ctx, bson.M{"_id": role.ID}, bson.M{
		"$set": set,
		"$inc": bson.M{"version": 1},
	})
	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			return nil, ErrRoleNameTaken
		}
		return nil, fmt.Errorf("rbac: update role: %w", err)
	}
	return s.RoleByID(ctx, id)
}

// DeleteRole removes a role that nobody holds.
func (s *Service) DeleteRole(ctx context.Context, id string) error {
	role, err := s.RoleByID(ctx, id)
	if err != nil {
		return err
	}
	if role.System {
		return ErrSystemRole
	}

	// Refuse while it still has holders. Deleting it would leave those users
	// with an unresolvable role and — depending on how that is handled —
	// either no access or, far worse, unchecked access.
	holders, err := s.users.CountDocuments(ctx, bson.M{"roleId": role.ID.Hex()})
	if err != nil {
		return fmt.Errorf("rbac: count role holders: %w", err)
	}
	if holders > 0 {
		return fmt.Errorf("%w: %d user(s) still hold it", ErrRoleInUse, holders)
	}

	if _, err := s.roles.DeleteOne(ctx, bson.M{"_id": role.ID}); err != nil {
		return fmt.Errorf("rbac: delete role: %w", err)
	}
	return nil
}

// RoleByID returns one role within the caller's church.
func (s *Service) RoleByID(ctx context.Context, id string) (*Role, error) {
	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return nil, ErrRoleNotFound
	}
	var role Role
	err = s.roles.FindOne(ctx, bson.M{"_id": oid}, &role)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrRoleNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("rbac: read role: %w", err)
	}
	return &role, nil
}

// RoleBySlug returns a role by its stable identifier.
func (s *Service) RoleBySlug(ctx context.Context, slug string) (*Role, error) {
	var role Role
	err := s.roles.FindOne(ctx, bson.M{"slug": slug}, &role)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrRoleNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("rbac: read role: %w", err)
	}
	return &role, nil
}

// Roles lists the church's roles.
func (s *Service) Roles(ctx context.Context) ([]Role, error) {
	var out []Role
	err := s.roles.Find(ctx, nil, &out,
		options.Find().SetSort(bson.D{{Key: "system", Value: -1}, {Key: "name", Value: 1}}))
	if err != nil {
		return nil, fmt.Errorf("rbac: list roles: %w", err)
	}
	return out, nil
}

// --- assignment ------------------------------------------------------------

// AssignRole gives a user a role (requirement 3).
func (s *Service) AssignRole(ctx context.Context, userID, roleID string) error {
	role, err := s.RoleByID(ctx, roleID)
	if err != nil {
		return err
	}

	uid, err := bson.ObjectIDFromHex(userID)
	if err != nil {
		return ErrUserNotFound
	}

	res, err := s.users.UpdateOne(ctx, bson.M{"_id": uid}, bson.M{
		"$set": bson.M{
			"roleId":   role.ID.Hex(),
			"roleSlug": role.Slug,
		},
	})
	if err != nil {
		return fmt.Errorf("rbac: assign role: %w", err)
	}
	if res.MatchedCount == 0 {
		return ErrUserNotFound
	}
	return nil
}

// SetOverrides alters ONE user's permissions without touching their role
// (requirement 5).
//
// The deltas are stored, never a resolved copy. That is the whole design: the
// role stays live underneath, so requirement 8 keeps working, and these
// adjustments ride on top of whatever it currently says.
func (s *Service) SetOverrides(ctx context.Context, userID string, granted, revoked Set, callerHolds Set) error {
	if err := s.refuseEscalation(granted, callerHolds); err != nil {
		return err
	}

	uid, err := bson.ObjectIDFromHex(userID)
	if err != nil {
		return ErrUserNotFound
	}

	// Expanding the grants keeps requirement 6 true for overrides as well:
	// granting finance:update alone would otherwise produce a user who can
	// write a record they cannot read.
	granted = Expand(granted)

	// A permission that is both granted and revoked is a contradiction the
	// admin did not intend. Grant wins — an admin who ticks a box expects the
	// box to win — so it is removed from the revoke list rather than left to
	// confuse whoever reads the record later.
	for p := range granted {
		revoked.Remove(p)
	}

	res, err := s.users.UpdateOne(ctx, bson.M{"_id": uid}, bson.M{
		"$set": bson.M{
			"permissionOverrides": bson.M{
				"granted": granted.Strings(),
				"revoked": revoked.Strings(),
			},
		},
	})
	if err != nil {
		return fmt.Errorf("rbac: set overrides: %w", err)
	}
	if res.MatchedCount == 0 {
		return ErrUserNotFound
	}
	return nil
}

// ClearOverrides removes a user's individual adjustments, returning them to
// exactly what their role says.
//
// This is the action Q-11 asks for: an admin removing a permission from a role
// needs a way to also remove it from the people who hold it individually,
// otherwise "revoke finance access" silently does not.
func (s *Service) ClearOverrides(ctx context.Context, userID string) error {
	uid, err := bson.ObjectIDFromHex(userID)
	if err != nil {
		return ErrUserNotFound
	}
	res, err := s.users.UpdateOne(ctx, bson.M{"_id": uid},
		bson.M{"$set": bson.M{"permissionOverrides": bson.M{}}})
	if err != nil {
		return fmt.Errorf("rbac: clear overrides: %w", err)
	}
	if res.MatchedCount == 0 {
		return ErrUserNotFound
	}
	return nil
}

// HoldersWithOverrides lists users whose individual permissions differ from
// their role's.
//
// The role editor shows this, because under ADR-008 removing a permission from
// a role does NOT remove it from someone who was granted it individually. An
// admin who is not told that believes a revocation worked when it did not.
func (s *Service) HoldersWithOverrides(ctx context.Context, roleID string) ([]string, error) {
	var users []struct {
		ID bson.ObjectID `bson:"_id"`
	}
	err := s.users.Find(ctx, bson.M{
		"roleId": roleID,
		"$or": bson.A{
			bson.M{"permissionOverrides.granted.0": bson.M{"$exists": true}},
			bson.M{"permissionOverrides.revoked.0": bson.M{"$exists": true}},
		},
	}, &users)
	if err != nil {
		return nil, fmt.Errorf("rbac: find holders with overrides: %w", err)
	}

	out := make([]string, 0, len(users))
	for _, u := range users {
		out = append(out, u.ID.Hex())
	}
	return out, nil
}

// --- effective permissions -------------------------------------------------

// userRecord is the subset of a user this package reads.
type userRecord struct {
	ID       bson.ObjectID `bson:"_id"`
	ChurchID mongodb.ID    `bson:"churchId"`
	RoleID   string        `bson:"roleId"`
	RoleSlug string        `bson:"roleSlug"`
	// Role is the legacy fixed enum, still written by the TypeScript API.
	Role      string    `bson:"role"`
	Overrides Overrides `bson:"permissionOverrides"`
}

// AssignmentFor computes what a user may actually do.
//
// Computed on every call rather than cached on the user, which is what makes
// requirements 5 and 8 both hold: the role is read live, so an edit to it
// reaches every holder, while the user's own deltas sit on top untouched.
func (s *Service) AssignmentFor(ctx context.Context, userID string) (*Assignment, error) {
	uid, err := bson.ObjectIDFromHex(userID)
	if err != nil {
		return nil, ErrUserNotFound
	}

	var user userRecord
	err = s.users.FindOne(ctx, bson.M{"_id": uid}, &user)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("rbac: read user: %w", err)
	}

	role, err := s.roleFor(ctx, user)
	if err != nil {
		return nil, err
	}

	granted, revoked := user.Overrides.Sets()
	effective := Effective(role.PermissionSet(), granted, revoked)

	return &Assignment{
		UserID:    userID,
		ChurchID:  user.ChurchID.String(),
		RoleID:    role.ID.Hex(),
		RoleName:  role.Name,
		Overrides: user.Overrides,
		Effective: effective,
		Version:   versionOf(role, user.Overrides),
	}, nil
}

// roleFor resolves a user's role, falling back to the legacy enum.
//
// The TypeScript API still writes a fixed `role` string (ADR-006 has not landed
// and WP-20 has not retired it), so a user created there has no roleId. Mapping
// the enum onto the equivalent system role is what lets RBAC land without a
// migration and without breaking every account the legacy API creates.
func (s *Service) roleFor(ctx context.Context, user userRecord) (*Role, error) {
	if user.RoleID != "" {
		role, err := s.RoleByID(ctx, user.RoleID)
		if err == nil {
			return role, nil
		}
		if !errors.Is(err, ErrRoleNotFound) {
			return nil, err
		}
		// The role was deleted out from under them. Fall through to the legacy
		// mapping rather than returning an error, so a stale reference costs
		// them their extra permissions rather than their access.
	}

	slug := legacyRoleSlug(user.Role)
	role, err := s.RoleBySlug(ctx, slug)
	if err == nil {
		return role, nil
	}
	if !errors.Is(err, ErrRoleNotFound) {
		return nil, err
	}

	// The church has no system roles. Provision them now, then retry.
	//
	// This is a write on a read path, which is worth justifying rather than
	// hiding. EnsureSystemRoles was originally called from exactly one place —
	// the seeder — so every church that did not come out of `make seed` had no
	// roles at all, `roleFor` fell through to an empty set, and every person in
	// that church INCLUDING ITS ADMINISTRATOR held nothing. Failing closed is
	// right; failing closed for every real customer while passing every test
	// against seeded data is not.
	//
	// A creation hook alone would not fix it. Under ADR-005 the legacy
	// TypeScript API writes the same database and creates churches itself, and
	// it has never heard of roles — so the only place that can be sure a church
	// has them is the point where they are needed. It is idempotent, bounded to
	// three documents once per church, and safe under concurrency because the
	// unique index on (churchId, slug) settles the race.
	if err := s.EnsureSystemRoles(ctx); err != nil {
		return nil, fmt.Errorf("rbac: provision system roles: %w", err)
	}

	role, err = s.RoleBySlug(ctx, slug)
	if err == nil {
		return role, nil
	}
	if !errors.Is(err, ErrRoleNotFound) {
		return nil, err
	}

	// Provisioning ran and the role still is not there. Something is wrong that
	// this layer cannot fix, and an empty role is the safe answer: the user
	// holds nothing, which fails closed rather than granting by default.
	return &Role{Name: "unassigned", Permissions: nil, Version: 0}, nil
}

// legacyRoleSlug maps the fixed enum the TypeScript API writes onto a system
// role slug.
func legacyRoleSlug(role string) string {
	switch strings.ToUpper(strings.TrimSpace(role)) {
	case "SUPER_ADMIN", "ORG_ADMIN", "CHURCH_ADMIN":
		return SystemAdmin
	case "DEPARTMENT_LEADER":
		return SystemStaff
	default:
		return SystemMember
	}
}

// LegacyRoleFor is the inverse: the enum to write on a user Go creates, so a
// request proxied to the TypeScript API — which has never heard of roleId —
// still authorises them correctly.
//
// It lives next to legacyRoleSlug deliberately. The two are a round trip, and
// separating them is how they drift until an account created in Go reads as a
// member on one side and an administrator on the other.
//
// A custom role maps to MEMBER: the legacy API cannot express it, and the safe
// reading of an unrepresentable role is the least privileged one.
func LegacyRoleFor(slug string) string {
	switch slug {
	case SystemAdmin:
		return "CHURCH_ADMIN"
	case SystemStaff:
		return "DEPARTMENT_LEADER"
	default:
		return "MEMBER"
	}
}

// versionOf identifies an exact authorisation state.
//
// Role version plus a hash of the overrides. A token carrying a different
// version is stale, which is how a permission REMOVAL takes effect on the next
// request rather than at token expiry — the direction that matters, since the
// risk is someone keeping access they should have lost.
func versionOf(role *Role, o Overrides) string {
	h := sha256.New()
	fmt.Fprintf(h, "%s|%d|", role.ID.Hex(), role.Version)
	for _, p := range o.Granted {
		fmt.Fprintf(h, "g:%s|", p)
	}
	for _, p := range o.Revoked {
		fmt.Fprintf(h, "r:%s|", p)
	}
	return hex.EncodeToString(h.Sum(nil))[:16]
}

// refuseEscalation stops a caller granting a permission they do not hold.
func (s *Service) refuseEscalation(wanted, callerHolds Set) error {
	return RefuseEscalation(wanted, callerHolds)
}

// EscalationError names what the caller was missing.
//
// Typed rather than a wrapped string because the missing list is the only thing
// that makes this error actionable. "You cannot grant a permission you do not
// hold" tells an admin nothing they can do; "you would need finance:read" tells
// them exactly which role to fix.
type EscalationError struct{ Missing []string }

func (e *EscalationError) Error() string {
	return fmt.Sprintf("%s: %s", ErrEscalation.Error(), strings.Join(e.Missing, ", "))
}

// Unwrap makes errors.Is(err, ErrEscalation) work.
func (e *EscalationError) Unwrap() error { return ErrEscalation }

// RefuseEscalation stops a caller handing out a permission they do not hold.
//
// Without this, anyone with `role:create` can write themselves an
// all-permissions role and become an administrator — which makes `role:create`
// equivalent to full access and the whole model decorative. The same reasoning
// applies to invitations, which is why this is exported: inviting someone into
// a role you could not create is the same escalation with an extra person in
// the middle, and the invited address can be one the inviter controls.
//
// The rule is a strict subset — the standard one, and stricter than it first
// looks. It is NOT "the target role must be weaker than yours": a role holding
// any single permission you lack is refused even when it is otherwise trivial.
// That means someone given user:create and nothing else can invite nobody at
// all, because even the Member role holds reads they do not have.
//
// That is a real constraint rather than a bug, and it is handled by making it
// visible instead of loosening it: Assignable() below answers which roles a
// caller may actually hand out, so the invite form offers only those, and the
// error names the exact permissions missing when one is attempted anyway.
//
// A nil callerHolds skips the check, which is only correct for system
// provisioning. An EMPTY set is not the same thing and refuses everything.
func RefuseEscalation(wanted, callerHolds Set) error {
	if callerHolds == nil {
		return nil
	}
	missing := Missing(wanted, callerHolds)
	if len(missing) == 0 {
		return nil
	}
	return &EscalationError{Missing: missing}
}

// Missing lists what `wanted` holds that `callerHolds` does not.
func Missing(wanted, callerHolds Set) []string {
	missing := make([]string, 0, len(wanted))
	for p := range wanted {
		if !callerHolds.Has(p) {
			missing = append(missing, string(p))
		}
	}
	sort.Strings(missing)
	return missing
}

// Assignable returns the roles a caller may hand out, and why not for the rest.
//
// This is what stops the escalation rule being experienced as an arbitrary 403.
// The invite form calls it and offers only the roles that will be accepted —
// requirement 7's principle applied to a dropdown rather than a button — and an
// admin configuring roles can see that their new Registrar role cannot assign
// anything and why.
func (s *Service) Assignable(ctx context.Context, callerHolds Set) ([]AssignableRole, error) {
	roles, err := s.Roles(ctx)
	if err != nil {
		return nil, err
	}

	out := make([]AssignableRole, 0, len(roles))
	for i := range roles {
		missing := Missing(roles[i].PermissionSet(), callerHolds)
		out = append(out, AssignableRole{
			Role:       &roles[i],
			Assignable: len(missing) == 0,
			Missing:    missing,
		})
	}
	return out, nil
}

// AssignableRole is a role plus whether this caller may give it to someone.
type AssignableRole struct {
	*Role
	Assignable bool     `json:"assignable"`
	Missing    []string `json:"missingPermissions,omitempty"`
}

// slugify makes a stable identifier from a role name.
func slugify(name string) string {
	var b strings.Builder
	lastDash := true
	for _, r := range strings.ToLower(strings.TrimSpace(name)) {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
			lastDash = false
		case !lastDash:
			b.WriteByte('-')
			lastDash = true
		}
	}
	return strings.Trim(b.String(), "-")
}
