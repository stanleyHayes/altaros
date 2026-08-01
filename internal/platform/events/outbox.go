package events

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// Collection holding undelivered events.
const OutboxCollection = "event_outbox"

// Outbox makes publishing survive a broker outage.
//
// # The problem
//
// Settlement writes the transaction to MongoDB and then publishes
// giving.completed to Kafka. Those are two systems and one intention, so
// there is a window between them: if Kafka is unreachable, or the process dies
// after the database write, the ledger says the gift settled and no event ever
// existed. The receipt is never sent, and — worse — nothing anywhere records
// that it is missing. Every publish error in the domains was discarded with
// `_ =`, so the failure was not even logged.
//
// That is at-MOST-once delivery from the producer, while §6 states the
// contract is at-least-once. Consumers being idempotent does not help: they
// cannot deduplicate an event that was never sent.
//
// # The fix
//
// The event is written to MongoDB first, in the same database as the domain
// state, and a relay publishes it afterwards and marks it sent. Kafka being
// down means the outbox backs up and drains when it recovers. The database is
// the single source of truth for "this happened", which is the only place it
// can be, because it is the same place the transaction itself lives.
//
// This is not full transactional atomicity — that needs a Mongo transaction
// spanning the domain write and the outbox insert, which needs a replica set,
// which the single-node development container is not. The window is narrowed
// from "the whole Kafka round trip" to "one local insert", and the relay makes
// the failure recoverable rather than silent. Widening it to a real
// transaction is a one-line change to how Save is called once production runs
// a replica set (§5, ADR-005).
type Outbox struct {
	coll *mongo.Collection
	log  *slog.Logger
}

// NewOutbox builds an outbox over a collection.
func NewOutbox(db *mongo.Database, log *slog.Logger) *Outbox {
	if log == nil {
		log = slog.Default()
	}
	return &Outbox{coll: db.Collection(OutboxCollection), log: log}
}

// Record is one event awaiting delivery.
type Record struct {
	ID    bson.ObjectID `bson:"_id,omitempty"`
	Topic string        `bson:"topic"`
	Key   string        `bson:"key"`
	// Body is the fully encoded envelope, so the relay publishes exactly what
	// was intended at the time — not a re-encoding of a payload whose meaning
	// may have moved on.
	Body []byte `bson:"body"`
	// EventID is the envelope's id, carried out for the unique index.
	EventID string `bson:"eventId"`
	// Attempts counts publish attempts, for backoff and for spotting a
	// permanently undeliverable event.
	Attempts int `bson:"attempts"`
	// PublishedAt is nil until the relay confirms Kafka has it.
	PublishedAt   *time.Time `bson:"publishedAt,omitempty"`
	LastError     string     `bson:"lastError,omitempty"`
	NextAttemptAt time.Time  `bson:"nextAttemptAt"`
	CreatedAt     time.Time  `bson:"createdAt"`
}

// EnsureIndexes creates the outbox indexes.
func (o *Outbox) EnsureIndexes(ctx context.Context) error {
	_, err := o.coll.Indexes().CreateMany(ctx, []mongo.IndexModel{
		{
			// One row per event, so a retried Save cannot enqueue it twice.
			Keys:    bson.D{{Key: "eventId", Value: 1}},
			Options: options.Index().SetName("uq_outbox_event").SetUnique(true),
		},
		{
			// The relay's query: undelivered and due.
			Keys: bson.D{
				{Key: "publishedAt", Value: 1},
				{Key: "nextAttemptAt", Value: 1},
			},
			Options: options.Index().SetName("outbox_pending"),
		},
		{
			// Delivered rows are swept after a week — long enough to answer
			// "was this event ever sent?" during an incident, short enough
			// that the collection does not grow without bound.
			Keys: bson.D{{Key: "publishedAt", Value: 1}},
			Options: options.Index().
				SetName("outbox_ttl").
				SetExpireAfterSeconds(7 * 24 * 60 * 60).
				SetPartialFilterExpression(bson.M{"publishedAt": bson.M{"$exists": true}}),
		},
	})
	if err != nil {
		return fmt.Errorf("events: create outbox indexes: %w", err)
	}
	return nil
}

// Save records an event for delivery.
func (o *Outbox) Save(ctx context.Context, e *Envelope) error {
	body, err := json.Marshal(e)
	if err != nil {
		return fmt.Errorf("events: encode outbox record: %w", err)
	}

	now := time.Now().UTC()
	_, err = o.coll.InsertOne(ctx, bson.M{
		"topic":         e.Type,
		"key":           e.Subject,
		"body":          body,
		"eventId":       e.ID,
		"attempts":      0,
		"nextAttemptAt": now,
		"createdAt":     now,
	})
	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			// Already queued. Not an error: the caller retried and the event
			// is exactly as pending as it was.
			return nil
		}
		return fmt.Errorf("events: save to outbox: %w", err)
	}
	return nil
}

// Relay drains the outbox into Kafka.
//
// Runs on a ticker rather than reacting to each save, because the common path
// already publishes directly — the relay exists for what the direct publish
// missed. Polling a small indexed collection every few seconds costs almost
// nothing and needs no coordination between replicas beyond the claim below.
type Relay struct {
	outbox   *Outbox
	bus      *Bus
	log      *slog.Logger
	interval time.Duration
	batch    int64
}

// NewRelay builds the outbox relay.
func NewRelay(outbox *Outbox, bus *Bus, log *slog.Logger) *Relay {
	if log == nil {
		log = slog.Default()
	}
	return &Relay{
		outbox:   outbox,
		bus:      bus,
		log:      log,
		interval: 5 * time.Second,
		batch:    100,
	}
}

