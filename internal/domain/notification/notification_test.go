package notification

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/domain/consent"
	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

const testChurch = "church_notify_test"

// recordingTransport captures what would have been sent.
type recordingTransport struct {
	mu      sync.Mutex
	channel Channel
	sent    []struct {
		To  string
		Msg Message
	}
	err error
	// failuresBeforeSuccess makes the first n attempts fail, for retry tests.
	failuresBeforeSuccess int
	attempts              int
}

func newTransport(c Channel) *recordingTransport {
	return &recordingTransport{channel: c}
}

func (r *recordingTransport) Channel() Channel { return r.channel }

func (r *recordingTransport) Send(_ context.Context, to string, msg Message) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.attempts++

	if r.attempts <= r.failuresBeforeSuccess {
		return "", Retryable(errors.New("provider is briefly unavailable"))
	}
	if r.err != nil {
		return "", r.err
	}
	r.sent = append(r.sent, struct {
		To  string
		Msg Message
	}{to, msg})
	return "prov_ref_" + msg.DedupeKey, nil
}

func (r *recordingTransport) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.sent)
}

func (r *recordingTransport) last() (string, Message) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.sent) == 0 {
		return "", Message{}
	}
	s := r.sent[len(r.sent)-1]
	return s.To, s.Msg
}

// stubConsent answers consent questions from a map, defaulting to denied —
// which is what WP-06 requires for communications.
type stubConsent struct {
	mu      sync.Mutex
	granted map[string]bool
	err     error
	calls   int
}

func (s *stubConsent) IsGranted(_ context.Context, memberID string, p consent.Purpose) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	if s.err != nil {
		return false, s.err
	}
	if p != consent.PurposeCommunications {
		return false, nil
	}
	return s.granted[memberID], nil
}

func (s *stubConsent) grant(memberID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.granted == nil {
		s.granted = map[string]bool{}
	}
	s.granted[memberID] = true
}

func (s *stubConsent) revoke(memberID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.granted, memberID)
}

// stubDirectory resolves members to contact details.
type stubDirectory struct {
	mu         sync.Mutex
	recipients map[string]*Recipient
}

func (d *stubDirectory) RecipientFor(_ context.Context, memberID string) (*Recipient, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.recipients[memberID], nil
}

func (d *stubDirectory) add(r *Recipient) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.recipients == nil {
		d.recipients = map[string]*Recipient{}
	}
	d.recipients[r.MemberID] = r
}

type harness struct {
	svc   *Service
	sms   *recordingTransport
	email *recordingTransport
	cc    *stubConsent
	dir   *stubDirectory
	ctx   context.Context
	now   time.Time
}

func newHarness(t *testing.T) *harness {
	t.Helper()

	uri := os.Getenv("MONGODB_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}
	connectCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	db, err := mongodb.Connect(connectCtx, config.MongoConfig{
		URI:            uri,
		Database:       "altar_test_notification",
		ConnectTimeout: 3 * time.Second,
	})
	if err != nil {
		t.Skipf("MongoDB unavailable (run `make infra-up`): %v", err)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = db.Database().Drop(c)
		_ = db.Close(c)
	})

	h := &harness{
		sms:   newTransport(ChannelSMS),
		email: newTransport(ChannelEmail),
		cc:    &stubConsent{granted: map[string]bool{}},
		dir:   &stubDirectory{},
		// A Wednesday at 10:00 — outside any default quiet window.
		now: time.Date(2026, 7, 29, 10, 0, 0, 0, time.UTC),
	}
	h.svc = NewService(db, h.cc, h.dir, h.sms, h.email)
	h.svc.now = func() time.Time { return h.now }

	h.dir.add(&Recipient{
		MemberID:  "member_1",
		Name:      "Ama Owusu",
		PhoneE164: "+233241234567",
		Email:     "ama@example.com",
	})

	h.ctx = tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: testChurch,
		UserID:   "admin_1",
		Role:     "CHURCH_ADMIN",
	})
	if err := h.svc.EnsureIndexes(h.ctx); err != nil {
		t.Fatalf("EnsureIndexes: %v", err)
	}
	return h
}

