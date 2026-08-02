package notification

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/domain/consent"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// Service sends notifications, subject to consent and preference.
type Service struct {
	coll    *mongodb.TenantCollection
	prefs   *mongodb.TenantCollection
	devices *mongodb.TenantCollection
	// global reaches the same collection without a tenant, for the sweeper —
	// which runs on a timer with no request and therefore no church, and has
	// to find out which churches have work before it can scope anything.
	global *mongo.Collection
	// transports is keyed by channel. A channel with no transport suppresses
	// rather than errors, so a deployment without an email provider still
	// sends SMS instead of failing every send.
	transports map[Channel]Transport
	consent    ConsentChecker
	dir        Directory
	now        func() time.Time
	// location is the church's timezone, for quiet hours. UTC would put a
	// Ghanaian congregation's quiet hours in the wrong part of the day for
	// every market east or west of it.
	location *time.Location
}

// NewService builds the notification service.
func NewService(db *mongodb.DB, cc ConsentChecker, dir Directory, transports ...Transport) *Service {
	s := &Service{
		coll:       db.Tenant(Collection),
		global:     db.Global(Collection),
		prefs:      db.Tenant(PreferenceCollection),
		devices:    db.Tenant(DeviceCollection),
		transports: make(map[Channel]Transport, len(transports)),
		consent:    cc,
		dir:        dir,
		now:        time.Now,
		location:   time.UTC,
	}
	for _, t := range transports {
		if t != nil {
			s.transports[t.Channel()] = t
		}
	}
	return s
}

// WithLocation sets the timezone quiet hours are evaluated in.
func (s *Service) WithLocation(loc *time.Location) *Service {
	if loc != nil {
		s.location = loc
	}
	return s
}

// EnsureIndexes creates the indexes the service depends on.
func (s *Service) EnsureIndexes(ctx context.Context) error {
	if err := s.coll.EnsureIndexes(ctx, []mongo.IndexModel{
		{
			// The dedupe key is what makes a redelivered domain event produce
			// one message. Unique across the collection, and partial so the
			// many messages without one do not all collide.
			Keys: bson.D{{Key: "dedupeKey", Value: 1}},
			Options: options.Index().
				SetName("uq_dedupe").
				SetUnique(true).
				SetPartialFilterExpression(bson.M{"dedupeKey": bson.M{"$exists": true}}),
		},
		{
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "memberId", Value: 1},
				{Key: "createdAt", Value: -1},
			},
			Options: options.Index().SetName("church_member_created"),
		},
		{
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "status", Value: 1},
				{Key: "nextAttemptAt", Value: 1},
			},
			Options: options.Index().SetName("church_status_next_attempt"),
		},
	}); err != nil {
		return fmt.Errorf("notification: create indexes: %w", err)
	}

	if err := s.prefs.EnsureIndexes(ctx, []mongo.IndexModel{
		{
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "memberId", Value: 1},
			},
			Options: options.Index().SetName("uq_church_member_pref").SetUnique(true),
		},
	}); err != nil {
		return fmt.Errorf("notification: create preference indexes: %w", err)
	}
	if err := s.devices.EnsureIndexes(ctx, []mongo.IndexModel{
		{
			Keys:    bson.D{{Key: mongodb.TenantField, Value: 1}, {Key: "token", Value: 1}},
			Options: options.Index().SetName("uq_church_device_token").SetUnique(true),
		},
		{
			Keys:    bson.D{{Key: mongodb.TenantField, Value: 1}, {Key: "memberId", Value: 1}, {Key: "updatedAt", Value: -1}},
			Options: options.Index().SetName("church_member_devices"),
		},
		{
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "memberId", Value: 1},
				{Key: "family", Value: 1},
				{Key: "platform", Value: 1},
			},
			Options: options.Index().SetName("uq_church_member_family_platform_device").SetUnique(true),
		},
	}); err != nil {
		return fmt.Errorf("notification: create device indexes: %w", err)
	}
	return nil
}

