package events

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kerr"
	"github.com/twmb/franz-go/pkg/kgo"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"

	"github.com/hayfordstanley/altar-os/internal/platform/tracing"
)

// Config configures the bus.
type Config struct {
	Brokers []string
	// ConsumerGroup is per-service, so each service tracks its own offsets and
	// a slow consumer cannot hold up an unrelated one.
	ConsumerGroup string
	// Source names this service in the envelope.
	Source string
	Log    *slog.Logger
}

// Bus is a Kafka-backed event bus.
type Bus struct {
	client  *kgo.Client
	source  string
	log     *slog.Logger
	brokers []string
	group   string

	// enabled is false when no brokers are configured. Publishing then becomes
	// a logged no-op rather than an error — see the note on NewBus.
	enabled bool

	// outbox catches events that could not be published. Optional: without it
	// a broker outage loses the event, which is what this whole type exists to
	// stop, so production always sets it.
	outbox *Outbox

	consumeOnce sync.Once
	cancel      context.CancelFunc
	wg          sync.WaitGroup
}

var _ Publisher = (*Bus)(nil)

// NewBus connects to Kafka.
//
// With no brokers configured the bus is returned disabled: publishing logs and
// succeeds. That is deliberate and narrow — it keeps `go test` and a laptop
// without docker working — but it is the same shape as the payment stub this
// codebase exists to be suspicious of, so the distinction matters: a disabled
// bus loses NOTIFICATIONS, not money, and it says so at WARN on every publish.
// Production always configures brokers, and WP-05's fail-fast is the thing
// that guarantees it.
func NewBus(ctx context.Context, cfg Config) (*Bus, error) {
	brokers := nonEmpty(cfg.Brokers)
	log := cfg.Log
	if log == nil {
		log = slog.Default()
	}

	if len(brokers) == 0 {
		return &Bus{source: cfg.Source, log: log, enabled: false}, nil
	}

	opts := []kgo.Opt{
		kgo.SeedBrokers(brokers...),
		kgo.ClientID("altar-" + cfg.Source),
		// Idempotent production is on by default in franz-go; stating it makes
		// the guarantee visible. It stops a broker-side retry from writing the
		// same record twice within a session.
		kgo.ProducerBatchCompression(kgo.SnappyCompression()),
		kgo.RequestTimeoutOverhead(10 * time.Second),
	}
	if cfg.ConsumerGroup != "" {
		opts = append(opts,
			kgo.ConsumerGroup(cfg.ConsumerGroup),
			// Manual commit: the offset moves only after the handler returns
			// nil. With auto-commit, a message consumed and then dropped by a
			// crash is never redelivered — which for a giving receipt means a
			// member who paid and was never told.
			kgo.DisableAutoCommit(),
			// A new group starts at the beginning so a consumer deployed after
			// an event was published still sees it. Starting at the end would
			// silently skip everything that happened before the first deploy.
			kgo.ConsumeResetOffset(kgo.NewOffset().AtStart()),
		)
	}

	client, err := kgo.NewClient(opts...)
	if err != nil {
		return nil, fmt.Errorf("events: build kafka client: %w", err)
	}

	// Fail at boot rather than on the first publish, consistent with how Mongo
	// and Redis are verified in deps.Build.
	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx); err != nil {
		client.Close()
		return nil, fmt.Errorf("events: reach kafka at %s: %w", strings.Join(brokers, ","), err)
	}

	return &Bus{
		client:  client,
		source:  cfg.Source,
		log:     log,
		brokers: brokers,
		group:   cfg.ConsumerGroup,
		enabled: true,
	}, nil
}

// Enabled reports whether events actually reach Kafka.
func (b *Bus) Enabled() bool { return b != nil && b.enabled }

// WithOutbox attaches an outbox, so a publish that Kafka refuses is queued for
// the relay rather than lost.
func (b *Bus) WithOutbox(o *Outbox) *Bus {
	if b != nil {
		b.outbox = o
	}
	return b
}