// WP-15 acceptance, first half: giving.completed produces one SMS receipt.
func TestGivingCompletedProducesOneSMSReceipt(t *testing.T) {
	h := newHarness(t)

	event := GivingCompleted{
		TransactionID: "6889a1b2c3d4e5f601234567",
		ChurchID:      testChurch,
		MemberID:      "member_1",
		Type:          "tithe",
		Channel:       "mobile_money",
		GrossMinor:    10000,
		NetMinor:      9655,
		Currency:      "GHS",
		ChurchName:    "Grace Chapel",
	}

	n, err := h.svc.SendGivingReceipt(context.Background(), event)
	if err != nil {
		t.Fatalf("SendGivingReceipt: %v", err)
	}
	if n.Status != StatusSent {
		t.Fatalf("status = %s (%s), want sent", n.Status, n.Reason)
	}
	if h.sms.count() != 1 {
		t.Fatalf("want exactly 1 SMS, got %d", h.sms.count())
	}

	to, msg := h.sms.last()
	if to != "+233241234567" {
		t.Errorf("sent to %q, want the member's E.164 number", to)
	}
	// The receipt must state the amount the member gave.
	if !strings.Contains(msg.Body, "GHS 100.00") {
		t.Errorf("receipt should state GHS 100.00, got %q", msg.Body)
	}
	if !strings.Contains(msg.Body, "Grace Chapel") {
		t.Errorf("receipt should name the church, got %q", msg.Body)
	}
}