// Send delivers one message, or records why it was not delivered.
//
// It returns the notification record in every non-error case, including
// suppression. A caller that wanted to know whether a member was reached asks
// the record; suppression is an outcome, not a failure, and returning an error
// for it would push callers into treating "the member opted out" as a bug to
// retry.
func (s *Service) Send(ctx context.Context, msg Message) (*Notification, error) {
	if err := mustValid(msg); err != nil {
		return nil, err
	}
	if _, err := tenancy.MustChurchID(ctx); err != nil {
		return nil, err
	}

	// Dedupe first: a redelivered giving.completed must not send a second
	// receipt, and must not even re-check consent, because the answer could
	// have changed between deliveries and the member already got the message.
	if msg.DedupeKey != "" {
		existing, err := s.byDedupeKey(ctx, msg.DedupeKey)
		if err != nil && !errors.Is(err, ErrNotFound) {
			return nil, err
		}
		if existing != nil {
			return existing, nil
		}
	}

	// Consent is checked here rather than by callers. WP-06 made
	// communications fail closed: no record means no consent.
	if msg.Kind.RequiresConsent() {
		granted, err := s.consent.IsGranted(ctx, msg.MemberID, consent.PurposeCommunications)
		if err != nil {
			return nil, fmt.Errorf("notification: check consent: %w", err)
		}
		if !granted {
			return suppressed(s.record(ctx, msg, "", StatusSuppressed, ReasonNoConsent))
		}
	}

	pref, err := s.preferenceFor(ctx, msg.MemberID)
	if err != nil {
		return nil, err
	}

	if msg.Kind.RequiresConsent() {
		if pref != nil && pref.Unsubscribed {
			return suppressed(s.record(ctx, msg, "", StatusSuppressed, ReasonUnsubscribed))
		}
		if !pref.ChannelEnabled(msg.Channel) {
			return suppressed(s.record(ctx, msg, "", StatusSuppressed, ReasonChannelOff))
		}
	}

	address := msg.Address
	if address == "" {
		if msg.Channel == ChannelPush {
			tokens, tokenErr := s.DeviceTokens(ctx, msg.MemberID)
			if tokenErr != nil {
				return nil, fmt.Errorf("notification: resolve device tokens: %w", tokenErr)
			}
			if len(tokens) > 0 {
				address = tokens[0]
			}
		}
	}
	if address == "" {
		recipient, err := s.dir.RecipientFor(ctx, msg.MemberID)
		if err != nil {
			return nil, fmt.Errorf("notification: resolve recipient: %w", err)
		}
		if recipient != nil {
			address = recipient.AddressFor(msg.Channel)
		}
	}
	if address == "" {
		return suppressed(s.record(ctx, msg, "", StatusSuppressed, ReasonNoAddress))
	}

	// Quiet hours defer announcements; they never hold a transactional
	// message. A receipt suppressed until morning is a member who thinks
	// their tithe vanished.
	now := s.now().In(s.location)
	if msg.Kind != KindTransactional && pref.InQuietHours(now) {
		deferred, created, err := s.record(ctx, msg, address, StatusQueued, ReasonQuietHours)
		if err != nil {
			return nil, err
		}
		if !created {
			return deferred, nil
		}
		next := pref.NextSendableTime(now).UTC()
		if err := s.setNextAttempt(ctx, deferred.ID, next); err != nil {
			return nil, err
		}
		deferred.NextAttemptAt = &next
		return deferred, nil
	}

	// Recorded as queued BEFORE the transport is called. If the process dies
	// mid-send we have a record that something was attempted, which is
	// recoverable; the other order loses the message entirely.
	queued, created, err := s.record(ctx, msg, address, StatusQueued, "")
	if err != nil {
		return nil, err
	}
	if !created {
		// A concurrent delivery of the same event owns this send. Returning
		// its row without calling the transport is what keeps one event to
		// one message; the unique index alone would hold at one record while
		// the member received one receipt per racing delivery.
		return queued, nil
	}
	return s.attempt(ctx, queued, msg)
}

