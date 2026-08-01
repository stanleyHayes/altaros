package events

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

func testBrokers() []string {
	if b := os.Getenv("KAFKA_BROKERS"); b != "" {
		return strings.Split(b, ",")
	}
	return []string{"127.0.0.1:19092"}
}

// newTestBus connects to a real broker with a unique consumer group, so
// concurrent test runs cannot steal each other's messages.
func newTestBus(t *testing.T, group string) *Bus {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	bus, err := NewBus(ctx, Config{
		Brokers:       testBrokers(),
		ConsumerGroup: group,
		Source:        "test",
	})
	if err != nil {
		testsupport.SkipOrFail(t, "Kafka", err)
	}
	t.Cleanup(bus.Close)
	return bus
}

func uniqueTopic(t *testing.T) string {
	t.Helper()
	// Derived from the test name plus a random event id, so a rerun does not
	// consume the previous run's messages from the same topic.
	id, err := newEventID()
	if err != nil {
		t.Fatalf("newEventID: %v", err)
	}
	return "altar.test." + strings.ToLower(t.Name()) + "." + id[4:12] + ".v1"
}

// The headline guarantee: an event published on one side is received on the
// other, with its payload intact.
func TestPublishedEventIsConsumed(t *testing.T) {
	topic := uniqueTopic(t)
	producer := newTestBus(t, "")
	consumer := newTestBus(t, "test-group-"+topic)

	if err := consumer.EnsureTopics(context.Background(), []string{topic}, 1, 1); err != nil {
		t.Fatalf("EnsureTopics: %v", err)
	}

	received := make(chan *Envelope, 4)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	err := consumer.Consume(ctx, map[string]Handler{
		topic: func(_ context.Context, e *Envelope, _ []byte) error {
			received <- e
			return nil
		},
	})
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}

	payload := map[string]any{"churchId": "church_a", "transactionId": "tx_1"}
	if err := producer.Publish(context.Background(), topic, "tx_1", payload); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	select {
	case e := <-received:
		if e.Type != topic {
			t.Errorf("type = %q, want %q", e.Type, topic)
		}
		// §6: the key is the church id, so per-church ordering holds.
		if e.Subject != "church_a" {
			t.Errorf("subject = %q, want church_a — the partition key must be the church",
				e.Subject)
		}
		if e.ID == "" {
			t.Error("every event needs an id for consumers to dedupe on")
		}
		if e.SpecVersion != SpecVersion {
			t.Errorf("specversion = %q", e.SpecVersion)
		}
	case <-time.After(30 * time.Second):
		t.Fatal("no event arrived within 30s")
	}
}