// WP-15 acceptance, second half: a member with revoked comms consent receives
// nothing.
func TestRevokedConsentReceivesNothing(t *testing.T) {
	h := newHarness(t)
	h.cc.grant("member_1")

	// An announcement while consent is granted goes out.
	first, err := h.svc.Send(h.ctx, Message{
		MemberID: "member_1", Channel: ChannelSMS, Kind: KindAnnouncement,
		Body: "Service moves to 9am this Sunday.",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if first.Status != StatusSent {
		t.Fatalf("with consent, status = %s (%s)", first.Status, first.Reason)
	}

	// Consent is revoked.
	h.cc.revoke("member_1")

	second, err := h.svc.Send(h.ctx, Message{
		MemberID: "member_1", Channel: ChannelSMS, Kind: KindAnnouncement,
		Body: "Another announcement.",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if second.Status != StatusSuppressed {
		t.Fatalf("after revocation, status = %s, want suppressed", second.Status)
	}
	if second.Reason != ReasonNoConsent {
		t.Errorf("reason = %q, want %q", second.Reason, ReasonNoConsent)
	}
	// Nothing reached the transport.
	if h.sms.count() != 1 {
		t.Fatalf("transport saw %d messages; the second must not have been sent", h.sms.count())
	}
}

// WP-06 made communications fail closed: no consent record means no consent.
// A member nobody has recorded an answer for must not receive announcements.
func TestNoConsentRecordMeansNoAnnouncement(t *testing.T) {
	h := newHarness(t)
	// Deliberately no grant.

	n, err := h.svc.Send(h.ctx, Message{
		MemberID: "member_1", Channel: ChannelSMS, Kind: KindAnnouncement,
		Body: "Come to the crusade.",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if n.Status != StatusSuppressed || n.Reason != ReasonNoConsent {
		t.Fatalf("status = %s reason = %q; consent must fail closed", n.Status, n.Reason)
	}
	if h.sms.count() != 0 {
		t.Error("nothing should have reached the transport")
	}
}

// A receipt or an OTP is not marketing. Gating it on communications consent
// would leave a member unable to receive proof of their own tithe.
func TestTransactionalMessagesDoNotRequireConsent(t *testing.T) {
	h := newHarness(t)
	// No consent granted at all.

	n, err := h.svc.Send(h.ctx, Message{
		MemberID: "member_1", Channel: ChannelSMS, Kind: KindTransactional,
		Body: "Your giving receipt.",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if n.Status != StatusSent {
		t.Fatalf("status = %s (%s); transactional messages must not need consent",
			n.Status, n.Reason)
	}
	// And the consent service should not even have been asked.
	if h.cc.calls != 0 {
		t.Errorf("consent was checked %d times for a transactional message", h.cc.calls)
	}
}

// At-least-once delivery is the contract; a replayed event must not send two
// receipts.
func TestReplayedGivingEventSendsOneReceipt(t *testing.T) {
	h := newHarness(t)

	event := GivingCompleted{
		TransactionID: "6889a1b2c3d4e5f601234567",
		ChurchID:      testChurch,
		MemberID:      "member_1",
		Type:          "tithe",
		GrossMinor:    10000,
		NetMinor:      9655,
		Currency:      "GHS",
	}

	for i := 0; i < 3; i++ {
		if _, err := h.svc.SendGivingReceipt(context.Background(), event); err != nil {
			t.Fatalf("delivery %d: %v", i+1, err)
		}
	}

	if h.sms.count() != 1 {
		t.Fatalf("3 deliveries sent %d SMS, want exactly 1", h.sms.count())
	}
	count, err := h.svc.Count(h.ctx, bson.M{"memberId": "member_1"})
	if err != nil {
		t.Fatalf("Count: %v", err)
	}
	if count != 1 {
		t.Fatalf("3 deliveries recorded %d notifications, want 1", count)
	}
}

// Concurrent replays race on the dedupe key; the unique index must settle it.
func TestConcurrentReplaysSendOneReceipt(t *testing.T) {
	h := newHarness(t)

	event := GivingCompleted{
		TransactionID: "6889a1b2c3d4e5f601234567",
		ChurchID:      testChurch,
		MemberID:      "member_1",
		Type:          "offering",
		GrossMinor:    5000,
		NetMinor:      4900,
		Currency:      "GHS",
	}

	const racers = 8
	var wg sync.WaitGroup
	wg.Add(racers)
	for i := 0; i < racers; i++ {
		go func() {
			defer wg.Done()
			_, _ = h.svc.SendGivingReceipt(context.Background(), event)
		}()
	}
	wg.Wait()

	count, err := h.svc.Count(h.ctx, bson.M{"memberId": "member_1"})
	if err != nil {
		t.Fatalf("Count: %v", err)
	}
	if count != 1 {
		t.Fatalf("%d concurrent replays recorded %d notifications, want 1", racers, count)
	}
	if h.sms.count() != 1 {
		t.Fatalf("%d concurrent replays sent %d SMS, want 1", racers, h.sms.count())
	}
}

// Anonymous giving has nobody to receipt, and that is a supported flow rather
// than an error.
func TestAnonymousGivingProducesNoReceipt(t *testing.T) {
	h := newHarness(t)

	n, err := h.svc.SendGivingReceipt(context.Background(), GivingCompleted{
		TransactionID: "tx1", ChurchID: testChurch, GrossMinor: 5000, Currency: "GHS",
	})
	if err != nil {
		t.Fatalf("anonymous giving must not error: %v", err)
	}
	if n != nil {
		t.Errorf("want no notification, got %+v", n)
	}
}

// The receipt must state what left the giver's wallet, because that is what
// their own MoMo statement shows.
func TestReceiptStatesTheTotalDebitedIncludingLevy(t *testing.T) {
	body := ReceiptFor(GivingCompleted{
		TransactionID: "6889a1b2c3d4e5f601234567",
		Type:          "tithe",
		GrossMinor:    15000, // GHS 150 gift
		LevyMinor:     50,    // GHS 0.50 levy
		NetMinor:      14550,
		Currency:      "GHS",
		ChurchName:    "Grace Chapel",
	})

	if !strings.Contains(body, "GHS 150.00") {
		t.Errorf("receipt must state the gift, got %q", body)
	}
	if !strings.Contains(body, "GHS 150.50") {
		t.Errorf("receipt must state the total debit, got %q", body)
	}
	if !strings.Contains(body, "GHS 0.50") {
		t.Errorf("receipt must break out the levy, got %q", body)
	}
	// The church's net is smaller by the fees; showing it reads as money
	// going missing.
	if strings.Contains(body, "145.50") {
		t.Errorf("the receipt must not lead with the church's net, got %q", body)
	}
}

// Quiet hours hold announcements but never a receipt.
func TestQuietHoursDeferAnnouncementsButNotReceipts(t *testing.T) {
	h := newHarness(t)
	h.cc.grant("member_1")
	h.now = time.Date(2026, 7, 29, 23, 30, 0, 0, time.UTC) // 23:30, inside 21:00-07:00

	announcement, err := h.svc.Send(h.ctx, Message{
		MemberID: "member_1", Channel: ChannelSMS, Kind: KindAnnouncement,
		Body: "Reminder about tomorrow.",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if announcement.Status != StatusQueued {
		t.Errorf("an announcement at 23:30 should be queued, got %s", announcement.Status)
	}
	if announcement.Reason != ReasonQuietHours {
		t.Errorf("reason = %q, want %q", announcement.Reason, ReasonQuietHours)
	}
	if announcement.NextAttemptAt == nil {
		t.Fatal("a deferred message needs a scheduled time")
	}
	// It should go out at 07:00 the next morning.
	if got := announcement.NextAttemptAt.UTC(); got.Hour() != 7 || got.Day() != 30 {
		t.Errorf("scheduled for %v, want 07:00 on the 30th", got)
	}
	if h.sms.count() != 0 {
		t.Error("nothing should have been sent during quiet hours")
	}

	// A receipt at the same moment goes immediately: someone who gives at
	// 23:30 must not think their tithe vanished until morning.
	receipt, err := h.svc.Send(h.ctx, Message{
		MemberID: "member_1", Channel: ChannelSMS, Kind: KindTransactional,
		Body: "Your giving receipt.",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if receipt.Status != StatusSent {
		t.Fatalf("a receipt must not be held by quiet hours, got %s", receipt.Status)
	}
}

// The default window wraps midnight, so it cannot be a simple range check —
// treating it as one makes every hour of the day quiet.
func TestQuietWindowWrapsMidnight(t *testing.T) {
	var p *Preference // nil uses the 21:00-07:00 default

	quiet := []int{21, 22, 23, 0, 3, 6}
	loud := []int{7, 8, 12, 17, 20}

	for _, hour := range quiet {
		at := time.Date(2026, 7, 29, hour, 0, 0, 0, time.UTC)
		if !p.InQuietHours(at) {
			t.Errorf("%02d:00 should be inside the quiet window", hour)
		}
	}
	for _, hour := range loud {
		at := time.Date(2026, 7, 29, hour, 0, 0, 0, time.UTC)
		if p.InQuietHours(at) {
			t.Errorf("%02d:00 should be outside the quiet window", hour)
		}
	}
}

// A member may set a non-wrapping window too.
func TestCustomNonWrappingQuietWindow(t *testing.T) {
	h := newHarness(t)
	h.cc.grant("member_1")

	// Quiet 09:00-17:00 — someone who works nights.
	if err := h.svc.SetQuietHours(h.ctx, "member_1", 9, 17); err != nil {
		t.Fatalf("SetQuietHours: %v", err)
	}

	h.now = time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	midday, err := h.svc.Send(h.ctx, Message{
		MemberID: "member_1", Channel: ChannelSMS, Kind: KindAnnouncement, Body: "Notice",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if midday.Status != StatusQueued {
		t.Errorf("midday should be quiet for this member, got %s", midday.Status)
	}

	h.now = time.Date(2026, 7, 29, 20, 0, 0, 0, time.UTC)
	evening, err := h.svc.Send(h.ctx, Message{
		MemberID: "member_1", Channel: ChannelSMS, Kind: KindAnnouncement, Body: "Notice",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if evening.Status != StatusSent {
		t.Errorf("20:00 is outside this member's quiet window, got %s (%s)",
			evening.Status, evening.Reason)
	}
}

// A deferred message must actually go out once the window passes.
func TestDeferredMessageSendsAfterQuietHours(t *testing.T) {
	h := newHarness(t)
	h.cc.grant("member_1")
	h.now = time.Date(2026, 7, 29, 23, 30, 0, 0, time.UTC)

	if _, err := h.svc.Send(h.ctx, Message{
		MemberID: "member_1", Channel: ChannelSMS, Kind: KindAnnouncement,
		Body: "Morning notice.",
	}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if h.sms.count() != 0 {
		t.Fatal("nothing should have gone out yet")
	}

	// Morning.
	h.now = time.Date(2026, 7, 30, 8, 0, 0, 0, time.UTC)
	sent, err := h.svc.Retry(h.ctx, 100)
	if err != nil {
		t.Fatalf("Retry: %v", err)
	}
	if sent != 1 {
		t.Fatalf("Retry sent %d, want 1", sent)
	}
	if h.sms.count() != 1 {
		t.Fatalf("transport saw %d messages, want 1", h.sms.count())
	}
}

// Disabling a channel must not disable the others.
func TestChannelPreferenceIsPerChannel(t *testing.T) {
	h := newHarness(t)
	h.cc.grant("member_1")

	if err := h.svc.SetChannel(h.ctx, "member_1", ChannelSMS, false); err != nil {
		t.Fatalf("SetChannel: %v", err)
	}

	sms, err := h.svc.Send(h.ctx, Message{
		MemberID: "member_1", Channel: ChannelSMS, Kind: KindAnnouncement, Body: "Notice",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if sms.Status != StatusSuppressed || sms.Reason != ReasonChannelOff {
		t.Errorf("SMS should be suppressed, got %s (%s)", sms.Status, sms.Reason)
	}

	email, err := h.svc.Send(h.ctx, Message{
		MemberID: "member_1", Channel: ChannelEmail, Kind: KindAnnouncement,
		Subject: "Notice", Body: "Notice",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if email.Status != StatusSent {
		t.Errorf("email should still send, got %s (%s)", email.Status, email.Reason)
	}
}

// Re-enabling a channel must actually work.
func TestChannelCanBeReEnabled(t *testing.T) {
	h := newHarness(t)
	h.cc.grant("member_1")

	if err := h.svc.SetChannel(h.ctx, "member_1", ChannelSMS, false); err != nil {
		t.Fatalf("disable: %v", err)
	}
	if err := h.svc.SetChannel(h.ctx, "member_1", ChannelSMS, true); err != nil {
		t.Fatalf("enable: %v", err)
	}

	n, err := h.svc.Send(h.ctx, Message{
		MemberID: "member_1", Channel: ChannelSMS, Kind: KindAnnouncement, Body: "Notice",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if n.Status != StatusSent {
		t.Fatalf("status = %s (%s), want sent", n.Status, n.Reason)
	}
}

// STOP is a preference, not a consent revocation, and it must not silence a
// receipt the member's own action asked for.
func TestUnsubscribeStopsAnnouncementsButNotReceipts(t *testing.T) {
	h := newHarness(t)
	h.cc.grant("member_1")

	if err := h.svc.Unsubscribe(h.ctx, "member_1"); err != nil {
		t.Fatalf("Unsubscribe: %v", err)
	}

	announcement, err := h.svc.Send(h.ctx, Message{
		MemberID: "member_1", Channel: ChannelSMS, Kind: KindAnnouncement, Body: "Notice",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if announcement.Status != StatusSuppressed || announcement.Reason != ReasonUnsubscribed {
		t.Errorf("status = %s reason = %q", announcement.Status, announcement.Reason)
	}

	receipt, err := h.svc.Send(h.ctx, Message{
		MemberID: "member_1", Channel: ChannelSMS, Kind: KindTransactional,
		Body: "Your giving receipt.",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if receipt.Status != StatusSent {
		t.Errorf("a receipt must still arrive, got %s (%s)", receipt.Status, receipt.Reason)
	}

	if err := h.svc.Resubscribe(h.ctx, "member_1"); err != nil {
		t.Fatalf("Resubscribe: %v", err)
	}
	back, err := h.svc.Send(h.ctx, Message{
		MemberID: "member_1", Channel: ChannelSMS, Kind: KindAnnouncement, Body: "Notice again",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if back.Status != StatusSent {
		t.Errorf("resubscribing should restore announcements, got %s (%s)", back.Status, back.Reason)
	}
}

// A member with no phone number is a suppression, not a failure — nothing went
// wrong, there is simply nowhere to send.
func TestMemberWithNoAddressIsSuppressed(t *testing.T) {
	h := newHarness(t)
	h.cc.grant("member_2")
	h.dir.add(&Recipient{MemberID: "member_2", Name: "No Contact"})

	n, err := h.svc.Send(h.ctx, Message{
		MemberID: "member_2", Channel: ChannelSMS, Kind: KindAnnouncement, Body: "Notice",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if n.Status != StatusSuppressed || n.Reason != ReasonNoAddress {
		t.Fatalf("status = %s reason = %q", n.Status, n.Reason)
	}
}

// A transient provider failure retries with backoff and eventually succeeds.
func TestTransientFailureRetriesAndSucceeds(t *testing.T) {
	h := newHarness(t)
	h.sms.failuresBeforeSuccess = 2

	n, err := h.svc.Send(h.ctx, Message{
		MemberID: "member_1", Channel: ChannelSMS, Kind: KindTransactional, Body: "Receipt",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if n.Status != StatusQueued {
		t.Fatalf("a retryable failure should queue, got %s", n.Status)
	}
	if n.Attempts != 1 {
		t.Errorf("attempts = %d, want 1", n.Attempts)
	}
	if n.NextAttemptAt == nil {
		t.Fatal("a retry needs a scheduled time")
	}

	// Backoff must grow, not hammer the provider.
	first := n.NextAttemptAt.Sub(h.now)
	h.now = n.NextAttemptAt.Add(time.Second)
	if _, err := h.svc.Retry(h.ctx, 10); err != nil {
		t.Fatalf("Retry: %v", err)
	}

	after, err := h.svc.ByID(h.ctx, n.ID.Hex())
	if err != nil {
		t.Fatalf("ByID: %v", err)
	}
	if after.Attempts != 2 {
		t.Fatalf("attempts = %d, want 2", after.Attempts)
	}
	second := after.NextAttemptAt.Sub(h.now)
	if second <= first {
		t.Errorf("backoff did not grow: %v then %v", first, second)
	}

	// Third attempt succeeds.
	h.now = after.NextAttemptAt.Add(time.Second)
	sent, err := h.svc.Retry(h.ctx, 10)
	if err != nil {
		t.Fatalf("Retry: %v", err)
	}
	if sent != 1 {
		t.Fatalf("Retry sent %d, want 1", sent)
	}
	final, _ := h.svc.ByID(h.ctx, n.ID.Hex())
	if final.Status != StatusSent {
		t.Errorf("final status = %s, want sent", final.Status)
	}
}

// A permanent rejection must not be retried forever.
func TestPermanentFailureIsNotRetried(t *testing.T) {
	h := newHarness(t)
	h.sms.err = errors.New("invalid recipient number")

	n, err := h.svc.Send(h.ctx, Message{
		MemberID: "member_1", Channel: ChannelSMS, Kind: KindTransactional, Body: "Receipt",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if n.Status != StatusFailed {
		t.Fatalf("status = %s, want failed", n.Status)
	}
	if n.NextAttemptAt != nil {
		t.Error("a permanent failure must not be rescheduled")
	}
	if !strings.Contains(n.Reason, "invalid recipient") {
		t.Errorf("the reason should be actionable, got %q", n.Reason)
	}
}

// Retries must stop eventually. A receipt two days late is worse than none,
// because the member has already contacted the church.
func TestRetriesAreAbandonedAfterMaxAttempts(t *testing.T) {
	h := newHarness(t)
	h.sms.failuresBeforeSuccess = 1000 // never succeeds

	n, err := h.svc.Send(h.ctx, Message{
		MemberID: "member_1", Channel: ChannelSMS, Kind: KindTransactional, Body: "Receipt",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}

	for i := 0; i < MaxAttempts+2; i++ {
		current, err := h.svc.ByID(h.ctx, n.ID.Hex())
		if err != nil {
			t.Fatalf("ByID: %v", err)
		}
		if current.Status != StatusQueued {
			break
		}
		h.now = current.NextAttemptAt.Add(time.Second)
		if _, err := h.svc.Retry(h.ctx, 10); err != nil {
			t.Fatalf("Retry: %v", err)
		}
	}

	final, _ := h.svc.ByID(h.ctx, n.ID.Hex())
	if final.Status != StatusFailed {
		t.Fatalf("status = %s after exhausting retries, want failed", final.Status)
	}
	if final.Attempts > MaxAttempts {
		t.Errorf("attempts = %d, want at most %d", final.Attempts, MaxAttempts)
	}
	if !strings.Contains(final.Reason, "abandoned") {
		t.Errorf("the reason should say it was abandoned, got %q", final.Reason)
	}
}

// A channel with no transport suppresses rather than fails, so a deployment
// with no email provider still sends SMS.
func TestMissingTransportSuppressesRatherThanFails(t *testing.T) {
	h := newHarness(t)
	h.cc.grant("member_1")

	n, err := h.svc.Send(h.ctx, Message{
		MemberID: "member_1", Channel: ChannelPush, Kind: KindAnnouncement,
		Body: "Notice", Address: "device_token_1",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if n.Status != StatusSuppressed {
		t.Fatalf("status = %s, want suppressed", n.Status)
	}
	if !strings.Contains(n.Reason, "no transport") {
		t.Errorf("reason = %q", n.Reason)
	}
}

// A broadcast must give every member their own dedupe key, or the first send
// deduplicates away everyone else's copy.
func TestBroadcastReachesEveryConsentingMember(t *testing.T) {
	h := newHarness(t)

	ids := []string{"member_1", "member_2", "member_3"}
	for i, id := range ids {
		h.dir.add(&Recipient{MemberID: id, PhoneE164: "+23324123456" + string(rune('0'+i))})
		h.cc.grant(id)
	}
	// member_3 has not consented.
	h.cc.revoke("member_3")

	results, err := h.svc.Broadcast(h.ctx, ids, Message{
		Channel: ChannelSMS, Kind: KindAnnouncement,
		Body: "Service moves to 9am.", DedupeKey: "announce_2026_07_29",
	})
	if err != nil {
		t.Fatalf("Broadcast: %v", err)
	}
	if len(results) != 3 {
		t.Fatalf("want 3 outcomes, got %d", len(results))
	}

	sent, suppressed := 0, 0
	for _, r := range results {
		switch r.Status {
		case StatusSent:
			sent++
		case StatusSuppressed:
			suppressed++
		}
	}
	if sent != 2 {
		t.Errorf("2 consenting members should be reached, got %d", sent)
	}
	if suppressed != 1 {
		t.Errorf("the non-consenting member should be suppressed, got %d", suppressed)
	}
	if h.sms.count() != 2 {
		t.Errorf("transport saw %d messages, want 2", h.sms.count())
	}
}

// A church can answer "did they get told?".
func TestHistoryRecordsSuppressionsToo(t *testing.T) {
	h := newHarness(t)

	// One suppressed, one sent.
	if _, err := h.svc.Send(h.ctx, Message{
		MemberID: "member_1", Channel: ChannelSMS, Kind: KindAnnouncement, Body: "Notice",
	}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if _, err := h.svc.Send(h.ctx, Message{
		MemberID: "member_1", Channel: ChannelSMS, Kind: KindTransactional, Body: "Receipt",
	}); err != nil {
		t.Fatalf("Send: %v", err)
	}

	history, err := h.svc.History(h.ctx, "member_1", 50)
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(history) != 2 {
		t.Fatalf("want 2 records, got %d", len(history))
	}
	// The suppression must be visible with its reason, or a church cannot
	// explain why a member was not reached.
	found := false
	for _, n := range history {
		if n.Status == StatusSuppressed && n.Reason == ReasonNoConsent {
			found = true
		}
	}
	if !found {
		t.Error("the suppressed message and its reason must appear in history")
	}
}

// Delivery reports arrive after the send and must reconcile by provider ref.
func TestDeliveryReportUpdatesStatus(t *testing.T) {
	h := newHarness(t)

	n, err := h.svc.Send(h.ctx, Message{
		MemberID: "member_1", Channel: ChannelSMS, Kind: KindTransactional,
		Body: "Receipt", DedupeKey: "tx_1",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if n.ProviderRef == "" {
		t.Fatal("a sent message needs the provider reference for reconciliation")
	}

	if err := h.svc.MarkDelivered(h.ctx, n.ProviderRef); err != nil {
		t.Fatalf("MarkDelivered: %v", err)
	}
	after, _ := h.svc.ByID(h.ctx, n.ID.Hex())
	if after.Status != StatusDelivered {
		t.Errorf("status = %s, want delivered", after.Status)
	}

	if err := h.svc.MarkDelivered(h.ctx, "prov_unknown"); !errors.Is(err, ErrNotFound) {
		t.Errorf("an unknown reference should be ErrNotFound, got %v", err)
	}
}

// A consent service that is down must not be read as "no consent" — that
// would silently stop all communications during an outage. It is an error.
func TestConsentOutageIsAnErrorNotASuppression(t *testing.T) {
	h := newHarness(t)
	h.cc.err = errors.New("consent service unavailable")

	if _, err := h.svc.Send(h.ctx, Message{
		MemberID: "member_1", Channel: ChannelSMS, Kind: KindAnnouncement, Body: "Notice",
	}); err == nil {
		t.Fatal("a consent outage must surface as an error, not a silent suppression")
	}
	if h.sms.count() != 0 {
		t.Error("nothing should have been sent")
	}
}

// Notifications are tenant-scoped like everything else.
func TestNotificationsDoNotCrossChurches(t *testing.T) {
	h := newHarness(t)
	other := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: "other_church", UserID: "u", Role: "CHURCH_ADMIN",
	})

	if _, err := h.svc.Send(h.ctx, Message{
		MemberID: "member_1", Channel: ChannelSMS, Kind: KindTransactional, Body: "Receipt",
	}); err != nil {
		t.Fatalf("Send: %v", err)
	}

	history, err := h.svc.History(other, "member_1", 50)
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(history) != 0 {
		t.Fatalf("another church sees %d notifications, want 0", len(history))
	}
}

// A preference set in one church must not silence the member in another.
func TestPreferencesAreScopedToTheChurch(t *testing.T) {
	h := newHarness(t)
	h.cc.grant("member_1")
	other := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: "other_church", UserID: "u", Role: "CHURCH_ADMIN",
	})

	if err := h.svc.Unsubscribe(h.ctx, "member_1"); err != nil {
		t.Fatalf("Unsubscribe: %v", err)
	}

	pref, err := h.svc.PreferenceFor(other, "member_1")
	if err != nil {
		t.Fatalf("PreferenceFor: %v", err)
	}
	if pref != nil && pref.Unsubscribed {
		t.Fatal("unsubscribing from one church must not unsubscribe from another")
	}
}

func TestSendRequiresATenant(t *testing.T) {
	h := newHarness(t)

	if _, err := h.svc.Send(context.Background(), Message{
		MemberID: "member_1", Channel: ChannelSMS, Kind: KindTransactional, Body: "x",
	}); !errors.Is(err, tenancy.ErrNoTenant) {
		t.Fatalf("want ErrNoTenant, got %v", err)
	}
}

func TestInvalidMessagesAreRefused(t *testing.T) {
	h := newHarness(t)

	cases := []struct {
		name string
		msg  Message
		want error
	}{
		{"no member", Message{Channel: ChannelSMS, Kind: KindTransactional, Body: "x"}, ErrNoRecipient},
		{"bad channel", Message{MemberID: "m", Channel: "carrier_pigeon", Kind: KindTransactional, Body: "x"}, ErrInvalidChannel},
		{"bad kind", Message{MemberID: "m", Channel: ChannelSMS, Kind: "spam", Body: "x"}, ErrInvalidKind},
		{"empty body", Message{MemberID: "m", Channel: ChannelSMS, Kind: KindTransactional}, ErrNoBody},
	}
	for _, c := range cases {
		if _, err := h.svc.Send(h.ctx, c.msg); !errors.Is(err, c.want) {
			t.Errorf("%s: want %v, got %v", c.name, c.want, err)
		}
	}
}

// Backoff must grow and then stop growing.
func TestBackoffGrowsThenCaps(t *testing.T) {
	previous := time.Duration(0)
	for attempt := 1; attempt <= 10; attempt++ {
		d := backoffFor(attempt)
		if d < previous {
			t.Fatalf("backoff shrank at attempt %d: %v after %v", attempt, d, previous)
		}
		if d > 30*time.Minute {
			t.Fatalf("backoff exceeded the ceiling at attempt %d: %v", attempt, d)
		}
		previous = d
	}
	if backoffFor(10) != 30*time.Minute {
		t.Errorf("backoff should reach the ceiling, got %v", backoffFor(10))
	}
}