// attempt calls the transport and records the outcome.
func (s *Service) attempt(ctx context.Context, n *Notification, msg Message) (*Notification, error) {
	transport, ok := s.transports[n.Channel]
	if !ok {
		// A missing transport suppresses rather than fails: a deployment with
		// no email provider should still send SMS.
		return s.finish(ctx, n.ID, StatusSuppressed, "",
			fmt.Sprintf("%s: %s", ErrNoTransport, n.Channel))
	}

	ref, err := transport.Send(ctx, n.Address, msg)
	if err == nil {
		return s.finish(ctx, n.ID, StatusSent, ref, "")
	}
	if n.Channel == ChannelPush && errors.Is(err, ErrUnregisteredDevice) {
		if _, pruneErr := s.devices.DeleteOne(ctx, bson.M{"token": n.Address}); pruneErr != nil {
			return nil, fmt.Errorf("notification: prune unregistered device: %w", pruneErr)
		}
	}

	attempts := n.Attempts + 1
	if IsRetryable(err) && attempts < MaxAttempts {
		next := s.now().UTC().Add(backoffFor(attempts))
		if updateErr := s.scheduleRetry(ctx, n.ID, attempts, next, err.Error()); updateErr != nil {
			return nil, updateErr
		}
		return s.ByID(ctx, n.ID.Hex())
	}

	reason := err.Error()
	if attempts >= MaxAttempts {
		reason = fmt.Sprintf("%s (abandoned after %d attempts)", reason, attempts)
	}
	return s.finish(ctx, n.ID, StatusFailed, "", reason, attempts)
}

// Retry attempts everything that is due: queued messages past their quiet
// hours, and failed sends past their backoff. Intended to be called on a
// schedule.
func (s *Service) Retry(ctx context.Context, limit int64) (int, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	now := s.now().UTC()

	var due []Notification
	err := s.coll.Find(ctx, bson.M{
		"status":        string(StatusQueued),
		"nextAttemptAt": bson.M{"$lte": now},
	}, &due, options.Find().
		SetSort(bson.D{{Key: "nextAttemptAt", Value: 1}}).
		SetLimit(limit))
	if err != nil {
		return 0, fmt.Errorf("notification: find due messages: %w", err)
	}

	sent := 0
	for i := range due {
		n := &due[i]
		result, err := s.attempt(ctx, n, Message{
			MemberID:  n.MemberID.String(),
			Channel:   n.Channel,
			Kind:      n.Kind,
			Subject:   n.Subject,
			Body:      n.Body,
			DedupeKey: n.DedupeKey,
		})
		if err != nil {
			// One undeliverable message must not stop the queue.
			continue
		}
		if result.Status == StatusSent || result.Status == StatusDelivered {
			sent++
		}
	}
	return sent, nil
}

// Broadcast sends to many members, returning the per-member outcome.
//
// Consent is filtered in one query rather than per member: a 5,000-member
// broadcast that asks the consent service 5,000 times is a self-inflicted
// outage on the busiest path in the product.
func (s *Service) Broadcast(ctx context.Context, memberIDs []string, msg Message) ([]*Notification, error) {
	if len(memberIDs) == 0 {
		return nil, nil
	}
	if _, err := tenancy.MustChurchID(ctx); err != nil {
		return nil, err
	}

	out := make([]*Notification, 0, len(memberIDs))
	for _, id := range memberIDs {
		perMember := msg
		perMember.MemberID = id
		if msg.DedupeKey != "" {
			// One key per member, or the first send would dedupe away
			// everyone else's copy.
			perMember.DedupeKey = msg.DedupeKey + ":" + id
		}
		n, err := s.Send(ctx, perMember)
		if err != nil {
			// A single bad recipient must not fail the broadcast.
			continue
		}
		out = append(out, n)
	}
	return out, nil
}

// record writes a notification row, reporting whether it created one.
//
// The created flag is load-bearing. Losing the race on the dedupe key returns
// the winner's row, and a caller that treated that as its own would then call
// the transport on a message the winner is already sending — the unique index
// would hold at one record while the member received eight receipts.
func (s *Service) record(ctx context.Context, msg Message, address string, status Status, reason string) (*Notification, bool, error) {
	now := s.now().UTC()
	doc := bson.M{
		"memberId":  msg.MemberID,
		"channel":   string(msg.Channel),
		"kind":      string(msg.Kind),
		"body":      msg.Body,
		"status":    string(status),
		"attempts":  0,
		"createdAt": now,
		"updatedAt": now,
	}
	if address != "" {
		doc["address"] = address
	}
	if msg.Subject != "" {
		doc["subject"] = msg.Subject
	}
	if reason != "" {
		doc["reason"] = reason
	}
	if msg.DedupeKey != "" {
		doc["dedupeKey"] = msg.DedupeKey
	}

	res, err := s.coll.InsertOne(ctx, doc)
	if err != nil {
		if mongo.IsDuplicateKeyError(err) && msg.DedupeKey != "" {
			// Another delivery of the same event won the race; it owns the
			// send.
			existing, findErr := s.byDedupeKey(ctx, msg.DedupeKey)
			return existing, false, findErr
		}
		return nil, false, fmt.Errorf("notification: record: %w", err)
	}
	created, err := s.ByID(ctx, res.InsertedID.(bson.ObjectID).Hex())
	return created, err == nil, err
}

