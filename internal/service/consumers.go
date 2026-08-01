package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

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
	if d.Events == nil || !d.Events.Enabled() {
		d.Log.Warn("event consumers not started — no Kafka brokers configured; " +
			"giving receipts and member notifications will not be sent")
		return nil
	}

	notifications := newNotificationService(d)
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