// Publish emits a domain event.
//
// The key is the church id, per §6: Kafka orders within a partition, so this
// is what guarantees one church's events arrive in the order they happened.
func (b *Bus) Publish(ctx context.Context, topic, key string, payload any) error {
	if b == nil {
		return nil
	}

	envelope, err := NewEnvelope(b.source, topic, keyOrSubject(key, payload), payload)
	if err != nil {
		return err
	}

	if !b.enabled {
		// Loud on purpose. A silently dropped event is how a receipt goes
		// missing with nothing in the logs to explain it.
		b.log.Warn("event NOT published — no Kafka brokers configured",
			slog.String("topic", topic),
			slog.String("event_id", envelope.ID))
		return nil
	}

	ctx, span := tracing.Start(ctx, "kafka.publish "+topic, trace.WithSpanKind(trace.SpanKindProducer))
	defer span.End()
	span.SetAttributes(
		attribute.String("messaging.system", "kafka"),
		attribute.String("messaging.destination.name", topic),
		attribute.String("messaging.message.id", envelope.ID),
		attribute.String(tracing.AttrChurchID, envelope.Subject),
	)

	body, err := json.Marshal(envelope)
	if err != nil {
		return fmt.Errorf("events: encode %s: %w", topic, err)
	}

	record := &kgo.Record{
		Topic: topic,
		Key:   []byte(envelope.Subject),
		Value: body,
		Headers: append(traceHeaders(ctx),
			kgo.RecordHeader{Key: "ce_id", Value: []byte(envelope.ID)},
			kgo.RecordHeader{Key: "ce_type", Value: []byte(envelope.Type)},
			kgo.RecordHeader{Key: "ce_source", Value: []byte(envelope.Source)},
		),
	}

	// Synchronous produce. The alternative is fire-and-forget, which returns
	// before Kafka has the record and turns a broker outage into a caller that
	// believes it published. The caller is already inside a request; one more
	// round trip is cheaper than an event that silently never existed.
	if err := b.client.ProduceSync(ctx, record).FirstErr(); err != nil {
		span.RecordError(err)

		// Kafka refused. The domain state is already committed, so returning
		// an error here would leave the caller with a settled transaction and
		// a lost event — the dual-write failure this outbox exists for. Queue
		// it and let the relay deliver when the broker recovers.
		if b.outbox != nil {
			if saveErr := b.outbox.Save(ctx, envelope); saveErr == nil {
				b.log.Warn("kafka unavailable; event queued for the outbox relay",
					slog.String("topic", topic),
					slog.String("event_id", envelope.ID),
					slog.String("error", err.Error()))
				return nil
			} else {
				b.log.Error("kafka unavailable AND the event could not be queued; "+
					"it is lost",
					slog.String("topic", topic),
					slog.String("event_id", envelope.ID),
					slog.String("publish_error", err.Error()),
					slog.String("outbox_error", saveErr.Error()))
			}
		}
		return fmt.Errorf("events: publish %s: %w", topic, err)
	}

	b.log.Debug("event published",
		slog.String("topic", topic),
		slog.String("event_id", envelope.ID),
		slog.String("church_id", envelope.Subject))
	return nil
}

// keyOrSubject prefers the caller's key, falling back to a churchId field on
// the payload.
//
// Domains call Publish with the entity id as the key (that is what their
// existing code does), but §6 requires the CHURCH id — so the payload's
// churchId wins when present. Getting this backwards would partition by
// member and lose per-church ordering.
func keyOrSubject(key string, payload any) string {
	if m, ok := payload.(map[string]any); ok {
		if churchID, ok := m["churchId"].(string); ok && churchID != "" {
			return churchID
		}
	}
	return key
}

// Consume runs handlers until the context is cancelled.
//
// One handler per topic. A handler returning an error leaves the offset
// uncommitted, so the message is redelivered — which is why §6 requires
// consumers to be idempotent.
func (b *Bus) Consume(ctx context.Context, handlers map[string]Handler) error {
	if b == nil || !b.enabled {
		return nil
	}
	if b.group == "" {
		return errors.New("events: consuming requires a consumer group")
	}
	if len(handlers) == 0 {
		return nil
	}

	topics := make([]string, 0, len(handlers))
	for topic := range handlers {
		topics = append(topics, topic)
	}
	b.client.AddConsumeTopics(topics...)

	consumeCtx, cancel := context.WithCancel(ctx)
	b.cancel = cancel

	b.wg.Add(1)
	go func() {
		defer b.wg.Done()
		b.loop(consumeCtx, handlers)
	}()

	b.log.Info("consuming events",
		slog.String("group", b.group),
		slog.Any("topics", topics))
	return nil
}