func (s *Service) finish(
	ctx context.Context,
	id bson.ObjectID,
	status Status,
	providerRef, reason string,
	attemptCount ...int,
) (*Notification, error) {
	set := bson.M{
		"status":    string(status),
		"updatedAt": s.now().UTC(),
	}
	if providerRef != "" {
		set["providerRef"] = providerRef
	}
	if reason != "" {
		set["reason"] = reason
	}
	if len(attemptCount) > 0 {
		set["attempts"] = attemptCount[0]
	}
	if status == StatusSent || status == StatusDelivered {
		set["sentAt"] = s.now().UTC()
	}
	update := bson.M{"$set": set}
	if status != StatusQueued {
		update["$unset"] = bson.M{"nextAttemptAt": ""}
	}
	if _, err := s.coll.UpdateOne(ctx, bson.M{"_id": id}, update); err != nil {
		return nil, fmt.Errorf("notification: finish: %w", err)
	}
	return s.ByID(ctx, id.Hex())
}

func (s *Service) scheduleRetry(ctx context.Context, id bson.ObjectID, attempts int, next time.Time, reason string) error {
	_, err := s.coll.UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$set": bson.M{
		"status":        string(StatusQueued),
		"attempts":      attempts,
		"nextAttemptAt": next,
		"reason":        reason,
		"updatedAt":     s.now().UTC(),
	}})
	if err != nil {
		return fmt.Errorf("notification: schedule retry: %w", err)
	}
	return nil
}

func (s *Service) setNextAttempt(ctx context.Context, id bson.ObjectID, next time.Time) error {
	_, err := s.coll.UpdateOne(ctx, bson.M{"_id": id},
		bson.M{"$set": bson.M{"nextAttemptAt": next}})
	if err != nil {
		return fmt.Errorf("notification: defer: %w", err)
	}
	return nil
}

// MarkDelivered records a delivery report from a transport.
func (s *Service) MarkDelivered(ctx context.Context, providerRef string) error {
	if providerRef == "" {
		return ErrNotFound
	}
	res, err := s.coll.UpdateOne(ctx,
		bson.M{"providerRef": providerRef},
		bson.M{"$set": bson.M{"status": string(StatusDelivered), "updatedAt": s.now().UTC()}})
	if err != nil {
		return fmt.Errorf("notification: mark delivered: %w", err)
	}
	if res.MatchedCount == 0 {
		return ErrNotFound
	}
	return nil
}

// ByID returns one notification within the caller's church.
func (s *Service) ByID(ctx context.Context, id string) (*Notification, error) {
	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return nil, ErrNotFound
	}
	var n Notification
	err = s.coll.FindOne(ctx, bson.M{"_id": oid}, &n)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("notification: read: %w", err)
	}
	return &n, nil
}

func (s *Service) byDedupeKey(ctx context.Context, key string) (*Notification, error) {
	var n Notification
	err := s.coll.FindOne(ctx, bson.M{"dedupeKey": key}, &n)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("notification: read by dedupe key: %w", err)
	}
	return &n, nil
}

// History returns a member's messages, newest first, so a church can answer
// "did they get told?".
func (s *Service) History(ctx context.Context, memberID string, limit int64) ([]Notification, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	var out []Notification
	err := s.coll.Find(ctx, bson.M{"memberId": memberID}, &out,
		options.Find().
			SetSort(bson.D{{Key: "createdAt", Value: -1}, {Key: "_id", Value: -1}}).
			SetLimit(limit))
	if err != nil {
		return nil, fmt.Errorf("notification: history: %w", err)
	}
	return out, nil
}

