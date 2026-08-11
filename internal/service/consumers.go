package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/hayfordstanley/altar-os/internal/domain/church"
	"github.com/hayfordstanley/altar-os/internal/domain/discipleship"
	"github.com/hayfordstanley/altar-os/internal/domain/notification"
	"github.com/hayfordstanley/altar-os/internal/domain/privacy"
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

	// The escalation sweeper, for the same reason. WP-34's criterion is that
	// an untouched follow-up "escalates if untouched", and an escalation that
	// only happens when somebody opens a page is a report rather than a
	// process — the whole point is that it fires when nobody is looking.
	go startEscalationSweeper(ctx, d)

	// The purge sweeper. Without it a deleted account stays locked forever
	// with every record intact — deactivation dressed as deletion, which is
	// what App Store 5.1.1(v) rejects and Act 843 s.33 does not permit.
	go startPurgeSweeper(ctx, d)

	// Retention (Act 843 s.24). A policy nothing enforces is a document, not
	// a control.
	go startRetentionSweeper(ctx, d)

	// Recordings expire on their own schedule: a recorded service is sensitive
	// personal data under Act 843 s.1, and its retention is enforced rather
	// than left to a settings page nobody re-reads.
	go startRecordingRetention(ctx, d)

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
		// Dedupe first (do the work once), then bound the retries so a
		// message that can never succeed cannot stall the partition and
		// silently stop every later receipt.
		events.TopicGivingCompleted: deduper.GiveUpAfterRepeatedFailure(
			deduper.Wrap(givingReceiptHandler(d, notifications, churches))),
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

// escalationSweepInterval is how often overdue follow-up is escalated.
//
// Far longer than the notification sweep because the SLAs are measured in days:
// a first-timer's 48 hours does not need checking every minute, and a tighter
// loop would only produce more queries for the same answer. Fifteen minutes
// bounds the lateness of an escalation to a quarter of an hour on a two-day
// deadline, which nobody will notice.
const escalationSweepInterval = 15 * time.Minute

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

// startEscalationSweeper escalates follow-up nobody has touched (WP-34).
//
// Runs without a tenant, so it asks which churches have work before doing any
// and re-enters each church's scope to act — the same shape as the notification
// sweeper, and for the same reason: a timer has no request behind it, and
// nothing should cross a tenant boundary just because a clock ticked.
func startEscalationSweeper(ctx context.Context, d *deps.Deps) {
	svc := discipleship.NewService(d.Mongo)
	ticker := time.NewTicker(escalationSweepInterval)
	defer ticker.Stop()

	d.Log.Info("discipleship escalation sweeper started",
		slog.Duration("interval", escalationSweepInterval))

	// Once at start, then on the ticker. Without this a pod that restarts more
	// often than the interval — a crash loop, a busy deploy day — never sweeps
	// at all, and the symptom is silence rather than an error. Concurrent
	// sweeps across replicas are already safe: the escalating update is
	// conditional on the task still being open.
	escalateOnce(ctx, d, svc)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			escalateOnce(ctx, d, svc)
		}
	}
}

func escalateOnce(ctx context.Context, d *deps.Deps, svc *discipleship.Service) {
	churches, err := svc.ChurchesWithOverdueTasks(ctx)
	if err != nil {
		d.Log.Error("could not find churches with overdue follow-up",
			slog.String("error", err.Error()))
		return
	}
	if len(churches) == 0 {
		return
	}

	escalated := 0
	for _, churchID := range churches {
		scoped := tenancy.WithScope(ctx, tenancy.Scope{
			ChurchID: churchID,
			UserID:   "system:escalation-sweeper",
			Role:     "SYSTEM",
		})

		// A nil escalator: who a task escalates TO is a church's org chart,
		// which nothing models yet. The status still changes and the task
		// still surfaces as escalated-and-untouched, which is the number a
		// pastor needs — it simply does not change hands automatically.
		res, err := svc.EscalateOverdue(scoped, nil)
		if err != nil {
			// One church's problem must not stop the others.
			d.Log.Error("escalation failed for a church",
				slog.String("church_id", churchID),
				slog.String("error", err.Error()))
			continue
		}
		escalated += res.Escalated
	}

	if escalated > 0 {
		d.Log.Info("follow-up escalated",
			slog.Int("tasks", escalated), slog.Int("churches", len(churches)))
	}
}

