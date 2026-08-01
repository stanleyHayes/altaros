package events

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

func newTestOutbox(t *testing.T) (*Outbox, *mongo.Database) {
	t.Helper()

	uri := os.Getenv("MONGODB_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	client, err := mongo.Connect(options.Client().ApplyURI(uri))
	if err != nil {
		testsupport.SkipOrFail(t, "MongoDB", err)
	}
	if err := client.Ping(ctx, nil); err != nil {
		testsupport.SkipOrFail(t, "MongoDB", err)
	}

	db := client.Database("altar_test_outbox")
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = db.Drop(c)
		_ = client.Disconnect(c)
	})

	outbox := NewOutbox(db, nil)
	if err := outbox.EnsureIndexes(ctx); err != nil {
		t.Fatalf("EnsureIndexes: %v", err)
	}
	return outbox, db
}

func testEnvelope(t *testing.T, churchID string) *Envelope {
	t.Helper()
	e, err := NewEnvelope("test", TopicGivingCompleted, churchID,
		map[string]any{"churchId": churchID, "transactionId": "tx_1"})
	if err != nil {
		t.Fatalf("NewEnvelope: %v", err)
	}
	return e
}

// The reason the outbox exists: settlement commits to MongoDB and then
// publishes. If Kafka is unreachable in that window, the ledger says the gift
// settled and no event ever existed — so the receipt is never sent and nothing
// records that it is missing.
func TestSavedEventIsPending(t *testing.T) {
	outbox, _ := newTestOutbox(t)
	ctx := context.Background()

	if err := outbox.Save(ctx, testEnvelope(t, "church_a")); err != nil {
		t.Fatalf("Save: %v", err)
	}

	n, err := outbox.PendingCount(ctx)
	if err != nil {
		t.Fatalf("PendingCount: %v", err)
	}
	if n != 1 {
		t.Fatalf("pending = %d, want 1", n)
	}
}

// A retried save must not enqueue the event twice — the relay would then
// publish it twice, and while consumers dedupe, the duplicate is pointless
// load that scales with how often the caller retries.
func TestSavingTheSameEventTwiceQueuesItOnce(t *testing.T) {
	outbox, _ := newTestOutbox(t)
	ctx := context.Background()
	e := testEnvelope(t, "church_a")

	for i := 0; i < 4; i++ {
		if err := outbox.Save(ctx, e); err != nil {
			t.Fatalf("save %d: %v", i+1, err)
		}
	}

	n, _ := outbox.PendingCount(ctx)
	if n != 1 {
		t.Fatalf("4 saves of one event queued %d rows, want 1", n)
	}
}

// The stored body must be the exact envelope, so the relay sends what was
// intended at the time rather than a re-encoding of a payload whose meaning
// may have moved on.
func TestStoredBodyRoundTripsToTheEnvelope(t *testing.T) {
	outbox, db := newTestOutbox(t)
	ctx := context.Background()

	original := testEnvelope(t, "church_a")
	if err := outbox.Save(ctx, original); err != nil {
		t.Fatalf("Save: %v", err)
	}

	var stored Record
	if err := db.Collection(OutboxCollection).FindOne(ctx, bson.M{}).Decode(&stored); err != nil {
		t.Fatalf("read back: %v", err)
	}

	var decoded Envelope
	if err := json.Unmarshal(stored.Body, &decoded); err != nil {
		t.Fatalf("the stored body should decode as an envelope: %v", err)
	}
	if decoded.ID != original.ID {
		t.Errorf("event id = %q, want %q", decoded.ID, original.ID)
	}
	// The partition key must survive, or the relay publishes it unkeyed and
	// per-church ordering is lost for exactly the events that were delayed.
	if stored.Key != "church_a" {
		t.Errorf("key = %q, want church_a", stored.Key)
	}
	if stored.Topic != TopicGivingCompleted {
		t.Errorf("topic = %q", stored.Topic)
	}
}

// The relay is what turns a queued event into a delivered one. Without it the
// outbox is the same lost event with an extra step.
func TestRelayDeliversAndMarksPublished(t *testing.T) {
	outbox, _ := newTestOutbox(t)
	ctx := context.Background()

	bus := newTestBus(t, "")
	if err := bus.EnsureTopics(ctx, []string{TopicGivingCompleted}, 1, 1); err != nil {
		t.Fatalf("EnsureTopics: %v", err)
	}

	if err := outbox.Save(ctx, testEnvelope(t, "church_a")); err != nil {
		t.Fatalf("Save: %v", err)
	}

	relay := NewRelay(outbox, bus, nil)
	published, err := relay.drain(ctx)
	if err != nil {
		t.Fatalf("drain: %v", err)
	}
	if published != 1 {
		t.Fatalf("drained %d events, want 1", published)
	}

	n, _ := outbox.PendingCount(ctx)
	if n != 0 {
		t.Fatalf("pending = %d after a successful drain, want 0", n)
	}
}