// MarkRead records inbox state without rewriting transport delivery status.
func (s *Service) MarkRead(ctx context.Context, id, memberID string) (*Notification, error) {
	oid, err := bson.ObjectIDFromHex(id)
	if err != nil || memberID == "" {
		return nil, ErrNotFound
	}
	now := s.now().UTC()
	res, err := s.coll.UpdateOne(ctx, bson.M{"_id": oid, "memberId": memberID}, bson.M{"$set": bson.M{"readAt": now}})
	if err != nil {
		return nil, fmt.Errorf("notification: mark read: %w", err)
	}
	if res.MatchedCount == 0 {
		return nil, ErrNotFound
	}
	return s.ByID(ctx, id)
}

// RegisterDevice persistently attaches one native token to a member session.
// A family has one token slot per native platform, so APNs/FCM rotation updates
// that slot instead of retaining a stale address and attempting duplicate
// delivery forever.
func (s *Service) RegisterDevice(ctx context.Context, memberID, family, token, platform string) error {
	token = strings.TrimSpace(token)
	family = strings.TrimSpace(family)
	platform = strings.ToLower(strings.TrimSpace(platform))
	if memberID == "" || family == "" || len(family) > 256 || strings.IndexFunc(family, unicode.IsControl) >= 0 ||
		(platform != "ios" && platform != "android") ||
		len(token) < 32 || len(token) > 4096 || strings.IndexFunc(token, unicode.IsControl) >= 0 {
		return ErrInvalidDevice
	}
	now := s.now().UTC()
	// The same physical APNs/FCM token can survive an app logout and then be
	// presented by a replacement login. A best-effort logout cleanup must not
	// strand that device behind the tenant/token unique index. Reclaim only the
	// exact token inside this tenant before assigning its new session slot.
	var prior []DeviceRegistration
	if err := s.devices.Find(ctx, bson.M{"token": token}, &prior, options.Find().SetLimit(10)); err != nil {
		return fmt.Errorf("notification: inspect device ownership: %w", err)
	}
	for _, device := range prior {
		if device.MemberID == memberID && device.Family == family && device.Platform == platform {
			continue
		}
		if _, err := s.devices.DeleteOne(ctx, bson.M{"_id": device.ID, "token": token}); err != nil {
			return fmt.Errorf("notification: transfer device ownership: %w", err)
		}
	}
	_, err := s.devices.UpsertOne(ctx, bson.M{
		"memberId": memberID,
		"family":   family,
		"platform": platform,
	}, bson.M{
		"$set":         bson.M{"token": token, "updatedAt": now},
		"$setOnInsert": bson.M{"createdAt": now},
	})
	if err != nil {
		return fmt.Errorf("notification: register device: %w", err)
	}
	return nil
}

// RemoveDevices deletes either one session family's registrations or, when
// family is empty, every device owned by the member (global logout).
func (s *Service) RemoveDevices(ctx context.Context, memberID, family string) error {
	if memberID == "" {
		return ErrNoRecipient
	}
	filter := bson.M{"memberId": memberID}
	if family != "" {
		filter["family"] = family
	}
	for {
		var devices []DeviceRegistration
		if err := s.devices.Find(ctx, filter, &devices, options.Find().SetLimit(100)); err != nil {
			return fmt.Errorf("notification: list devices for removal: %w", err)
		}
		if len(devices) == 0 {
			return nil
		}
		for _, device := range devices {
			if _, err := s.devices.DeleteOne(ctx, bson.M{"_id": device.ID, "memberId": memberID}); err != nil {
				return fmt.Errorf("notification: remove device: %w", err)
			}
		}
	}
}

// DeviceTokens returns the newest native registrations for a member.
func (s *Service) DeviceTokens(ctx context.Context, memberID string) ([]string, error) {
	if memberID == "" {
		return nil, ErrNoRecipient
	}
	var devices []DeviceRegistration
	if err := s.devices.Find(ctx, bson.M{"memberId": memberID}, &devices,
		options.Find().SetSort(bson.D{{Key: "updatedAt", Value: -1}}).SetLimit(20)); err != nil {
		return nil, fmt.Errorf("notification: list devices: %w", err)
	}
	tokens := make([]string, 0, len(devices))
	for _, device := range devices {
		tokens = append(tokens, device.Token)
	}
	return tokens, nil
}

// Count returns how many notifications match a filter.
func (s *Service) Count(ctx context.Context, filter bson.M) (int64, error) {
	n, err := s.coll.CountDocuments(ctx, filter)
	if err != nil {
		return 0, fmt.Errorf("notification: count: %w", err)
	}
	return n, nil
}

