package events

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"testing"

	"github.com/redis/go-redis/v9"

	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

// A consumer commits its offset only after the handler returns nil. So a
// message that can never succeed is retried forever and everything behind it
// on that partition is never processed — one member's unsendable receipt stops
// the receipts for every other member, silently.

func giveUpDeduper(t *testing.T) *Deduper {
	t.Helper()
	addr := os.Getenv("REDIS_ADDR")
	if addr == "" {
		addr = "127.0.0.1:6379"
	}
	rdb := redis.NewClient(&redis.Options{Addr: addr})
	if err := rdb.Ping(context.Background()).Err(); err != nil {
		testsupport.SkipOrFail(t, "Redis", err)
	}
	t.Cleanup(func() { _ = rdb.Close() })

	d := NewDeduper(rdb, "giveup-test-"+t.Name(), slog.New(
		slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError})))

	// The counter lives in Redis under a key derived from the test name and a
	// fixed event id, and it OUTLIVES the process. Without this the first run
	// passed and every run after it failed at the first attempt, having
	// inherited a count already at the limit — a test that reports a
	// give-up-too-early bug that is not in the code. Clearing before and after
	// makes each run start from zero whatever the last one left behind.
	clear := func() {
		for _, name := range []string{
			"evt-poison-" + t.Name(), "evt-recover-" + t.Name(),
		} {
			_ = rdb.Del(context.Background(), d.attemptsKey(name)).Err()
			_ = rdb.Del(context.Background(), d.key(name)).Err()
		}
	}
	clear()
	t.Cleanup(clear)
	return d
}

func TestAPermanentlyFailingEventStopsBlockingThePartition(t *testing.T) {
	d := giveUpDeduper(t)
	boom := errors.New("this member no longer exists")

	var calls int
	wrapped := d.GiveUpAfterRepeatedFailure(func(context.Context, *Envelope, []byte) error {
		calls++
		return boom
	})

	e := &Envelope{ID: "evt-poison-" + t.Name(), Type: "altar.giving.completed.v1"}
	ctx := context.Background()

	// While it might still be transient, the error propagates so the offset
	// stays put and the message is retried. That is what makes a database blip
	// survivable.
	var lastErr error
	for i := 0; i < maxAttempts; i++ {
		lastErr = wrapped(ctx, e, []byte(`{}`))
		if lastErr == nil {
			t.Fatalf("gave up after %d attempts; a transient fault would be "+
				"treated as permanent and the receipt lost", i+1)
		}
	}

	// Past the limit it is acknowledged, so the partition moves on.
	if err := wrapped(ctx, e, []byte(`{}`)); err != nil {
		t.Fatalf("still failing after %d attempts — every later receipt on this "+
			"partition is blocked behind it forever", maxAttempts+1)
	}
	if calls != maxAttempts+1 {
		t.Errorf("handler ran %d times, want %d", calls, maxAttempts+1)
	}
}

// A handler that succeeds must never be given up on, and its count must reset
// so an unrelated later failure starts from zero rather than inheriting it.
func TestSuccessClearsTheFailureCount(t *testing.T) {
	d := giveUpDeduper(t)
	e := &Envelope{ID: "evt-recover-" + t.Name(), Type: "altar.giving.completed.v1"}
	ctx := context.Background()

	fail := true
	wrapped := d.GiveUpAfterRepeatedFailure(func(context.Context, *Envelope, []byte) error {
		if fail {
			return errors.New("temporary")
		}
		return nil
	})

	for i := 0; i < maxAttempts-1; i++ {
		if err := wrapped(ctx, e, []byte(`{}`)); err == nil {
			t.Fatalf("gave up early, at attempt %d", i+1)
		}
	}
	fail = false
	if err := wrapped(ctx, e, []byte(`{}`)); err != nil {
		t.Fatalf("a recovered handler still errored: %v", err)
	}

	// The count is cleared, so it gets the full allowance again.
	fail = true
	for i := 0; i < maxAttempts; i++ {
		if err := wrapped(ctx, e, []byte(`{}`)); err == nil {
			t.Fatalf("the failure count survived a success; gave up at attempt %d "+
				"instead of %d", i+1, maxAttempts+1)
		}
	}
}

// Redis being unavailable must not cause a message to be dropped. Retrying
// risks a stall; giving up risks losing a receipt, and a lost receipt is the
// worse failure to choose by accident.
func TestWithoutRedisItRetriesRatherThanDropping(t *testing.T) {
	var none *Deduper
	called := 0
	wrapped := none.GiveUpAfterRepeatedFailure(func(context.Context, *Envelope, []byte) error {
		called++
		return errors.New("boom")
	})
	if err := wrapped(context.Background(), &Envelope{ID: "x"}, nil); err == nil {
		t.Error("a nil deduper swallowed the error, silently dropping the event")
	}
	if called != 1 {
		t.Errorf("handler ran %d times", called)
	}
}