// §6 requires the church id as the key. Domains call Publish with the entity
// id, so the payload's churchId has to win — otherwise messages partition by
// member and one church's events stop being ordered relative to each other.
func TestChurchIDBecomesThePartitionKey(t *testing.T) {
	cases := []struct {
		name    string
		key     string
		payload any
		want    string
	}{
		{
			"payload churchId wins over the caller's key",
			"member_1",
			map[string]any{"churchId": "church_a", "memberId": "member_1"},
			"church_a",
		},
		{
			"the caller's key is used when the payload has no church",
			"church_b",
			map[string]any{"somethingElse": 1},
			"church_b",
		},
		{
			"an empty payload churchId does not win",
			"church_c",
			map[string]any{"churchId": ""},
			"church_c",
		},
	}
	for _, c := range cases {
		if got := keyOrSubject(c.key, c.payload); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

// An unkeyed message spreads across partitions at random, so one church's
// events stop being ordered relative to each other — a failure that is
// invisible until a consumer acts on a status change before the creation it
// belongs to.
func TestEnvelopeWithoutAChurchIsRefused(t *testing.T) {
	if _, err := NewEnvelope("test", "altar.test.v1", "", map[string]any{}); !errors.Is(err, ErrNoKey) {
		t.Fatalf("want ErrNoKey, got %v", err)
	}
	if _, err := NewEnvelope("test", "", "church_a", map[string]any{}); !errors.Is(err, ErrNoTopic) {
		t.Fatalf("want ErrNoTopic, got %v", err)
	}
}

func TestEventIDsAreUnique(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 1000; i++ {
		id, err := newEventID()
		if err != nil {
			t.Fatalf("newEventID: %v", err)
		}
		if seen[id] {
			t.Fatalf("duplicate event id %q; consumers dedupe on this", id)
		}
		seen[id] = true
	}
}

// A handler that fails must NOT have its offset committed, or the message is
// lost forever — for a giving receipt, that is a member who paid and was
// never told.
func TestFailedHandlerCausesRedelivery(t *testing.T) {
	topic := uniqueTopic(t)
	producer := newTestBus(t, "")
	consumer := newTestBus(t, "test-redeliver-"+topic)

	if err := consumer.EnsureTopics(context.Background(), []string{topic}, 1, 1); err != nil {
		t.Fatalf("EnsureTopics: %v", err)
	}

	var mu sync.Mutex
	attempts := 0
	succeeded := make(chan struct{})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	err := consumer.Consume(ctx, map[string]Handler{
		topic: func(_ context.Context, _ *Envelope, _ []byte) error {
			mu.Lock()
			attempts++
			n := attempts
			mu.Unlock()

			if n < 2 {
				return errors.New("transient failure")
			}
			select {
			case succeeded <- struct{}{}:
			default:
			}
			return nil
		},
	})
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}

	if err := producer.Publish(context.Background(), topic, "",
		map[string]any{"churchId": "church_a"}); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	select {
	case <-succeeded:
		mu.Lock()
		defer mu.Unlock()
		if attempts < 2 {
			t.Fatalf("handler ran %d times; a failure must be redelivered", attempts)
		}
	case <-time.After(45 * time.Second):
		mu.Lock()
		got := attempts
		mu.Unlock()
		t.Fatalf("the event was not redelivered after a failure (attempts: %d)", got)
	}
}

// Trace context must survive the hop through Kafka, or a gift and the receipt
// it triggers appear as two unrelated traces.
func TestTraceContextSurvivesKafka(t *testing.T) {
	topic := uniqueTopic(t)
	producer := newTestBus(t, "")
	consumer := newTestBus(t, "test-trace-"+topic)

	if err := consumer.EnsureTopics(context.Background(), []string{topic}, 1, 1); err != nil {
		t.Fatalf("EnsureTopics: %v", err)
	}

	gotHeaders := make(chan bool, 1)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	err := consumer.Consume(ctx, map[string]Handler{
		topic: func(_ context.Context, _ *Envelope, raw []byte) error {
			var e Envelope
			gotHeaders <- json.Unmarshal(raw, &e) == nil
			return nil
		},
	})
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}

	if err := producer.Publish(context.Background(), topic, "",
		map[string]any{"churchId": "church_a"}); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	select {
	case ok := <-gotHeaders:
		if !ok {
			t.Error("the raw payload should still decode as an envelope")
		}
	case <-time.After(30 * time.Second):
		t.Fatal("no event arrived")
	}
}

// A bus with no brokers must not error on publish. That keeps tests and a
// laptop without docker working — but it loses events, so it says so loudly.
func TestDisabledBusPublishesNothingAndDoesNotFail(t *testing.T) {
	bus, err := NewBus(context.Background(), Config{Source: "test"})
	if err != nil {
		t.Fatalf("a bus with no brokers must not be an error: %v", err)
	}
	if bus.Enabled() {
		t.Error("a bus with no brokers is not enabled")
	}
	if err := bus.Publish(context.Background(), "altar.test.v1", "church_a",
		map[string]any{"churchId": "church_a"}); err != nil {
		t.Errorf("publishing on a disabled bus should be a no-op: %v", err)
	}
	bus.Close()
}

// --- deduping ---------------------------------------------------------------

func newTestDeduper(t *testing.T) (*Deduper, *redis.Client) {
	t.Helper()

	addr := os.Getenv("REDIS_ADDR")
	if addr == "" {
		addr = "127.0.0.1:6379"
	}
	rdb := redis.NewClient(&redis.Options{Addr: addr, DB: 12})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		testsupport.SkipOrFail(t, "Redis", err)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = rdb.FlushDB(c).Err()
		_ = rdb.Close()
	})

	return NewDeduper(rdb, "test-group", nil), rdb
}

// §6: "a duplicate giving.completed must not send two receipts".
func TestDuplicateEventIsHandledOnce(t *testing.T) {
	deduper, _ := newTestDeduper(t)

	calls := 0
	handler := deduper.Wrap(func(context.Context, *Envelope, []byte) error {
		calls++
		return nil
	})

	e := &Envelope{ID: "evt_same", Type: "altar.giving.completed.v1", Subject: "church_a"}
	for i := 0; i < 5; i++ {
		if err := handler(context.Background(), e, nil); err != nil {
			t.Fatalf("delivery %d: %v", i+1, err)
		}
	}
	if calls != 1 {
		t.Fatalf("5 deliveries of one event ran the handler %d times, want 1", calls)
	}
}

