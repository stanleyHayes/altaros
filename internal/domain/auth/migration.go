package auth

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"go.mongodb.org/mongo-driver/v2/bson"
)

// The WP-35 index migration, and the two halves that must not be reversed.
//
// The end state is that identity is unique per (church, address) rather than
// globally. Getting there means dropping two global unique indexes, and the
// order is the whole risk (R-10):
//
//  1. add the compound indexes alongside the existing ones — EnsureIndexes,
//     which runs at every boot and is safe because it only adds;
//  2. PROVE no church holds two accounts on one address, and no address is
//     held by two churches in a way the old index was hiding;
//  3. update both writers to scope their lookups — done in this package and in
//     apps/api's Mongoose adapter;
//  4. only then drop the global pair.
//
// Dropping first leaves a window in which two churches register the same
// address, after which the compound index build FAILS and the recovery is
// hand-editing production data to decide which of two real people keeps their
// account.

// Collision is one address held more than once where it must not be.
type Collision struct {
	// Scope is the church the duplicates share, or empty when the duplicate
	// spans churches.
	Scope string `json:"scope,omitempty"`
	Field string `json:"field"`
	Value string `json:"value"`
	Count int    `json:"count"`
}

func (c Collision) String() string {
	if c.Scope == "" {
		return fmt.Sprintf("%s %q held by %d accounts", c.Field, c.Value, c.Count)
	}
	return fmt.Sprintf("church %s: %s %q held by %d accounts", c.Scope, c.Field, c.Value, c.Count)
}

// ErrMigrationUnsafe means the preflight found data the compound index would
// reject.
var ErrMigrationUnsafe = errors.New("auth: workspace migration preflight failed")

// PreflightWorkspaceMigration reports every (churchId, address) that more than
// one account holds.
//
// These are exactly the documents that would make the unique compound index
// fail to build. Finding none does not merely permit the migration — it is the
// migration's only evidence that it is safe, because the failure mode is
// discovered at build time on a live collection otherwise.
//
// Returns the collisions rather than an error when there are some: an operator
// needs the list to fix them, not a refusal.
func (s *Service) PreflightWorkspaceMigration(ctx context.Context) ([]Collision, error) {
	var collisions []Collision

	for _, field := range []string{"email", "phone"} {
		// Group on the pair the new index is unique over. churchId is
		// normalised to a string first, because the same church appears as an
		// ObjectId in Mongoose-written documents and as a string in early
		// Go-written ones — grouping on the raw value would report two
		// accounts in one church as living in two different ones and miss the
		// collision entirely (ADR-005).
		pipeline := []bson.M{
			{"$match": bson.M{field: bson.M{"$exists": true, "$nin": bson.A{nil, ""}}}},
			{"$group": bson.M{
				"_id": bson.M{
					"church": bson.M{"$toString": "$churchId"},
					"value":  "$" + field,
				},
				"count": bson.M{"$sum": 1},
			}},
			{"$match": bson.M{"count": bson.M{"$gt": 1}}},
			{"$sort": bson.M{"count": -1}},
		}

		cursor, err := s.users.Aggregate(ctx, pipeline)
		if err != nil {
			return nil, fmt.Errorf("auth: preflight %s: %w", field, err)
		}

		var rows []struct {
			ID struct {
				Church string `bson:"church"`
				Value  string `bson:"value"`
			} `bson:"_id"`
			Count int `bson:"count"`
		}
		err = cursor.All(ctx, &rows)
		_ = cursor.Close(ctx)
		if err != nil {
			return nil, fmt.Errorf("auth: preflight decode %s: %w", field, err)
		}

		for _, row := range rows {
			collisions = append(collisions, Collision{
				Scope: row.ID.Church,
				Field: field,
				Value: row.ID.Value,
				Count: row.Count,
			})
		}
	}

	sort.Slice(collisions, func(i, j int) bool {
		if collisions[i].Field != collisions[j].Field {
			return collisions[i].Field < collisions[j].Field
		}
		return collisions[i].Value < collisions[j].Value
	})
	return collisions, nil
}

// globalUniqueIndexes are the indexes WP-35 exists to remove.
//
// Two of them, from two writers. `email_unique` is this package's; `email_1` is
// Mongoose's, generated from `email: {unique: true}` in apps/api's schema. That
// second one is the reason the migration is coordinated rather than local:
// Mongoose rebuilds its indexes from the schema on connect, so dropping
// `email_1` without changing the schema means the legacy API recreates it on
// its next boot and quietly restores global uniqueness.
var globalUniqueIndexes = []string{"email_unique", "email_1", "phone_unique", "phone_1"}

// DropGlobalUniqueness completes the migration, and refuses to unless it is safe.
//
// The preflight runs first and is not optional. A caller that wants to see the
// collisions without acting should call PreflightWorkspaceMigration directly;
// there is deliberately no force flag, because the only thing a force flag
// achieves here is a half-built index on a live collection.
//
// Dropping is idempotent: an index that is already gone is not an error, which
// matters because this runs against a database two writers share and either may
// have got there first.
func (s *Service) DropGlobalUniqueness(ctx context.Context) ([]string, error) {
	collisions, err := s.PreflightWorkspaceMigration(ctx)
	if err != nil {
		return nil, err
	}
	if len(collisions) > 0 {
		return nil, fmt.Errorf("%w: %d collision(s), first is %s",
			ErrMigrationUnsafe, len(collisions), collisions[0])
	}

	// The compound indexes must EXIST before the global ones go. Between the
	// drop and the build there is no uniqueness at all, and doing it in this
	// order makes that window zero rather than however long a build takes.
	if err := s.EnsureIndexes(ctx); err != nil {
		return nil, err
	}
	if err := s.requireCompoundIndexes(ctx); err != nil {
		return nil, err
	}

	var dropped []string
	for _, name := range globalUniqueIndexes {
		if err := s.users.Indexes().DropOne(ctx, name); err != nil {
			// Already absent is the expected case on a second run.
			if isIndexNotFound(err) {
				continue
			}
			return dropped, fmt.Errorf("auth: drop %s: %w", name, err)
		}
		dropped = append(dropped, name)
	}
	return dropped, nil
}

// requireCompoundIndexes refuses to proceed unless the replacements are live.
func (s *Service) requireCompoundIndexes(ctx context.Context) error {
	cursor, err := s.users.Indexes().List(ctx)
	if err != nil {
		return fmt.Errorf("auth: list indexes: %w", err)
	}
	var existing []bson.M
	if err := cursor.All(ctx, &existing); err != nil {
		return fmt.Errorf("auth: read indexes: %w", err)
	}

	present := map[string]bool{}
	for _, idx := range existing {
		if name, ok := idx["name"].(string); ok {
			present[name] = true
		}
	}
	for _, needed := range []string{"uq_church_email", "uq_church_phone"} {
		if !present[needed] {
			return fmt.Errorf("%w: %s is missing, so dropping the global indexes "+
				"would leave no uniqueness at all", ErrMigrationUnsafe, needed)
		}
	}
	return nil
}

// isIndexNotFound reports whether an error is MongoDB's "no such index".
func isIndexNotFound(err error) bool {
	// IndexNotFound is code 27. Matching on the code rather than the message
	// because the message is not part of any compatibility promise.
	var cmdErr interface{ HasErrorCode(int) bool }
	if errors.As(err, &cmdErr) {
		return cmdErr.HasErrorCode(27)
	}
	return false
}
