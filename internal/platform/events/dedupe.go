package events

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"
)

// DedupeTTL is how long a processed event id is remembered.
//
// 24h per §6. The window only needs to outlast redelivery, and redelivery
// happens within seconds — but a consumer that is down for a working day and
// then catches up replays everything since, so the window has to cover that
// too. Longer costs Redis memory proportional to event volume; shorter starts
// letting genuine duplicates through exactly when a service has been unhealthy.
const DedupeTTL = 24 * time.Hour

// dedupeKeyPrefix follows the codebase's Redis convention of
// namespace:purpose:id, matching otp:code:<phone> and revoked:jti:<jti>.
const dedupeKeyPrefix = "event:seen:"

// Deduper remembers which events have been handled.
//
// This is the bus-level half of idempotency, and it is not the only half. The
// notification service also has a unique index on its dedupe key, and finance
// has uq_idempotency. That redundancy is deliberate: Redis can be flushed, a
// key can expire under a slow consumer, and a new consumer group replays from
// the start — in every one of those cases the database constraint is what
// still stops a member receiving a second receipt. Redis makes the common case
// cheap; the database makes the rare case correct.
type Deduper struct {
	redis *redis.Client
	group string
	log   *slog.Logger
}

// NewDeduper builds a deduper for one consumer group.
//
// The group is part of the key because two services consuming the same topic
// must each get their own chance to handle an event. A shared key would mean
// whichever consumed first suppressed the other.
func NewDeduper(rdb *redis.Client, group string, log *slog.Logger) *Deduper {
	if log == nil {
		log = slog.Default()
	}
	return &Deduper{redis: rdb, group: group, log: log}
}

// Wrap returns a handler that runs the inner handler at most once per event id.
//
// The claim is made BEFORE the handler runs, using SetNX so two consumers
// racing the same event cannot both proceed. If the handler then fails, the
// claim is released so the redelivery can retry — otherwise a transient SMS
// provider outage would permanently suppress a receipt, which is the failure
// this whole path exists to prevent.
func (d *Deduper) Wrap(handler Handler) Handler {
	if d == nil || d.redis == nil {
		return handler
	}

	return func(ctx context.Context, e *Envelope, raw []byte) error {
		key := d.key(e.ID)

		claimed, err := d.redis.SetNX(ctx, key, "1", DedupeTTL).Result()
		if err != nil {
			// Redis is unreachable. Proceeding is the right call: the
			// downstream database constraints still prevent a duplicate, and
			// refusing to handle events because the deduplication cache is
			// down would stop every receipt in the platform over a cache
			// outage.
			d.log.Warn("dedupe check unavailable; relying on downstream idempotency",
				slog.String("event_id", e.ID),
				slog.String("error", err.Error()))
			return handler(ctx, e, raw)
		}

		if !claimed {
			d.log.Debug("event already handled; skipping",
				slog.String("event_id", e.ID),
				slog.String("type", e.Type))
			return nil
		}

		// A panic must release the claim too, and this is subtler than it
		// looks. Bus.handle recovers panics into a failed record, so the offset
		// is not committed and the message IS redelivered — but the claim above
		// was taken before the handler ran, and only the error path below
		// releases it. Without this, the redelivery finds the claim still held,
		// treats the event as already handled, returns nil, and commits the
		// offset: the member paid and never gets a receipt, for 24 hours, with
		// one panic line in the log as the only evidence.
		//
		// The panic is re-raised rather than swallowed, so Bus.handle still
		// records the failure and the redelivery still happens.
		defer func() {
			if p := recover(); p != nil {
				if delErr := d.redis.Del(ctx, key).Err(); delErr != nil {
					d.log.Error("handler panicked AND the dedupe claim could not "+
						"be released; this event is suppressed until the key expires",
						slog.String("event_id", e.ID),
						slog.String("error", delErr.Error()))
				}
				panic(p)
			}
		}()

		if err := handler(ctx, e, raw); err != nil {
			// Release the claim so the redelivery is not silently swallowed.
			// Best effort: if this fails the event is suppressed for 24h,
			// which is bad, but not as bad as leaving no record of the attempt.
			if delErr := d.redis.Del(ctx, key).Err(); delErr != nil {
				d.log.Error("could not release the dedupe claim; this event will "+
					"be suppressed until the key expires",
					slog.String("event_id", e.ID),
					slog.String("error", delErr.Error()))
			}
			return err
		}
		return nil
	}
}

// Seen reports whether an event has already been handled. For tests and
// diagnostics.
func (d *Deduper) Seen(ctx context.Context, eventID string) (bool, error) {
	if d == nil || d.redis == nil {
		return false, nil
	}
	n, err := d.redis.Exists(ctx, d.key(eventID)).Result()
	if err != nil {
		return false, fmt.Errorf("events: check dedupe: %w", err)
	}
	return n > 0, nil
}

func (d *Deduper) key(eventID string) string {
	return dedupeKeyPrefix + d.group + ":" + eventID
}

// maxAttempts is how often one event may fail before it is given up on.
//
// A consumer commits its offset only after the handler returns nil, so a
// message that fails permanently is retried forever and NOTHING BEHIND IT IS
// EVER PROCESSED. One member whose receipt cannot be sent stops the receipts
// for every other member on that partition, silently, with no error surfaced
// anywhere a person looks.
//
// That is not hypothetical. Account deletion erases a member's record while
// their giving.completed events may still be unprocessed or redelivered, so
// the product now has a routine way to create a permanently unsendable
// receipt.
//
// Six attempts, because the retries this protects against are genuinely
// transient — a database blip, a provider timeout — and six passes through a
// poll loop is long enough to ride one out while short enough that a partition
// is not stalled for hours.
const maxAttempts = 6

// attemptsKey counts failures for one event within one consumer group.
func (d *Deduper) attemptsKey(eventID string) string {
	return "events:attempts:" + d.group + ":" + eventID
}

// GiveUpAfterRepeatedFailure wraps a handler so a permanently failing message
// cannot block its partition.
//
// On failure the attempt is counted and the error is returned, so the offset
// stays uncommitted and the message is retried — the behaviour that makes a
// transient fault recoverable. Once the count passes maxAttempts the error is
// swallowed and the offset advances, with the event logged at ERROR in full so
// the loss is visible rather than silent.
//
// Dropping a message is a bad outcome. Blocking every message behind it
// forever is a worse one, and it is the outcome that hides.
func (d *Deduper) GiveUpAfterRepeatedFailure(handler Handler) Handler {
	if d == nil || d.redis == nil {
		return handler
	}
	return func(ctx context.Context, e *Envelope, raw []byte) error {
		err := handler(ctx, e, raw)
		if err == nil {
			// Succeeded: forget the count so a later, unrelated failure of the
			// same id starts from zero.
			d.redis.Del(ctx, d.attemptsKey(e.ID))
			return nil
		}

		n, incErr := d.redis.Incr(ctx, d.attemptsKey(e.ID)).Result()
		if incErr != nil {
			// Cannot count, so cannot safely give up. Retrying is the safe
			// direction: it risks a stall, not a lost receipt.
			return err
		}
		if n == 1 {
			d.redis.Expire(ctx, d.attemptsKey(e.ID), DedupeTTL)
		}
		if n <= maxAttempts {
			return err
		}

		d.log.Error("giving up on an event after repeated failures; the offset "+
			"will advance so later messages are not blocked",
			slog.String("event_id", e.ID),
			slog.String("topic", e.Type),
			slog.String("subject", e.Subject),
			slog.Int64("attempts", n),
			slog.String("last_error", err.Error()),
			slog.String("payload", string(raw)))
		return nil
	}
}
