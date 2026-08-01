package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// Workspace identity (WP-35, ADR-006).
//
// A person signing in says WHICH CHURCH they are signing in to. That is the
// user's stated requirement — "when a client is logging in, they must enter the
// workspace they're joining" — and it is also what makes the same email address
// able to hold an account in two churches, which a global unique index forbids.
//
// The identifier is the church SLUG, which is already public by design: it is
// the member join code and, under ADR-007, the subdomain. Nothing new is
// disclosed by asking for it.
//
// # Why separate accounts rather than one identity across churches (Q-9)
//
// The alternative — one login, then a workspace picker — sounds friendlier and
// forces a question with no safe answer: what may a session see BEFORE a
// workspace is picked? Any answer is either useless or a cross-tenant read. A
// picker can be built later as a convenience layer over separate accounts; the
// reverse is a data migration.

// ErrWorkspaceUnknown means no active church matched the identifier.
//
// Never surfaced to a caller on its own — LoginWithPassword collapses it into
// ErrInvalidCredentials, because "no such workspace" tells an attacker which
// churches exist on the platform, one guess at a time.
var ErrWorkspaceUnknown = errors.New("auth: unknown workspace")

// normalizeWorkspace canonicalises a workspace identifier.
//
// Case and surrounding whitespace are forgiven because a person types this from
// a printed bulletin or a WhatsApp message. A leading @ is stripped for the
// same reason: people write @grace-chapel when told their workspace is
// grace-chapel.
func normalizeWorkspace(raw string) string {
	return strings.ToLower(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(raw), "@")))
}

// resolveWorkspace turns a slug into a church id.
//
// Returns ErrWorkspaceUnknown for an inactive or non-existent church, which the
// caller must NOT distinguish from a wrong password.
func (s *Service) resolveWorkspace(ctx context.Context, workspace string) (string, error) {
	slug := normalizeWorkspace(workspace)
	if slug == "" {
		return "", ErrWorkspaceUnknown
	}

	var church struct {
		ID bson.ObjectID `bson:"_id"`
	}
	err := s.churches.FindOne(ctx, bson.M{"slug": slug, "isActive": true}).Decode(&church)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return "", ErrWorkspaceUnknown
	}
	if err != nil {
		return "", fmt.Errorf("auth: resolve workspace: %w", err)
	}
	return church.ID.Hex(), nil
}

// scopedCredentialFilter builds the lookup for a sign-in.
//
// With a workspace, the query is scoped to that church — which is the whole
// point of WP-35, and what lets two churches hold the same address.
//
// WITHOUT a workspace it falls back to a global lookup that succeeds only when
// exactly one account matches. That fallback exists for the migration window
// and for clients that have not been updated yet; it is not a permanent second
// way in. It degrades correctly rather than suddenly: the day a second church
// registers an address, sign-in for that address requires naming a workspace,
// and until then nothing changes for anyone.
//
// The ambiguous case returns the SAME error as a wrong password. "That address
// belongs to more than one church" would be a friendlier message and an
// account-enumeration oracle — it confirms the address exists, twice over.
func credentialFilter(field, value, churchID string) bson.M {
	filter := bson.M{field: value}
	if churchID != "" {
		// Both storage forms, for the same reason TenantCollection matches both:
		// Mongoose writes churchId as an ObjectId and early Go documents wrote
		// it as a string (ADR-005).
		if oid, err := bson.ObjectIDFromHex(churchID); err == nil {
			filter["churchId"] = bson.M{"$in": bson.A{oid, churchID}}
		} else {
			filter["churchId"] = churchID
		}
	}
	return filter
}

// findOneCredential resolves exactly one account, or reports that it could not.
//
// The "exactly one" is load-bearing in the unscoped case: two accounts sharing
// an address is precisely what WP-35 makes possible, and picking either one
// would sign somebody into a church they did not name.
func (s *Service) findOneCredential(ctx context.Context, field, value, churchID string) (*User, error) {
	filter := credentialFilter(field, value, churchID)

	// Limit 2 rather than FindOne: the question is not "is there one" but "is
	// there more than one", and that distinction is the whole safety property.
	cursor, err := s.users.Find(ctx, filter, options.Find().SetLimit(2))
	if err != nil {
		return nil, fmt.Errorf("auth: lookup credential: %w", err)
	}
	defer func() { _ = cursor.Close(ctx) }()

	var found []User
	if err := cursor.All(ctx, &found); err != nil {
		return nil, fmt.Errorf("auth: decode credential: %w", err)
	}

	if len(found) != 1 {
		// Zero and "more than one" are the same answer to the caller. A distinct
		// message for the ambiguous case would confirm the address exists.
		return nil, ErrInvalidCredentials
	}
	return &found[0], nil
}
