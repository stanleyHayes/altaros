package rbac

import (
	"errors"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// Collections.
const (
	RoleCollection = "roles"
	UserCollection = "users"
)

var (
	// ErrRoleNotFound means no role matched.
	ErrRoleNotFound = errors.New("rbac: role not found")
	// ErrRoleNameTaken means the church already has a role with that name.
	ErrRoleNameTaken = errors.New("rbac: a role with that name already exists")
	// ErrSystemRole means an operation was attempted on a role that may not be
	// changed or removed.
	ErrSystemRole = errors.New("rbac: system roles cannot be modified or deleted")
	// ErrRoleInUse means a role still has holders.
	ErrRoleInUse = errors.New("rbac: the role is still assigned to users")
	// ErrNameRequired means a role was submitted without a name.
	ErrNameRequired = errors.New("rbac: a role name is required")
	// ErrForbidden means the caller lacks the permission for this operation.
	ErrForbidden = errors.New("rbac: not permitted")
	// ErrUserNotFound means no user matched.
	ErrUserNotFound = errors.New("rbac: user not found")
	// ErrEscalation means a caller tried to grant a permission they do not hold.
	ErrEscalation = errors.New("rbac: you cannot grant a permission you do not hold")
)

// Role is a named set of permissions within one church.
type Role struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`
	Name     string        `bson:"name"          json:"name"`
	// Slug is the stable identifier. A church may rename "Staff" to "Ministry
	// Team" without every reference to it breaking.
	Slug        string   `bson:"slug"          json:"slug"`
	Description string   `bson:"description,omitempty" json:"description,omitempty"`
	Permissions []string `bson:"permissions"   json:"permissions"`
	// System marks the three roles every church starts with. They may be
	// COPIED but not deleted or renamed: a church that deletes its only admin
	// role has locked itself out, and the recovery is a support ticket against
	// a production database.
	System bool `bson:"system" json:"system"`
	// Version increments on every permission change. It is what lets a signed-in
	// user's token be recognised as stale without comparing permission lists.
	Version   int64      `bson:"version"   json:"version"`
	CreatedBy mongodb.ID `bson:"createdBy,omitempty" json:"createdBy,omitempty"`
	CreatedAt time.Time  `bson:"createdAt" json:"createdAt"`
	UpdatedAt time.Time  `bson:"updatedAt" json:"updatedAt"`
}

// PermissionSet returns the role's permissions as a set.
func (r *Role) PermissionSet() Set {
	if r == nil {
		return NewSet()
	}
	return SetFromStrings(r.Permissions)
}

// Overrides are one user's individual adjustments to their role.
//
// Deltas, never a copy of the role. That is what makes requirement 5 and
// requirement 8 both true at once: the role is read live, and these are
// applied on top of whatever it currently says.
type Overrides struct {
	// Granted are permissions the user holds beyond their role. These SURVIVE
	// the role losing them — see the note on Q-11.
	Granted []string `bson:"granted,omitempty" json:"granted,omitempty"`
	// Revoked are permissions the role gives that this user does not get.
	Revoked []string `bson:"revoked,omitempty" json:"revoked,omitempty"`
}

// Sets returns the overrides as permission sets.
func (o Overrides) Sets() (granted, revoked Set) {
	return SetFromStrings(o.Granted), SetFromStrings(o.Revoked)
}

// IsEmpty reports whether the user has no individual adjustments.
func (o Overrides) IsEmpty() bool { return len(o.Granted) == 0 && len(o.Revoked) == 0 }

// Assignment is what a user's authorisation is built from.
type Assignment struct {
	UserID    string
	ChurchID  string
	RoleID    string
	RoleName  string
	Overrides Overrides
	// Effective is the computed permission set.
	Effective Set
	// Version identifies this exact authorisation state. A token carrying a
	// different version is stale and its holder is made to refresh.
	Version string
}

// System role slugs. Every church gets these three at creation.
const (
	SystemAdmin  = "admin"
	SystemStaff  = "staff"
	SystemMember = "member"
	// SystemPastoral holds welfare, which no blanket role includes.
	SystemPastoral = "pastoral"
)

// systemRole describes a role every church starts with.
type systemRole struct {
	slug, name, description string
	permissions             Set
}

// systemRoles are created for each church and cannot be deleted.
//
// Three rather than one because the useful distinction is not "admin or not":
// a church has people who run it, people who serve in it, and people who
// attend it, and the middle group is the one a fixed two-role model always
// gets wrong.
func systemRoles() []systemRole {
	staff := NewSet(
		NewPermission(ResourceMember, ActionRead),
		NewPermission(ResourceMember, ActionCreate),
		NewPermission(ResourceMember, ActionUpdate),
		NewPermission(ResourceEvent, ActionRead),
		NewPermission(ResourceEvent, ActionCreate),
		NewPermission(ResourceEvent, ActionUpdate),
		NewPermission(ResourceCommunication, ActionRead),
		NewPermission(ResourceCommunication, ActionCreate),
		NewPermission(ResourceChurch, ActionRead),
		NewPermission(ResourceReport, ActionRead),
	)

	// A member reads what concerns them. Note the absence of finance: a member
	// sees their OWN giving through the ownership check on that route, not
	// through a permission over the congregation's.
	member := NewSet(
		NewPermission(ResourceChurch, ActionRead),
		NewPermission(ResourceEvent, ActionRead),
		NewPermission(ResourcePrayer, ActionRead),
		NewPermission(ResourcePrayer, ActionCreate),
	)

	return []systemRole{
		{
			slug: SystemAdmin, name: "Administrator",
			description: "Full access, including creating roles and inviting people. " +
				"Welfare cases are separate — see Pastoral care.",
			// NOT All(). Welfare is withheld from every blanket grant, because
			// a church's welfare records name people in crisis and access to
			// them should be a decision somebody made rather than a side
			// effect of being handed the admin role to manage giving reports.
			// See rbac.PastoralResources.
			permissions: AllExceptPastoral(),
		},
		{
			slug: SystemStaff, name: "Staff",
			description: "Runs the day to day: members, events and communication.",
			permissions: staff,
		},
		{
			slug: SystemMember, name: "Member",
			description: "A member of the congregation.",
			permissions: member,
		},
		{
			// The role that DOES hold welfare, and holds almost nothing else.
			//
			// Provisioned for every church so that granting pastoral access is
			// one obvious step rather than a permission somebody has to know
			// exists. It is deliberately narrow: reading a welfare case needs
			// member:read to know who the case is about, and nothing beyond
			// that. A pastoral carer has no business in the giving ledger.
			slug: SystemPastoral, name: "Pastoral care",
			description: "Reads and works welfare cases. Held by the few people " +
				"a church trusts with hardship and safeguarding information.",
			permissions: NewSet(
				NewPermission(ResourceWelfare, ActionRead),
				NewPermission(ResourceWelfare, ActionCreate),
				NewPermission(ResourceWelfare, ActionUpdate),
				NewPermission(ResourceMember, ActionRead),
				NewPermission(ResourceChurch, ActionRead),
			),
		},
	}
}
