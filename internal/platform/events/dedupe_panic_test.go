package events

import (
	"context"
	"errors"
	"testing"
)

// A handler that panics must not permanently suppress its event.
//
// The interaction is subtle and was introduced by the panic recovery in
// Bus.handle: the recovery converts a panic into a failed record, so the
// offset is not committed and the message is redelivered — which is right.
// But the Deduper claimed the event id BEFORE calling the handler and only
// releases that claim on a returned error. A panic skips the release, so the
// redelivery finds the claim still held, treats the event as already handled,
// returns nil, and commits the offset.
//
// The member paid and never gets a receipt, for 24 hours, with the only
// evidence being one panic line in the log.
func TestPanickingHandlerDoesNotSuppressItsEvent(t *testing.T) {
	deduper, _ := newTestDeduper(t)

	calls := 0
	handler := deduper.Wrap(func(context.Context, *Envelope, []byte) error {
		calls++
		if calls == 1 {
			panic("the notification service fell over mid-request")
		}
		return nil
	})

	e := &Envelope{ID: "evt_panic", Type: TopicGivingCompleted, Subject: "church_a"}

	// First delivery panics. Wrap must not let the panic escape without
	// releasing the claim.
	func() {
		defer func() {
			if r := recover(); r == nil {
				t.Error("the panic should still reach the caller, so Bus.handle " +
					"records a failed record and the message is redelivered")
			}
		}()
		_ = handler(context.Background(), e, nil)
	}()

	seen, err := deduper.Seen(context.Background(), e.ID)
	if err != nil {
		t.Fatalf("Seen: %v", err)
	}
	if seen {
		t.Fatal("the claim is still held after a panic; the redelivery will be " +
			"skipped and the event lost for 24h")
	}

	// The redelivery must actually run the handler.
	if err := handler(context.Background(), e, nil); err != nil {
		t.Fatalf("redelivery: %v", err)
	}
	if calls != 2 {
		t.Fatalf("handler ran %d times, want 2 — the redelivery was suppressed", calls)
	}
}

// A returned error already released the claim; that behaviour must not regress.
func TestReturnedErrorStillReleasesTheClaim(t *testing.T) {
	deduper, _ := newTestDeduper(t)

	handler := deduper.Wrap(func(context.Context, *Envelope, []byte) error {
		return errors.New("transient")
	})

	e := &Envelope{ID: "evt_err"}
	if err := handler(context.Background(), e, nil); err == nil {
		t.Fatal("want the handler's error")
	}
	seen, _ := deduper.Seen(context.Background(), e.ID)
	if seen {
		t.Fatal("a returned error must release the claim")
	}
}