func (b *Bus) loop(ctx context.Context, handlers map[string]Handler) {
	for {
		fetches := b.client.PollFetches(ctx)
		if fetches.IsClientClosed() || ctx.Err() != nil {
			return
		}

		fetches.EachError(func(topic string, partition int32, err error) {
			// Log and continue: one unhealthy partition must not stop the
			// others, and PollFetches will retry it.
			b.log.Error("fetch error",
				slog.String("topic", topic),
				slog.Int("partition", int(partition)),
				slog.String("error", err.Error()))
		})

		// The earliest offset that failed, per partition. Not committing is
		// necessary but NOT sufficient: the client has already advanced its own
		// read position, so an uncommitted offset is only redelivered after a
		// restart or rebalance. A transient SMS outage would otherwise strand
		// the receipt until the pod happened to restart. Rewinding is what
		// makes redelivery actually happen.
		failed := map[string]map[int32]kgo.EpochOffset{}
		fetches.EachRecord(func(r *kgo.Record) {
			if err := b.handle(ctx, handlers, r); err == nil {
				return
			}
			byPartition, ok := failed[r.Topic]
			if !ok {
				byPartition = map[int32]kgo.EpochOffset{}
				failed[r.Topic] = byPartition
			}
			// Keep the EARLIEST failure: rewinding to a later one would skip
			// the records between, which is the loss this exists to prevent.
			if existing, seen := byPartition[r.Partition]; !seen || r.Offset < existing.Offset {
				byPartition[r.Partition] = kgo.EpochOffset{
					Epoch:  r.LeaderEpoch,
					Offset: r.Offset,
				}
			}
		})

		if len(failed) > 0 {
			b.client.SetOffsets(failed)
			// Back off before the retry. Without this a permanently failing
			// handler spins as fast as the broker can serve it, which turns
			// one bad message into sustained load on both Kafka and whatever
			// dependency is already struggling.
			select {
			case <-ctx.Done():
				return
			case <-time.After(retryBackoff):
			}
			continue
		}

		if err := b.client.CommitUncommittedOffsets(ctx); err != nil && ctx.Err() == nil {
			b.log.Error("could not commit offsets; messages will be redelivered",
				slog.String("error", err.Error()))
		}
	}
}

// retryBackoff is the pause before re-fetching records whose handler failed.
//
// Short enough that a receipt delayed by a brief provider outage still arrives
// while the giver is looking at their phone; long enough that a permanently
// failing handler does not saturate the broker.
const retryBackoff = 2 * time.Second

func (b *Bus) handle(ctx context.Context, handlers map[string]Handler, r *kgo.Record) (err error) {
	handler, ok := handlers[r.Topic]
	if !ok {
		return nil
	}

	// A panic in a handler runs on the consumer goroutine, and an unrecovered
	// panic there takes down the entire process — so one malformed event would
	// crash every replica, repeatedly, as each restart re-reads it. Recovering
	// converts that into a failed record: the offset is not committed, the
	// message is retried, and if it panics forever it does so on one partition
	// instead of taking the platform with it.
	defer func() {
		if p := recover(); p != nil {
			b.log.Error("handler panicked; the event will be retried",
				slog.String("topic", r.Topic),
				slog.Int64("offset", r.Offset),
				slog.Any("panic", p),
				slog.String("stack", string(debug.Stack())))
			err = fmt.Errorf("events: handler panicked on %s: %v", r.Topic, p)
		}
	}()

	// Continue the producer's trace rather than starting a new one, so a gift
	// and the receipt it triggers sit on one trace.
	ctx = extractTrace(ctx, r)
	ctx, span := tracing.Start(ctx, "kafka.consume "+r.Topic, trace.WithSpanKind(trace.SpanKindConsumer))
	defer span.End()
	span.SetAttributes(
		attribute.String("messaging.system", "kafka"),
		attribute.String("messaging.source.name", r.Topic),
	)

	var envelope Envelope
	if err := json.Unmarshal(r.Value, &envelope); err != nil {
		// A message we cannot parse will never parse. Retrying it forever
		// blocks the partition behind it, so it is logged and skipped —
		// the offset advances and the payload is in the log for a human.
		b.log.Error("skipping unparseable event",
			slog.String("topic", r.Topic),
			slog.String("error", err.Error()),
			slog.String("payload", truncate(r.Value)))
		span.RecordError(err)
		return nil
	}
	span.SetAttributes(
		attribute.String("messaging.message.id", envelope.ID),
		attribute.String(tracing.AttrChurchID, envelope.Subject),
	)

	if err := handler(ctx, &envelope, r.Value); err != nil {
		b.log.Error("handler failed; the event will be redelivered",
			slog.String("topic", r.Topic),
			slog.String("event_id", envelope.ID),
			slog.String("error", err.Error()))
		span.RecordError(err)
		return err
	}
	return nil
}