// A second drain must not republish what the first delivered.
func TestDrainingTwiceDoesNotRepublish(t *testing.T) {
	outbox, _ := newTestOutbox(t)
	ctx := context.Background()

	bus := newTestBus(t, "")
	if err := bus.EnsureTopics(ctx, []string{TopicGivingCompleted}, 1, 1); err != nil {
		t.Fatalf("EnsureTopics: %v", err)
	}
	if err := outbox.Save(ctx, testEnvelope(t, "church_a")); err != nil {
		t.Fatalf("Save: %v", err)
	}

	relay := NewRelay(outbox, bus, nil)
	if n, err := relay.drain(ctx); err != nil || n != 1 {
		t.Fatalf("first drain: n=%d err=%v", n, err)
	}
	if n, err := relay.drain(ctx); err != nil || n != 0 {
		t.Fatalf("second drain published %d, want 0: %v", n, err)
	}
}

// Two replicas draining at once must not both publish the same event. The
// claim is advisory — correctness still rests on consumer idempotency — but
// duplicating every delayed event across every replica is pointless load.
func TestClaimPreventsTwoReplicasPublishingTheSameEvent(t *testing.T) {
	outbox, db := newTestOutbox(t)
	ctx := context.Background()

	if err := outbox.Save(ctx, testEnvelope(t, "church_a")); err != nil {
		t.Fatalf("Save: %v", err)
	}

	var record Record
	if err := db.Collection(OutboxCollection).FindOne(ctx, bson.M{}).Decode(&record); err != nil {
		t.Fatalf("read: %v", err)
	}

	relay := NewRelay(outbox, nil, nil)

	first, err := relay.claim(ctx, &record)
	if err != nil {
		t.Fatalf("first claim: %v", err)
	}
	if !first {
		t.Fatal("the first claim should succeed")
	}

	second, err := relay.claim(ctx, &record)
	if err != nil {
		t.Fatalf("second claim: %v", err)
	}
	if second {
		t.Fatal("a second replica must not claim an event already in flight")
	}
}

// A failed publish must schedule a retry and record why, not drop the event.
func TestFailedPublishBacksOffAndKeepsTheEvent(t *testing.T) {
	outbox, db := newTestOutbox(t)
	ctx := context.Background()

	if err := outbox.Save(ctx, testEnvelope(t, "church_a")); err != nil {
		t.Fatalf("Save: %v", err)
	}

	var record Record
	if err := db.Collection(OutboxCollection).FindOne(ctx, bson.M{}).Decode(&record); err != nil {
		t.Fatalf("read: %v", err)
	}
	record.Attempts = 2

	relay := NewRelay(outbox, nil, nil)
	relay.fail(ctx, &record, context.DeadlineExceeded)

	var after Record
	if err := db.Collection(OutboxCollection).FindOne(ctx, bson.M{"_id": record.ID}).Decode(&after); err != nil {
		t.Fatalf("read back: %v", err)
	}

	if after.PublishedAt != nil {
		t.Error("a failed publish must not mark the event delivered")
	}
	if after.LastError == "" {
		t.Error("the failure reason should be recorded for diagnosis")
	}
	if !after.NextAttemptAt.After(time.Now().UTC()) {
		t.Error("a failed publish should back off rather than retry immediately")
	}

	// The event is still pending — it is not dropped.
	n, _ := outbox.PendingCount(ctx)
	if n != 1 {
		t.Fatalf("pending = %d, want the event still queued", n)
	}
}

// Backoff must grow with attempts and then stop growing, so a broker that is
// down for an hour is not probed every five seconds for that hour, while an
// event still moves promptly once it recovers.
func TestBackoffGrowsThenCaps(t *testing.T) {
	outbox, db := newTestOutbox(t)
	ctx := context.Background()
	relay := NewRelay(outbox, nil, nil)

	var previous time.Duration
	for attempts := 0; attempts <= 12; attempts++ {
		e := testEnvelope(t, "church_a")
		if err := outbox.Save(ctx, e); err != nil {
			t.Fatalf("Save: %v", err)
		}

		var record Record
		err := db.Collection(OutboxCollection).
			FindOne(ctx, bson.M{"eventId": e.ID}).Decode(&record)
		if err != nil {
			t.Fatalf("read: %v", err)
		}
		record.Attempts = attempts

		before := time.Now().UTC()
		relay.fail(ctx, &record, context.DeadlineExceeded)

		var after Record
		if err := db.Collection(OutboxCollection).
			FindOne(ctx, bson.M{"_id": record.ID}).Decode(&after); err != nil {
			t.Fatalf("read back: %v", err)
		}
		delay := after.NextAttemptAt.Sub(before)

		if delay < previous-time.Second {
			t.Fatalf("attempt %d: backoff shrank (%v after %v)", attempts, delay, previous)
		}
		if delay > 6*time.Minute {
			t.Fatalf("attempt %d: backoff exceeded the ceiling: %v", attempts, delay)
		}
		previous = delay
	}
}

// An outbox with no relay running still holds the event. This is the property
// that makes a Kafka outage survivable: nothing is lost while the broker is
// away.
func TestEventsSurviveWithNoRelayRunning(t *testing.T) {
	outbox, _ := newTestOutbox(t)
	ctx := context.Background()

	for i := 0; i < 25; i++ {
		if err := outbox.Save(ctx, testEnvelope(t, "church_a")); err != nil {
			t.Fatalf("save %d: %v", i, err)
		}
	}

	n, err := outbox.PendingCount(ctx)
	if err != nil {
		t.Fatalf("PendingCount: %v", err)
	}
	if n != 25 {
		t.Fatalf("pending = %d, want all 25 held", n)
	}
}
