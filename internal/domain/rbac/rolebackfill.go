package rbac

import (
	"context"
	"fmt"
	"sort"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// Backfilling a NEW resource onto system roles that already exist.
//
// # The gap this closes
//
// EnsureSystemRoles leaves an existing role alone, and that is right: a church
// that deliberately widened its Staff role should not have that undone by a
// deploy. The cost is that a resource introduced LATER never reaches any church
// that already has roles. WP-24 hit this immediately — `social` was added to
// the Staff role, every church already had a Staff role, and so no church on
// earth could moderate its own feed. Nothing failed; the queue simply returned
// 404 to the people whose job it is.
//
// # The rule, which is narrower than "add what is missing"
//
// A permission is added only when the stored role holds NO permission at all on
// that resource. That distinction is the whole safety property:
//
//   - A church that NARROWED Staff by removing `member:create` still has other
//     `member` permissions, so `member` is not new to that role and nothing is
//     restored. Their decision stands.
//   - A church that has never heard of `social` gets the system default,
//     because there was no decision to overrule.
//
// Anything else — reconciling permission by permission — cannot tell "they
// removed this" from "this did not exist yet", and silently reverses
// administrators' decisions.

// maxBackfillRoles bounds one run, for the same reason the commission backfill
// is bounded: hitting the ceiling means "run it again", not "some were skipped".
const maxBackfillRoles = 2000

// RoleBackfillResult reports what a run did or would do.
type RoleBackfillResult struct {
	// DryRun is true when nothing was written.
	DryRun bool
	// Examined is how many system-role documents were considered.
	Examined int
	// Changed is how many gained permissions.
	Changed int
	// Added maps "churchId/slug" to the permissions added, so an operator can
	// see exactly what a run did rather than trusting a count.
	Added map[string][]string
	// Truncated is true when the ceiling was reached.
	Truncated bool
}

// BackfillSystemRoles grants newly-introduced resources to existing system
// roles.
//
// Dry run by default, like every other backfill here: an operation that
// rewrites permissions across every church should have to be asked for twice.
//
// Runs GLOBALLY rather than per church — it is a platform migration, and
// iterating churches to call a tenant-scoped method would need a church list
// this package has no business holding.
func (s *Service) BackfillSystemRoles(ctx context.Context, apply bool) (*RoleBackfillResult, error) {
	out := &RoleBackfillResult{DryRun: !apply, Added: map[string][]string{}}

	// The system definitions, indexed by slug.
	want := map[string]Set{}
	for _, sr := range systemRoles() {
		want[sr.slug] = sr.permissions
	}

	cursor, err := s.global.Find(ctx, bson.M{"system": true})
	if err != nil {
		return nil, fmt.Errorf("rbac: read system roles: %w", err)
	}
	defer func() { _ = cursor.Close(ctx) }()

	now := s.now().UTC()
	for cursor.Next(ctx) {
		if out.Examined >= maxBackfillRoles {
			out.Truncated = true
			break
		}

		var role struct {
			ID          bson.ObjectID `bson:"_id"`
			ChurchID    mongodb.ID    `bson:"churchId"`
			Slug        string        `bson:"slug"`
			Permissions []string      `bson:"permissions"`
			Version     int64         `bson:"version"`
		}
		if err := cursor.Decode(&role); err != nil {
			return nil, fmt.Errorf("rbac: decode system role: %w", err)
		}
		out.Examined++

		system, known := want[role.Slug]
		if !known {
			// A role marked system whose slug we no longer define. Left alone:
			// this migration adds, it does not tidy.
			continue
		}

		missing := newResourcePermissions(role.Permissions, system)
		if len(missing) == 0 {
			continue
		}

		out.Changed++
		out.Added[role.ChurchID.String()+"/"+role.Slug] = missing
		if !apply {
			continue
		}

		if _, err := s.global.UpdateOne(ctx,
			bson.M{"_id": role.ID},
			bson.M{
				"$addToSet": bson.M{"permissions": bson.M{"$each": missing}},
				// The version is what the permission cache and the assignment
				// hash key off, so bumping it is what makes the grant take
				// effect for people already signed in.
				"$inc": bson.M{"version": int64(1)},
				"$set": bson.M{"updatedAt": now},
			}); err != nil {
			return nil, fmt.Errorf("rbac: backfill role %s: %w", role.ID.Hex(), err)
		}
	}
	if err := cursor.Err(); err != nil {
		return nil, fmt.Errorf("rbac: iterate system roles: %w", err)
	}
	return out, nil
}

// newResourcePermissions returns the system permissions whose RESOURCE is
// absent from the stored role entirely.
//
// See the file comment: a resource the role has never held is new, and one it
// holds any permission on has been decided about.
func newResourcePermissions(stored []string, system Set) []string {
	held := map[Resource]bool{}
	for _, raw := range stored {
		if resource, _, err := Permission(raw).Split(); err == nil {
			held[resource] = true
		}
	}

	var missing []string
	for _, p := range system.Slice() {
		resource, _, err := p.Split()
		if err != nil || held[resource] {
			continue
		}
		missing = append(missing, string(p))
	}
	sort.Strings(missing)
	return missing
}