// purgeSweepInterval is how often expired deletions are executed.
//
// Hourly. The grace period is thirty days, so the cost of being up to an hour
// late is nothing, and a tighter loop would only run the same query more often
// for the same answer.
const purgeSweepInterval = time.Hour

// startPurgeSweeper destroys the data behind deletions whose grace period has
// expired (privacy.GracePeriod).
func startPurgeSweeper(ctx context.Context, d *deps.Deps) {
	svc := privacy.NewService(d.Mongo, d.Tokens)
	ticker := time.NewTicker(purgeSweepInterval)
	defer ticker.Stop()

	d.Log.Info("privacy purge sweeper started",
		slog.Duration("interval", purgeSweepInterval),
		slog.Duration("grace_period", privacy.GracePeriod))

	// Once at start, then on the ticker: a pod restarting more often than the
	// interval would otherwise never sweep, and the symptom is silence.
	purgeOnce(ctx, d, svc)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			purgeOnce(ctx, d, svc)
		}
	}
}

func purgeOnce(ctx context.Context, d *deps.Deps, svc *privacy.Service) {
	churches, err := svc.ChurchesWithDuePurges(ctx)
	if err != nil {
		d.Log.Error("could not find churches with due deletions",
			slog.String("error", err.Error()))
		return
	}
	if len(churches) == 0 {
		return
	}

	purged := 0
	for _, churchID := range churches {
		scoped := tenancy.WithScope(ctx, tenancy.Scope{
			ChurchID: churchID,
			UserID:   "system:purge-sweeper",
			Role:     "SYSTEM",
		})
		res, err := svc.PurgeDue(scoped)
		if err != nil {
			// One church's problem must not stop the others.
			d.Log.Error("purge failed for a church",
				slog.String("church_id", churchID),
				slog.String("error", err.Error()))
			continue
		}
		purged += res.Purged
	}

	if purged > 0 {
		// Logged because this is irreversible and somebody may need to prove
		// when it happened.
		d.Log.Info("accounts purged after their grace period",
			slog.Int("accounts", purged), slog.Int("churches", len(churches)))
	}
}

// retentionSweepInterval is how often decided retention periods are enforced.
//
// Daily. The shortest period in the policy is a year, so running more often
// would issue the same deletes against the same empty result set; running less
// often would let a category sit past its decided life for weeks.
const retentionSweepInterval = 24 * time.Hour

// startRetentionSweeper enforces privacy.RetentionPolicy for every church.
//
// Per church, because the collections are tenant-scoped: an unscoped delete
// here would cross every church on the platform at once, which is the single
// most destructive thing this codebase could do.
func startRetentionSweeper(ctx context.Context, d *deps.Deps) {
	svc := privacy.NewService(d.Mongo, nil)
	churches := church.NewService(d.Mongo)
	ticker := time.NewTicker(retentionSweepInterval)
	defer ticker.Stop()

	d.Log.Info("retention sweeper started",
		slog.Duration("interval", retentionSweepInterval),
		slog.Int("rules", len(privacy.RetentionPolicy)))

	retainOnce(ctx, d, svc, churches)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			retainOnce(ctx, d, svc, churches)
		}
	}
}

func retainOnce(ctx context.Context, d *deps.Deps, svc *privacy.Service, churches *church.Service) {
	ids, err := churches.AllIDs(ctx)
	if err != nil {
		d.Log.Error("could not list churches for retention",
			slog.String("error", err.Error()))
		return
	}

	var total int64
	for _, churchID := range ids {
		scoped := tenancy.WithScope(ctx, tenancy.Scope{
			ChurchID: churchID,
			UserID:   "system:retention",
			Role:     "SYSTEM",
		})
		res, err := svc.EnforceRetention(scoped)
		if err != nil {
			// One church's problem must not stop the others.
			d.Log.Error("retention failed for a church",
				slog.String("church_id", churchID),
				slog.String("error", err.Error()))
			continue
		}
		total += res.Total
	}

	if total > 0 {
		// Logged with counts because this is the evidence an audit asks for —
		// see why retention is a sweeper rather than a TTL index.
		d.Log.Info("retention enforced",
			slog.Int64("records", total), slog.Int("churches", len(ids)))
	}
}