func TestDistinctEventsAreBothHandled(t *testing.T) {
	deduper, _ := newTestDeduper(t)

	calls := 0
	handler := deduper.Wrap(func(context.Context, *Envelope, []byte) error {
		calls++
		return nil
	})

	for _, id := range []string{"evt_a", "evt_b", "evt_c"} {
		if err := handler(context.Background(), &Envelope{ID: id}, nil); err != nil {
			t.Fatalf("%s: %v", id, err)
		}
	}
	if calls != 3 {
		t.Fatalf("three distinct events ran the handler %d times, want 3", calls)
	}
}

// A failed handler must release its claim, or a transient SMS outage would
// permanently suppress the receipt — the exact failure this path exists to
// prevent.
func TestFailedHandlerReleasesItsClaim(t *testing.T) {
	deduper, _ := newTestDeduper(t)

	calls := 0
	handler := deduper.Wrap(func(context.Context, *Envelope, []byte) error {
		calls++
		if calls == 1 {
			return errors.New("the SMS provider is briefly down")
		}
		return nil
	})

	e := &Envelope{ID: "evt_retry"}
	if err := handler(context.Background(), e, nil); err == nil {
		t.Fatal("the first delivery should have failed")
	}

	seen, err := deduper.Seen(context.Background(), e.ID)
	if err != nil {
		t.Fatalf("Seen: %v", err)
	}
	if seen {
		t.Fatal("a failed handler must release its claim, or the redelivery is suppressed")
	}

	if err := handler(context.Background(), e, nil); err != nil {
		t.Fatalf("the retry should succeed: %v", err)
	}
	if calls != 2 {
		t.Errorf("handler ran %d times, want 2", calls)
	}
}

// Concurrent deliveries of one event must run the handler exactly once.
func TestConcurrentDuplicatesRunTheHandlerOnce(t *testing.T) {
	deduper, _ := newTestDeduper(t)

	var mu sync.Mutex
	calls := 0
	handler := deduper.Wrap(func(context.Context, *Envelope, []byte) error {
		mu.Lock()
		calls++
		mu.Unlock()
		return nil
	})

	e := &Envelope{ID: "evt_race"}
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = handler(context.Background(), e, nil)
		}()
	}
	wg.Wait()

	mu.Lock()
	defer mu.Unlock()
	if calls != 1 {
		t.Fatalf("16 concurrent deliveries ran the handler %d times, want 1", calls)
	}
}

// Two services consuming the same topic must each get their own chance at an
// event. A shared key would mean whichever consumed first suppressed the other.
func TestDedupeIsScopedPerConsumerGroup(t *testing.T) {
	_, rdb := newTestDeduper(t)

	notifications := NewDeduper(rdb, "notification", nil)
	analytics := NewDeduper(rdb, "analytics", nil)

	notificationCalls, analyticsCalls := 0, 0
	nHandler := notifications.Wrap(func(context.Context, *Envelope, []byte) error {
		notificationCalls++
		return nil
	})
	aHandler := analytics.Wrap(func(context.Context, *Envelope, []byte) error {
		analyticsCalls++
		return nil
	})

	e := &Envelope{ID: "evt_shared"}
	if err := nHandler(context.Background(), e, nil); err != nil {
		t.Fatalf("notification: %v", err)
	}
	if err := aHandler(context.Background(), e, nil); err != nil {
		t.Fatalf("analytics: %v", err)
	}

	if notificationCalls != 1 || analyticsCalls != 1 {
		t.Fatalf("each group should handle the event once, got notification=%d analytics=%d",
			notificationCalls, analyticsCalls)
	}
}

// A Redis outage must not stop every receipt in the platform. The downstream
// database constraints still prevent duplicates.
func TestRedisOutageFallsThroughToTheHandler(t *testing.T) {
	unreachable := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1"})
	t.Cleanup(func() { _ = unreachable.Close() })
	deduper := NewDeduper(unreachable, "test-group", nil)

	calls := 0
	handler := deduper.Wrap(func(context.Context, *Envelope, []byte) error {
		calls++
		return nil
	})

	if err := handler(context.Background(), &Envelope{ID: "evt_x"}, nil); err != nil {
		t.Fatalf("a Redis outage must not fail the handler: %v", err)
	}
	if calls != 1 {
		t.Fatalf("the handler should still have run, got %d calls", calls)
	}
}
