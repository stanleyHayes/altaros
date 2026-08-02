// Package rbac is role-based access control with per-user overrides (WP-36).
//
// # The requirement that shapes everything
//
// Two of the stated requirements look contradictory:
//
//	(5) after creation, a user's individual permissions can be altered
//	    without affecting the original role permissions
//	(8) role permissions themselves can be updated
//
// A snapshot — copying the role's permissions onto the user at assignment —
// satisfies 5 and breaks 8: edit the role afterwards and nobody's permissions
// change. A plain role reference satisfies 8 and breaks 5: there is nowhere to
// put an individual grant.
//
// The resolution is an overlay. Nothing is copied; the role is read live and
// the individual's deltas are applied on top:
//
//	effective = expand( (role.permissions − user.revoked) ∪ user.granted )
//
// Editing a role therefore reaches every holder, and an individual's
// adjustments survive that edit. See ADR-008.
//
// # The consequence someone has to agree to
//
// A permission granted to a user individually SURVIVES its removal from the
// role. That follows directly from requirement 5, but it means "remove finance
// access from the Staff role" has not necessarily removed it from everyone.
// The role editor has to say so — see §10 Q-11.
package rbac

import (
	"errors"
	"fmt"
	"sort"
	"strings"
)

// Action is what may be done to a resource.
type Action string

const (
	ActionRead   Action = "read"
	ActionCreate Action = "create"
	ActionUpdate Action = "update"
	ActionDelete Action = "delete"
)

// AllActions is every action, in the order a UI should show them.
var AllActions = []Action{ActionRead, ActionCreate, ActionUpdate, ActionDelete}

// Valid reports whether an action is recognised.
func (a Action) Valid() bool {
	switch a {
	case ActionRead, ActionCreate, ActionUpdate, ActionDelete:
		return true
	}
	return false
}

// IsWrite reports whether an action modifies anything.
//
// The distinction matters because of the dependency rule: every write action
// requires read on the same resource.
func (a Action) IsWrite() bool { return a != ActionRead && a.Valid() }

// Resource is a thing permissions are granted over.
type Resource string

const (
	ResourceMember        Resource = "member"
	ResourceFinance       Resource = "finance"
	ResourceEvent         Resource = "event"
	ResourceCommunication Resource = "communication"
	ResourcePrayer        Resource = "prayer"
	ResourceWelfare       Resource = "welfare"
	ResourceChurch        Resource = "church"
	ResourceReport        Resource = "report"
	ResourceSettings      Resource = "settings"
	// ResourceRole is itself a resource, which is what makes "roles can be
	// created by an admin WITH THE RIGHT PERMISSIONS" expressible rather than
	// hard-coded to a role name.
	ResourceRole Resource = "role"
	// ResourceUser covers inviting and managing staff and members.
	ResourceUser Resource = "user"
)

// AllResources is every resource, sorted for a stable permission matrix.
var AllResources = []Resource{
	ResourceChurch, ResourceCommunication, ResourceEvent, ResourceFinance,
	ResourceMember, ResourcePrayer, ResourceReport, ResourceRole,
	ResourceSettings, ResourceUser, ResourceWelfare,
}

// Valid reports whether a resource is recognised.
func (r Resource) Valid() bool {
	for _, known := range AllResources {
		if r == known {
			return true
		}
	}
	return false
}

var (
	// ErrMalformed means a permission string is not resource:action.
	ErrMalformed = errors.New("rbac: a permission must be resource:action")
	// ErrUnknownResource means the resource is not recognised. Refusing an
	// unknown resource stops a typo becoming a permission nobody holds and
	// nothing checks.
	ErrUnknownResource = errors.New("rbac: unrecognised resource")
	// ErrUnknownAction means the action is not one of read/create/update/delete.
	ErrUnknownAction = errors.New("rbac: unrecognised action")
	// ErrMissingRead means a write permission was granted without the read it
	// depends on.
	ErrMissingRead = errors.New("rbac: a write permission requires read on the same resource")
)

// Permission is one resource:action pair.
type Permission string

// NewPermission builds a permission.
func NewPermission(r Resource, a Action) Permission {
	return Permission(string(r) + ":" + string(a))
}

// Split returns the resource and action.
func (p Permission) Split() (Resource, Action, error) {
	resource, action, found := strings.Cut(strings.TrimSpace(string(p)), ":")
	if !found || resource == "" || action == "" {
		return "", "", fmt.Errorf("%w: %q", ErrMalformed, p)
	}

	res := Resource(strings.ToLower(resource))
	if !res.Valid() {
		return "", "", fmt.Errorf("%w: %q", ErrUnknownResource, resource)
	}
	act := Action(strings.ToLower(action))
	if !act.Valid() {
		return "", "", fmt.Errorf("%w: %q", ErrUnknownAction, action)
	}
	return res, act, nil
}

// Valid reports whether a permission is well formed and recognised.
func (p Permission) Valid() bool {
	_, _, err := p.Split()
	return err == nil
}

// ReadOf returns the read permission a write permission depends on.
func (p Permission) ReadOf() (Permission, bool) {
	resource, action, err := p.Split()
	if err != nil || !action.IsWrite() {
		return "", false
	}
	return NewPermission(resource, ActionRead), true
}

// Set is a collection of permissions with set semantics.
type Set map[Permission]struct{}

// NewSet builds a set from a slice.
func NewSet(permissions ...Permission) Set {
	s := make(Set, len(permissions))
	for _, p := range permissions {
		s[p] = struct{}{}
	}
	return s
}

