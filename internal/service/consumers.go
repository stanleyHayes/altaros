package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/hayfordstanley/altar-os/internal/domain/church"
	"github.com/hayfordstanley/altar-os/internal/domain/notification"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/events"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// StartConsumers wires the event handlers and begins consuming.
//
// This is the half of the platform that was missing. Both sides of "a member
// gives and receives a receipt" were built and tested — finance emits
// giving.completed, notification knows how to turn one into an SMS — but
// nothing connected them, so the receipt could never fire however correct
// either half was on its own.
func StartConsumers(ctx context.Context, d *deps.Deps) error {
	notifications := newNotificationService(d)

	// The sweeper runs whether or not Kafka does: a message deferred for quiet
	// hours is queued by a direct call, not by an event, so tying its delivery
	// to the broker would mean a deployment without Kafka silently drops every
	// announcement sent after 21:00.
	go startNotificationSweeper(ctx, d, notifications)

	if d.Events == nil || !d.Events.Enabled() {
		d.Log.Warn("event consumers not started — no Kafka brokers configured; " +
			"giving receipts will not be sent")
		return nil
	}

	churches := church.NewService(d.Mongo)

	// Redis dedupe on the event id, per §6. This is the cheap first line; the
	// notification service's own unique dedupe key is what still holds if
	// Redis is flushed or a new consumer group replays from the start.
	deduper := events.NewDeduper(d.Redis, d.Config.Kafka.ConsumerGroup, d.Log)

	handlers := map[string]events.Handler{
		events.TopicGivingCompleted: deduper.Wrap(givingReceiptHandler(d, notifications, churches)),
	}

	if err := d.Events.Consume(ctx, handlers); err != nil {
		return fmt.Errorf("service: start consumers: %w", err)
	}

	// The relay delivers anything Kafka refused at publish time. Without it an
	// outbox row is written and never sent, which is the same lost event with
	// an extra step.
	if d.Outbox != nil {
		go events.NewRelay(d.Outbox, d.Events, d.Log).Run(ctx)
	}
	return nil
}

// givingReceiptHandler turns a completed gift into an SMS receipt.
//
// Returning an error leaves the Kafka offset uncommitted, so the event is
// redelivered. That is the right behaviour for a transient failure (the SMS
// provider is briefly down) and the wrong one for a permanent failure (the
// member does not exist) — so the two are separated below. Retrying a
// permanent failure forever blocks the partition behind it.
func givingReceiptHandler(d *deps.Deps, notifications *notification.Service, churches *church.Service) events.Handler {
	return func(ctx context.Context, e *events.Envelope, raw []byte) error {
		var payload struct {
			Data struct {
				TransactionID string `json:"transactionId"`
				ChurchID      string `json:"churchId"`
				MemberID      string `json:"memberId"`
				Type          string `json:"type"`
				Channel       string `json:"channel"`
				GrossMinor    int64  `json:"grossMinor"`
				LevyMinor     int64  `json:"levyMinor"`
				NetMinor      int64  `json:"netMinor"`
				Currency      string `json:"currency"`
			} `json:"data"`
		}
		if err := json.Unmarshal(raw, &payload); err != nil {
			// Unparseable now is unparseable forever. Log and acknowledge
			// rather than blocking every later gift behind it.
			d.Log.Error("giving.completed payload could not be read; skipping",
				slog.String("event_id", e.ID),
				slog.String("error", err.Error()))
			return nil
		}

		gift := payload.Data
		if gift.MemberID == "" {
			// Anonymous giving is a supported flow, not a missing field.
			return nil
		}
		if gift.ChurchID == "" {
			d.Log.Error("giving.completed carried no church; cannot scope the receipt",
				slog.String("event_id", e.ID))
			return nil
		}

		// The envelope subject is the partition key and the payload carries the
		// church; for anything this platform publishes they are the same value
		// by construction. Asserting it catches a publisher that forgot to put
		// churchId in its payload — which is exactly the defect consent and
		// member.status_changed had — and refuses to act on a message whose two
		// tenant claims disagree, rather than picking one.
		if e.Subject != "" && e.Subject != gift.ChurchID {
			d.Log.Error("event subject and payload church disagree; refusing to write",
				slog.String("event_id", e.ID),
				slog.String("subject", e.Subject),
				slog.String("payload_church", gift.ChurchID))
			return nil
		}

		// The event arrived from Kafka with no session, so the church comes
		// from the event and every write happens inside its scope. The actor
		// is the system: attributing this to a person would put a false actor
		// in the audit trail.
		scoped := tenancy.WithScope(ctx, tenancy.Scope{
			ChurchID: gift.ChurchID,
			UserID:   "system:giving-receipt",
			Role:     "SYSTEM",
		})

		// The church's name goes on the receipt. A failure to read it is not
		// worth losing the receipt over — the message degrades to "your
		// church" rather than not arriving.
		churchName := ""
		if churches != nil {
			if ch, err := churches.ByID(scoped, gift.ChurchID); err == nil {
				churchName = ch.Name
			}
		}

		n, err := notifications.SendGivingReceipt(scoped, notification.GivingCompleted{
			TransactionID: gift.TransactionID,
			ChurchID:      gift.ChurchID,
			MemberID:      gift.MemberID,
			Type:          gift.Type,
			Channel:       gift.Channel,
			GrossMinor:    gift.GrossMinor,
			LevyMinor:     gift.LevyMinor,
			NetMinor:      gift.NetMinor,
			Currency:      gift.Currency,
			ChurchName:    churchName,
		})
		if err != nil {
			// Transient: leave the offset uncommitted so this is retried.
			return fmt.Errorf("send giving receipt for %s: %w", gift.TransactionID, err)
		}

		if n != nil {
			d.Log.Info("giving receipt processed",
				slog.String("transaction_id", gift.TransactionID),
				slog.String("status", string(n.Status)),
				slog.String("reason", n.Reason))
		}
		return nil
	}
}