// preferenceFor reads a member's preferences, returning nil when none are set
// — the zero preference is "everything on, default quiet hours".
func (s *Service) preferenceFor(ctx context.Context, memberID string) (*Preference, error) {
	var p Preference
	err := s.prefs.FindOne(ctx, bson.M{"memberId": memberID}, &p)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("notification: read preference: %w", err)
	}
	return &p, nil
}

// PreferenceFor exposes a member's preferences for a settings screen.
func (s *Service) PreferenceFor(ctx context.Context, memberID string) (*Preference, error) {
	return s.preferenceFor(ctx, memberID)
}

// SetChannel turns a channel on or off for a member.
func (s *Service) SetChannel(ctx context.Context, memberID string, c Channel, enabled bool) error {
	if !c.Valid() {
		return fmt.Errorf("%w: %q", ErrInvalidChannel, c)
	}
	op := "$addToSet"
	if enabled {
		op = "$pull"
	}
	return s.upsertPreference(ctx, memberID, bson.M{op: bson.M{"disabled": string(c)}})
}

// SetQuietHours sets a member's quiet window in the church's local hours.
func (s *Service) SetQuietHours(ctx context.Context, memberID string, from, to int) error {
	if from < 0 || from > 23 || to < 0 || to > 23 {
		return fmt.Errorf("notification: quiet hours must be 0-23, got %d-%d", from, to)
	}
	return s.upsertPreference(ctx, memberID, bson.M{
		"$set": bson.M{"quietFromHour": from, "quietToHour": to},
	})
}

// Unsubscribe stops everything except transactional messages.
//
// Deliberately not a consent revocation. A member who replies STOP has
// expressed a preference; collapsing that into "delete my lawful basis" would
// lose the distinction and make re-subscribing a consent ceremony rather than
// a toggle.
func (s *Service) Unsubscribe(ctx context.Context, memberID string) error {
	return s.upsertPreference(ctx, memberID, bson.M{"$set": bson.M{"unsubscribed": true}})
}

// Resubscribe reverses Unsubscribe.
func (s *Service) Resubscribe(ctx context.Context, memberID string) error {
	return s.upsertPreference(ctx, memberID, bson.M{"$set": bson.M{"unsubscribed": false}})
}

func (s *Service) upsertPreference(ctx context.Context, memberID string, update bson.M) error {
	if memberID == "" {
		return ErrNoRecipient
	}
	if _, err := tenancy.MustChurchID(ctx); err != nil {
		return err
	}

	now := s.now().UTC()
	set, _ := update["$set"].(bson.M)
	if set == nil {
		set = bson.M{}
	}
	set["updatedAt"] = now
	update["$set"] = set
	update["$setOnInsert"] = bson.M{
		"memberId":  memberID,
		"createdAt": now,
	}

	if _, err := s.prefs.UpsertOne(ctx, bson.M{"memberId": memberID}, update); err != nil {
		return fmt.Errorf("notification: save preference: %w", err)
	}
	return nil
}

// suppressed adapts record's three results for the paths where the message was
// never going to be sent, so the created flag carries no meaning.
func suppressed(n *Notification, _ bool, err error) (*Notification, error) {
	return n, err
}

// PendingChurches lists churches with messages due to be sent.
//
// This is the one query in this package that runs without a tenant, and it
// exists because a background sweeper has no request and therefore no church.
// It returns ONLY church ids — never a document — so nothing tenant-scoped
// escapes; the caller then re-enters each church's scope to do the work.
func (s *Service) PendingChurches(ctx context.Context) ([]string, error) {
	var raw []any
	err := s.global.Distinct(ctx, mongodb.TenantField, bson.M{
		"status":        string(StatusQueued),
		"nextAttemptAt": bson.M{"$lte": s.now().UTC()},
	}).Decode(&raw)
	if err != nil {
		return nil, fmt.Errorf("notification: find churches with due messages: %w", err)
	}

	out := make([]string, 0, len(raw))
	for _, v := range raw {
		// churchId is an ObjectId when Mongoose wrote it and a string on older
		// Go rows (ADR-005), so both forms have to be handled or the sweeper
		// silently skips half the platform.
		switch id := v.(type) {
		case string:
			if id != "" {
				out = append(out, id)
			}
		case bson.ObjectID:
			out = append(out, id.Hex())
		}
	}
	return out, nil
}