// Run drains the outbox until the context is cancelled.
func (r *Relay) Run(ctx context.Context) {
	if r == nil || r.bus == nil || !r.bus.Enabled() {
		return
	}

	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()

	r.log.Info("outbox relay started", slog.Duration("interval", r.interval))
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if n, err := r.drain(ctx); err != nil {
				r.log.Error("outbox drain failed", slog.String("error", err.Error()))
			} else if n > 0 {
				r.log.Info("outbox drained", slog.Int("published", n))
			}
		}
	}
}

// drain publishes everything due, returning how many were delivered.
func (r *Relay) drain(ctx context.Context) (int, error) {
	now := time.Now().UTC()

	cur, err := r.outbox.coll.Find(ctx,
		bson.M{
			"publishedAt":   bson.M{"$exists": false},
			"nextAttemptAt": bson.M{"$lte": now},
		},
		options.Find().
			SetSort(bson.D{{Key: "createdAt", Value: 1}}).
			SetLimit(r.batch))
	if err != nil {
		return 0, fmt.Errorf("events: read outbox: %w", err)
	}
	defer func() { _ = cur.Close(ctx) }()

	var pending []Record
	if err := cur.All(ctx, &pending); err != nil {
		return 0, fmt.Errorf("events: decode outbox: %w", err)
	}

	published := 0
	for i := range pending {
		record := &pending[i]

		// Claim it before publishing, by moving nextAttemptAt forward. Two
		// replicas draining at once would otherwise both publish it — which is
		// survivable, since consumers dedupe on the event id, but pointless
		// load. The claim is advisory, not a lock: correctness still rests on
		// the consumer's idempotency.
		claimed, err := r.claim(ctx, record)
		if err != nil {
			r.log.Error("could not claim an outbox record",
				slog.String("event_id", record.EventID),
				slog.String("error", err.Error()))
			continue
		}
		if !claimed {
			continue
		}

		if err := r.bus.publishRaw(ctx, record.Topic, record.Key, record.Body); err != nil {
			r.fail(ctx, record, err)
			continue
		}
		if err := r.markPublished(ctx, record); err != nil {
			// Published but not marked. The next drain republishes it, and the
			// consumer's dedupe on the event id absorbs the duplicate — which
			// is exactly the case at-least-once delivery is defined for.
			r.log.Warn("event published but not marked; it may be republished",
				slog.String("event_id", record.EventID),
				slog.String("error", err.Error()))
		}
		published++
	}
	return published, nil
}

// claim reserves a record by pushing its next attempt into the future.
func (r *Relay) claim(ctx context.Context, record *Record) (bool, error) {
	res, err := r.outbox.coll.UpdateOne(ctx,
		bson.M{
			"_id":           record.ID,
			"publishedAt":   bson.M{"$exists": false},
			"nextAttemptAt": bson.M{"$lte": time.Now().UTC()},
		},
		bson.M{
			"$set": bson.M{"nextAttemptAt": time.Now().UTC().Add(r.interval * 2)},
			"$inc": bson.M{"attempts": 1},
		})
	if err != nil {
		return false, err
	}
	return res.ModifiedCount == 1, nil
}

func (r *Relay) markPublished(ctx context.Context, record *Record) error {
	now := time.Now().UTC()
	_, err := r.outbox.coll.UpdateOne(ctx,
		bson.M{"_id": record.ID},
		bson.M{"$set": bson.M{"publishedAt": now}, "$unset": bson.M{"lastError": ""}})
	return err
}

// fail records a failed attempt and schedules a retry.
func (r *Relay) fail(ctx context.Context, record *Record, cause error) {
	// Exponential backoff with a ceiling. A broker that is down for an hour
	// should not be probed every five seconds for that hour, but an event must
	// not wait longer than the ceiling once it recovers.
	delay := r.interval << min(record.Attempts, 6)
	if max := 5 * time.Minute; delay > max {
		delay = max
	}

	_, err := r.outbox.coll.UpdateOne(ctx,
		bson.M{"_id": record.ID},
		bson.M{"$set": bson.M{
			"nextAttemptAt": time.Now().UTC().Add(delay),
			"lastError":     cause.Error(),
		}})
	if err != nil {
		r.log.Error("could not record an outbox failure",
			slog.String("event_id", record.EventID),
			slog.String("error", err.Error()))
	}

	// A record that has failed many times is stuck on something a retry will
	// not fix. It stays in the outbox — dropping it would lose the event —
	// but it is surfaced so someone can look.
	const loudAfter = 10
	if record.Attempts >= loudAfter {
		r.log.Error("an event has failed to publish repeatedly and needs attention",
			slog.String("event_id", record.EventID),
			slog.String("topic", record.Topic),
			slog.Int("attempts", record.Attempts),
			slog.String("error", cause.Error()))
	}
}

// PendingCount reports how many events are waiting. For readiness reporting
// and for a "is the bus healthy" dashboard.
func (o *Outbox) PendingCount(ctx context.Context) (int64, error) {
	n, err := o.coll.CountDocuments(ctx, bson.M{"publishedAt": bson.M{"$exists": false}})
	if err != nil {
		return 0, fmt.Errorf("events: count pending: %w", err)
	}
	return n, nil
}

// ErrOutboxUnavailable means the event could not even be queued.
var ErrOutboxUnavailable = errors.New("events: could not queue the event for delivery")