// notificationSweepInterval is how often deferred and failed messages are
// re-attempted.
//
// A minute is short enough that a message held for quiet hours goes out within
// a minute of the window closing, and long enough that a platform of a few
// thousand churches is doing one small indexed query a minute rather than
// hammering MongoDB.
const notificationSweepInterval = time.Minute

// startNotificationSweeper re-attempts messages that are due.
//
// Two things queue a message and then depend entirely on this loop:
// an announcement deferred past quiet hours (sent at 23:00, scheduled for
// 07:00) and a send that failed transiently and backed off. Both were being
// written to the database and then never looked at again — notification.Retry
// existed, was tested, and had no production caller, so a message deferred at
// 23:00 was simply never sent.
//
// The sweeper runs without a tenant, which is why it asks which churches have
// work before doing any: it re-enters each church's scope to retry, so nothing
// crosses a tenant boundary just because the timer has no request behind it.
func startNotificationSweeper(ctx context.Context, d *deps.Deps, notifications *notification.Service) {
	ticker := time.NewTicker(notificationSweepInterval)
	defer ticker.Stop()

	d.Log.Info("notification sweeper started",
		slog.Duration("interval", notificationSweepInterval))

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			sweepOnce(ctx, d, notifications)
		}
	}
}

func sweepOnce(ctx context.Context, d *deps.Deps, notifications *notification.Service) {
	churches, err := notifications.PendingChurches(ctx)
	if err != nil {
		d.Log.Error("could not find churches with due messages",
			slog.String("error", err.Error()))
		return
	}
	if len(churches) == 0 {
		return
	}

	sent := 0
	for _, churchID := range churches {
		scoped := tenancy.WithScope(ctx, tenancy.Scope{
			ChurchID: churchID,
			UserID:   "system:notification-sweeper",
			Role:     "SYSTEM",
		})

		n, err := notifications.Retry(scoped, 100)
		if err != nil {
			// One church's problem must not stop the others: a single church
			// with a malformed record would otherwise hold up every deferred
			// announcement on the platform.
			d.Log.Error("notification retry failed for a church",
				slog.String("church_id", churchID),
				slog.String("error", err.Error()))
			continue
		}
		sent += n
	}

	if sent > 0 {
		d.Log.Info("deferred notifications sent",
			slog.Int("sent", sent),
			slog.Int("churches", len(churches)))
	}
}
