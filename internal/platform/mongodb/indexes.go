package mongodb

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// ErrIndexConflict means an index already exists on the same keys but with
// weaker guarantees than the one being created — most importantly, a
// non-unique index where uniqueness is required.
var ErrIndexConflict = errors.New("mongodb: an existing index conflicts with a required one")

// EnsureIndexes creates indexes, tolerating ones the legacy Mongoose API
// already created under different names.
//
// This exists because of ADR-005: the Go services and the TypeScript API share
// one database throughout the migration, and Mongoose has already indexed
// several of these collections. Calling CreateMany blindly fails the whole
// boot with IndexOptionsConflict the moment two writers name the same index
// differently — `slug_1` from Mongoose versus `org_slug_unique` from Go.
//
// The rule is narrow on purpose:
//
//   - An existing index on the same keys with at least the same guarantees is
//     accepted, whatever it is called. Renaming it would mean dropping and
//     rebuilding an index the live TypeScript API is using.
//   - An existing index on the same keys with WEAKER guarantees is an error.
//     Silently accepting a non-unique index where uniqueness was asked for
//     would remove the constraint that makes payments idempotent, and the
//     service would boot looking healthy.
func EnsureIndexes(ctx context.Context, coll *mongo.Collection, models []mongo.IndexModel) error {
	existing, err := describeIndexes(ctx, coll)
	if err != nil {
		return err
	}

	var toCreate []mongo.IndexModel
	for _, model := range models {
		key, err := normalizeKey(model.Keys)
		if err != nil {
			return fmt.Errorf("mongodb: %s: %w", coll.Name(), err)
		}
		wantUnique := requestsUniqueness(model)

		match, found := existing[key]
		if !found {
			toCreate = append(toCreate, model)
			continue
		}

		if wantUnique && !match.unique {
			// The index exists but does not enforce what we depend on.
			return fmt.Errorf(
				"%w: %s.%s covers %s but is not unique; a unique index is required",
				ErrIndexConflict, coll.Name(), match.name, key)
		}
		// Same keys, guarantees at least as strong. Whatever it is called,
		// the constraint we need is in place.
	}

	if len(toCreate) == 0 {
		return nil
	}
	if _, err := coll.Indexes().CreateMany(ctx, toCreate); err != nil {
		return fmt.Errorf("mongodb: %s: create indexes: %w", coll.Name(), err)
	}
	return nil
}

type indexInfo struct {
	name   string
	unique bool
}

// requestsUniqueness reports whether an index model asks for a unique index.
//
// The v2 driver models options as a builder holding deferred setter functions
// rather than as a struct with readable fields, so the only way to know what
// was asked for is to apply them to a fresh IndexOptions and look.
func requestsUniqueness(model mongo.IndexModel) bool {
	if model.Options == nil {
		return false
	}
	var opts options.IndexOptions
	for _, set := range model.Options.Opts {
		if set == nil {
			continue
		}
		if err := set(&opts); err != nil {
			// An option that will not apply here will not apply at creation
			// either; let CreateMany surface it rather than guessing.
			return false
		}
	}
	return opts.Unique != nil && *opts.Unique
}

// describeIndexes reads the collection's current indexes, keyed by their
// normalised key specification.
func describeIndexes(ctx context.Context, coll *mongo.Collection) (map[string]indexInfo, error) {
	cur, err := coll.Indexes().List(ctx)
	if err != nil {
		return nil, fmt.Errorf("mongodb: %s: list indexes: %w", coll.Name(), err)
	}
	defer func() { _ = cur.Close(ctx) }()

	out := map[string]indexInfo{}
	for cur.Next(ctx) {
		var spec struct {
			Name   string `bson:"name"`
			Key    bson.D `bson:"key"`
			Unique bool   `bson:"unique"`
		}
		if err := cur.Decode(&spec); err != nil {
			return nil, fmt.Errorf("mongodb: %s: decode index: %w", coll.Name(), err)
		}
		key, err := normalizeKey(spec.Key)
		if err != nil {
			// An index shape we cannot compare is not one we can reason
			// about; skip it rather than claim it satisfies anything.
			continue
		}
		out[key] = indexInfo{name: spec.Name, unique: spec.Unique}
	}
	if err := cur.Err(); err != nil {
		return nil, fmt.Errorf("mongodb: %s: read indexes: %w", coll.Name(), err)
	}
	return out, nil
}

// normalizeKey renders an index key specification as a comparable string.
//
// Field ORDER is preserved rather than sorted: {churchId:1, occurredAt:-1} and
// {occurredAt:-1, churchId:1} are different indexes with different prefixes,
// and treating them as equal would let a query that needs the churchId prefix
// believe it is covered when it is not (ADR-005).
func normalizeKey(keys any) (string, error) {
	var parts []string

	switch k := keys.(type) {
	case bson.D:
		for _, e := range k {
			parts = append(parts, fmt.Sprintf("%s:%v", e.Key, e.Value))
		}
	case bson.M:
		// A map has no defined order, so it cannot be compared safely against
		// an ordered key spec. Refuse rather than guess.
		if len(k) > 1 {
			return "", fmt.Errorf("compound index keys must be bson.D, not bson.M (order matters)")
		}
		for field, dir := range k {
			parts = append(parts, fmt.Sprintf("%s:%v", field, dir))
		}
	default:
		return "", fmt.Errorf("unsupported index key type %T", keys)
	}

	return strings.Join(parts, ","), nil
}