// Has reports whether the set contains a permission.
func (s Set) Has(p Permission) bool {
	if s == nil {
		return false
	}
	_, ok := s[p]
	return ok
}

// Can reports whether the set permits an action on a resource.
func (s Set) Can(r Resource, a Action) bool { return s.Has(NewPermission(r, a)) }

// Add inserts a permission.
func (s Set) Add(p Permission) { s[p] = struct{}{} }

// Remove deletes a permission.
func (s Set) Remove(p Permission) { delete(s, p) }

// Slice returns the permissions sorted, so a stored or transmitted set is
// stable — an unsorted list makes every save look like a change and every
// token differ from the last.
func (s Set) Slice() []Permission {
	out := make([]Permission, 0, len(s))
	for p := range s {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

// Strings returns the permissions as sorted strings, for storage and JSON.
func (s Set) Strings() []string {
	sorted := s.Slice()
	out := make([]string, len(sorted))
	for i, p := range sorted {
		out[i] = string(p)
	}
	return out
}

// SetFromStrings builds a set, ignoring anything unrecognised.
//
// Tolerant on read because stored data outlives code: a permission removed
// from the platform should not make an existing role undecodable, it should
// simply stop being granted.
func SetFromStrings(in []string) Set {
	s := make(Set, len(in))
	for _, raw := range in {
		p := Permission(strings.ToLower(strings.TrimSpace(raw)))
		if p.Valid() {
			s.Add(p)
		}
	}
	return s
}

// Expand adds the read permission implied by every write permission.
//
// This is one half of requirement 6. The other half is Validate, which refuses
// to STORE a set that violates the rule — so a bad set cannot be created, and
// an existing one is still made safe when it is used.
//
// The rule exists because the alternative is incoherent. A user who may edit a
// giving record but not read one gets an edit form full of blanks and saves
// them over real values.
func Expand(s Set) Set {
	out := make(Set, len(s)+len(s)/2)
	for p := range s {
		out.Add(p)
		if read, ok := p.ReadOf(); ok {
			out.Add(read)
		}
	}
	return out
}

// Validate reports every violation of the dependency rule.
//
// Returns the missing read permissions rather than a bare error, so an admin
// is told exactly what to add instead of being told no.
func Validate(s Set) []Permission {
	var missing []Permission
	for p := range s {
		read, ok := p.ReadOf()
		if !ok {
			continue
		}
		if !s.Has(read) {
			missing = append(missing, read)
		}
	}
	sort.Slice(missing, func(i, j int) bool { return missing[i] < missing[j] })
	return missing
}

// ValidateStrict returns an error naming what is missing.
func ValidateStrict(s Set) error {
	missing := Validate(s)
	if len(missing) == 0 {
		return nil
	}
	names := make([]string, len(missing))
	for i, p := range missing {
		names[i] = string(p)
	}
	return fmt.Errorf("%w: add %s", ErrMissingRead, strings.Join(names, ", "))
}

// Effective computes what a user may actually do.
//
// This is ADR-008 in one expression, and the order matters: a revoke is
// applied before a grant, so explicitly granting something the user also has
// revoked results in it being GRANTED. That is the less surprising outcome —
// an admin who ticks a box expects the box to win — and it means the two
// override lists never need to be kept mutually exclusive.
func Effective(role Set, granted, revoked Set) Set {
	out := make(Set, len(role)+len(granted))
	for p := range role {
		if revoked.Has(p) {
			continue
		}
		out.Add(p)
	}
	for p := range granted {
		out.Add(p)
	}
	return Expand(out)
}

// All returns every permission the platform defines. For building a permission
// matrix in a UI, and for the system Admin role.
func All() Set {
	s := make(Set, len(AllResources)*len(AllActions))
	for _, r := range AllResources {
		for _, a := range AllActions {
			s.Add(NewPermission(r, a))
		}
	}
	return s
}

// PastoralResources are the ones a blanket administrative role does NOT sweep
// in, because they carry hardship and safeguarding information about named
// people.
//
// Welfare is the case that forced this. WP-27's acceptance criterion is "a
// church admin WITHOUT the welfare role cannot read case details" — which was
// impossible while the Administrator role held All(), because All() includes
// welfare and every church admin therefore held it by default.
//
// The point is not that administrators are untrusted. It is that a church's
// welfare records name people in crisis, and access to them should be a
// decision somebody made rather than a side effect of being given the admin
// role to manage the giving reports. §3.4(3) calls for a strict pastoral ACL,
// and an ACL that everybody satisfies is not one.
//
// Granting it is one explicit step: add welfare permissions to a role, or grant
// them to a person through the ADR-008 overlay.
var PastoralResources = []Resource{ResourceWelfare}

// isPastoral reports whether a resource is withheld from blanket grants.
func isPastoral(r Resource) bool {
	for _, p := range PastoralResources {
		if p == r {
			return true
		}
	}
	return false
}

// AllExceptPastoral is every permission a blanket administrative role gets.
//
// Deliberately NOT All(). See PastoralResources.
func AllExceptPastoral() Set {
	s := make(Set, len(AllResources)*len(AllActions))
	for _, r := range AllResources {
		if isPastoral(r) {
			continue
		}
		for _, a := range AllActions {
			s.Add(NewPermission(r, a))
		}
	}
	return s
}

// ReadOnly returns read on every resource.
func ReadOnly() Set {
	s := make(Set, len(AllResources))
	for _, r := range AllResources {
		s.Add(NewPermission(r, ActionRead))
	}
	return s
}