// EnsureTopics creates the platform's topics if they do not exist.
//
// The broker has auto-creation disabled, which is right — it turns a typo in a
// topic name into a silently created topic nobody consumes. The consequence is
// that topics must be provisioned, and doing it at boot follows the same
// reasoning as EnsureIndexes: a step someone must remember to run is a step
// that eventually does not get run.
//
// A broker that refuses (a managed Kafka where the service account cannot
// create topics) is logged, not fatal — provisioning there is an ops action
// and the service should still start.
func (b *Bus) EnsureTopics(ctx context.Context, topics []string, partitions int32, replication int16) error {
	if b == nil || !b.enabled {
		return nil
	}
	if partitions <= 0 {
		partitions = 3
	}
	if replication <= 0 {
		replication = 1
	}

	admin := kadm.NewClient(b.client)
	existing, err := admin.ListTopics(ctx)
	if err != nil {
		b.log.Warn("could not list topics; assuming they are provisioned",
			slog.String("error", err.Error()))
		return nil
	}

	var missing []string
	for _, topic := range topics {
		if !existing.Has(topic) {
			missing = append(missing, topic)
		}
	}
	if len(missing) == 0 {
		return nil
	}

	resp, err := admin.CreateTopics(ctx, partitions, replication, nil, missing...)
	if err != nil {
		b.log.Warn("could not create topics; they may need provisioning by an operator",
			slog.Any("topics", missing),
			slog.String("error", err.Error()))
		return nil
	}
	for _, r := range resp {
		if r.Err != nil {
			// TOPIC_ALREADY_EXISTS is a race with another replica starting at
			// the same moment, not a failure: the topic is there either way.
			if errors.Is(r.Err, kerr.TopicAlreadyExists) {
				continue
			}
			b.log.Warn("topic not created; it may need provisioning by an operator",
				slog.String("topic", r.Topic),
				slog.String("error", r.Err.Error()))
			continue
		}
		b.log.Info("topic created", slog.String("topic", r.Topic))
	}
	return nil
}

// Close stops consuming and releases the client.
func (b *Bus) Close() {
	if b == nil {
		return
	}
	if b.cancel != nil {
		b.cancel()
	}
	b.wg.Wait()
	if b.client != nil {
		// Flushes pending produces and leaves the consumer group cleanly, so a
		// rolling deploy triggers one rebalance rather than waiting out the
		// session timeout.
		b.client.Close()
	}
}

// traceHeaders injects the current trace context into Kafka headers.
func traceHeaders(ctx context.Context) []kgo.RecordHeader {
	carrier := propagation.MapCarrier{}
	otel.GetTextMapPropagator().Inject(ctx, carrier)

	headers := make([]kgo.RecordHeader, 0, len(carrier))
	for k, v := range carrier {
		headers = append(headers, kgo.RecordHeader{Key: k, Value: []byte(v)})
	}
	return headers
}

// extractTrace recovers the producer's trace context from Kafka headers.
func extractTrace(ctx context.Context, r *kgo.Record) context.Context {
	carrier := propagation.MapCarrier{}
	for _, h := range r.Headers {
		carrier[h.Key] = string(h.Value)
	}
	return otel.GetTextMapPropagator().Extract(ctx, carrier)
}

func nonEmpty(in []string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		if trimmed := strings.TrimSpace(s); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func truncate(b []byte) string {
	const limit = 500
	if len(b) > limit {
		return string(b[:limit]) + "…"
	}
	return string(b)
}

// publishRaw sends an already-encoded envelope. Used by the outbox relay,
// which must send exactly the bytes that were recorded rather than a
// re-encoding of a payload whose meaning may have moved on since.
func (b *Bus) publishRaw(ctx context.Context, topic, key string, body []byte) error {
	if b == nil || !b.enabled {
		return errors.New("events: bus is not enabled")
	}
	record := &kgo.Record{
		Topic:   topic,
		Key:     []byte(key),
		Value:   body,
		Headers: traceHeaders(ctx),
	}
	if err := b.client.ProduceSync(ctx, record).FirstErr(); err != nil {
		return fmt.Errorf("events: relay publish %s: %w", topic, err)
	}
	return nil
}
