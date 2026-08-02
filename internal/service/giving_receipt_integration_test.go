package service

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/domain/consent"
	"github.com/hayfordstanley/altar-os/internal/domain/finance"
	"github.com/hayfordstanley/altar-os/internal/domain/member"
	"github.com/hayfordstanley/altar-os/internal/domain/notification"
	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/events"
	"github.com/hayfordstanley/altar-os/internal/platform/money"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/payments"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

// This is the flow WP-19 gates on and that nothing previously connected:
// a member gives, the payment settles, giving.completed reaches Kafka, the
// consumer picks it up, and an SMS receipt is sent.
//
// Both halves were built and tested against fakes. Neither was wired — finance
// was constructed with a nil publisher and SendGivingReceipt had no caller — so
// the flow could not have worked in production however green the unit tests
// were. This test exists to make that impossible to regress into.

// captureTransport records what the SMS transport was asked to send.
type captureTransport struct {
	mu   sync.Mutex
	sent []notification.Message
	fail error
}

func (c *captureTransport) Channel() notification.Channel { return notification.ChannelSMS }

func (c *captureTransport) Send(_ context.Context, _ string, msg notification.Message) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.fail != nil {
		return "", c.fail
	}
	c.sent = append(c.sent, msg)
	return "prov_" + msg.DedupeKey, nil
}

func (c *captureTransport) count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.sent)
}

func (c *captureTransport) bodies() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]string, 0, len(c.sent))
	for _, m := range c.sent {
		out = append(out, m.Body)
	}
	return out
}

// settledGateway is a payment provider that reports one reference as paid.
type settledGateway struct {
	mu     sync.Mutex
	verify map[string]*payments.Verification
}

func (g *settledGateway) Name() string { return "paystack" }

func (g *settledGateway) CreateSubaccount(context.Context, payments.SubaccountRequest) (*payments.Subaccount, error) {
	return &payments.Subaccount{Code: "ACCT_test"}, nil
}

func (g *settledGateway) Initialize(_ context.Context, req payments.ChargeRequest) (*payments.Charge, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.verify[req.Reference] = &payments.Verification{
		Reference:   req.Reference,
		Status:      payments.StatusSuccess,
		Amount:      req.Amount,
		ProviderFee: money.MustNew(195, req.Amount.Currency),
		PlatformFee: req.PlatformFee,
		SettledTo:   req.SubaccountCode,
		Channel:     money.ChannelMobileMoney,
		ProviderRef: "psk_" + req.Reference,
	}
	return &payments.Charge{Reference: req.Reference, Status: payments.StatusPending}, nil
}

func (g *settledGateway) Verify(_ context.Context, reference string) (*payments.Verification, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	v, ok := g.verify[reference]
	if !ok {
		return nil, payments.ErrNotFound
	}
	copied := *v
	return &copied, nil
}

func (g *settledGateway) ParseWebhook(string, []byte) (*payments.Event, error) {
	return nil, errors.New("not used")
}

type fixedPayout struct{}

func (fixedPayout) PayoutFor(context.Context, string) (*finance.ChurchPayout, error) {
	return &finance.ChurchPayout{
		SubaccountCode:        "ACCT_test",
		Currency:              "GHS",
		CommissionBasisPoints: 150,
		Name:                  "Grace Chapel",
	}, nil
}

func TestGivingProducesAnSMSReceiptThroughKafka(t *testing.T) {
	churchID := bson.NewObjectID().Hex()
	memberID := bson.NewObjectID().Hex()

	// --- infrastructure -----------------------------------------------------
	uri := os.Getenv("MONGODB_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}
	connectCtx, cancelConnect := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelConnect()

	db, err := mongodb.Connect(connectCtx, config.MongoConfig{
		URI:            uri,
		Database:       "altar_test_receipt_flow",
		ConnectTimeout: 5 * time.Second,
	})
	if err != nil {
		testsupport.SkipOrFail(t, "MongoDB", err)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = db.Database().Drop(c)
		_ = db.Close(c)
	})

	d := newTestDeps(t)
	d.Mongo = db

	brokers := []string{"127.0.0.1:19092"}
	if b := os.Getenv("KAFKA_BROKERS"); b != "" {
		brokers = strings.Split(b, ",")
	}
	// A unique group so this run consumes only its own messages.
	group := "test-receipt-" + churchID

	busCtx, cancelBus := context.WithTimeout(context.Background(), 10*time.Second)
	bus, err := events.NewBus(busCtx, events.Config{
		Brokers:       brokers,
		ConsumerGroup: group,
		Source:        "test",
		Log:           d.Log,
	})
	cancelBus()
	if err != nil {
		testsupport.SkipOrFail(t, "Kafka", err)
	}
	t.Cleanup(bus.Close)
	d.Events = bus
	d.Config.Kafka.ConsumerGroup = group

	if err := bus.EnsureTopics(context.Background(), events.KnownTopics, 1, 1); err != nil {
		t.Fatalf("EnsureTopics: %v", err)
	}

	ctx := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: churchID, UserID: memberID, Role: RoleMember,
	})

	// --- domain services, wired the way production wires them ---------------
	members := member.NewService(db, bus, "GH")
	consents := consent.NewService(db, bus)
	sms := &captureTransport{}
	notifications := notification.NewService(db,
		&consentGate{consents: consents},
		&memberDirectory{members: members},
		sms)

	for _, ensure := range []func(context.Context) error{
		members.EnsureIndexes, consents.EnsureIndexes, notifications.EnsureIndexes,
	} {
		if err := ensure(ctx); err != nil {
			t.Fatalf("EnsureIndexes: %v", err)
		}
	}

	// The member must exist, or the directory has no number to send to.
	created, err := members.Create(ctx, member.Input{
		FirstName: "Ama", LastName: "Owusu", Phone: "024 123 4567",
	})
	if err != nil {
		t.Fatalf("create member: %v", err)
	}
	giverID := created.ID.Hex()

	gateway := &settledGateway{verify: map[string]*payments.Verification{}}
	fin := finance.NewService(db, gateway, fixedPayout{}, bus)
	if err := fin.EnsureIndexes(ctx); err != nil {
		t.Fatalf("finance EnsureIndexes: %v", err)
	}

	// --- the consumer, as StartConsumers wires it ---------------------------
	deduper := events.NewDeduper(d.Redis, group, d.Log)
	consumeCtx, stopConsuming := context.WithCancel(context.Background())
	defer stopConsuming()

	handled := make(chan string, 1)
	var targetEventID atomic.Value
	targetEventID.Store("")
	inner := givingReceiptHandler(d, notifications, nil)
	err = bus.Consume(consumeCtx, map[string]events.Handler{
		events.TopicGivingCompleted: deduper.Wrap(func(c context.Context, e *events.Envelope, raw []byte) error {
			if err := inner(c, e, raw); err != nil {
				return err
			}
			// A unique consumer group begins at the topic's configured offset,
			// which may include records from prior test runs. Only the transaction
			// created below proves this flow, and ignoring older transactions prevents them
			// from filling the channel and deadlocking Bus.Close during cleanup.
			data, _ := e.Data.(map[string]any)
			if data["transactionId"] == targetEventID.Load().(string) {
				handled <- e.ID
			}
			return nil
		}),
	})
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}

	// --- the gift -----------------------------------------------------------
	giverCtx := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: churchID, UserID: giverID, Role: RoleMember,
	})

	result, err := fin.StartGiving(giverCtx, finance.GiveRequest{
		MemberID: giverID,
		Type:     finance.TypeTithe,
		Amount:   money.MustNew(10000, "GHS"), // GHS 100
		Channel:  money.ChannelMobileMoney,
		Email:    "ama@example.com",
	})
	if err != nil {
		t.Fatalf("StartGiving: %v", err)
	}
	targetEventID.Store(result.Transaction.ID.Hex())

	settled, err := fin.Settle(giverCtx, result.Transaction.IdempotencyKey)
	if err != nil {
		t.Fatalf("Settle: %v", err)
	}
	if settled.Status != finance.StatusSuccess {
		t.Fatalf("transaction status = %s, want success", settled.Status)
	}

	// --- the receipt --------------------------------------------------------
	select {
	case <-handled:
	case <-time.After(60 * time.Second):
		t.Fatal("giving.completed never reached the consumer; the gift and the " +
			"receipt are still not connected")
	}

	// Allow a moment for a (wrongly) duplicated send to show up.
	time.Sleep(2 * time.Second)

	if sms.count() != 1 {
		t.Fatalf("want exactly 1 SMS receipt, got %d", sms.count())
	}
	body := sms.bodies()[0]
	if !strings.Contains(body, "GHS 100.00") {
		t.Errorf("the receipt should state the gift, got %q", body)
	}

	// The stored notification must exist and be attributed to the church.
	var stored []notification.Notification
	stored, err = notifications.History(ctx, giverID, 10)
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(stored) != 1 {
		t.Fatalf("want 1 notification record, got %d", len(stored))
	}
	if stored[0].Status != notification.StatusSent {
		t.Errorf("notification status = %s (%s), want sent",
			stored[0].Status, stored[0].Reason)
	}
}

// §6: "a duplicate giving.completed must not send two receipts". The finance
// service already refuses to emit twice, so this drives the duplicate directly
// onto the bus — which is what a Kafka redelivery actually looks like.
func TestDuplicateGivingEventSendsOneReceipt(t *testing.T) {
	churchID := bson.NewObjectID().Hex()

	uri := os.Getenv("MONGODB_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}
	connectCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	db, err := mongodb.Connect(connectCtx, config.MongoConfig{
		URI:            uri,
		Database:       "altar_test_receipt_dupe",
		ConnectTimeout: 5 * time.Second,
	})
	if err != nil {
		testsupport.SkipOrFail(t, "MongoDB", err)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = db.Database().Drop(c)
		_ = db.Close(c)
	})

	d := newTestDeps(t)
	d.Mongo = db

	ctx := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: churchID, UserID: "admin", Role: RoleChurchAdmin,
	})

	members := member.NewService(db, nil, "GH")
	consents := consent.NewService(db, nil)
	sms := &captureTransport{}
	notifications := notification.NewService(db,
		&consentGate{consents: consents},
		&memberDirectory{members: members},
		sms)

	for _, ensure := range []func(context.Context) error{
		members.EnsureIndexes, consents.EnsureIndexes, notifications.EnsureIndexes,
	} {
		if err := ensure(ctx); err != nil {
			t.Fatalf("EnsureIndexes: %v", err)
		}
	}

	created, err := members.Create(ctx, member.Input{
		FirstName: "Kofi", LastName: "Boateng", Phone: "0209876543",
	})
	if err != nil {
		t.Fatalf("create member: %v", err)
	}

	handler := givingReceiptHandler(d, notifications, nil)
	raw := []byte(`{"data":{"transactionId":"tx_dupe_1","churchId":"` + churchID +
		`","memberId":"` + created.ID.Hex() +
		`","type":"tithe","channel":"mobile_money","grossMinor":5000,"netMinor":4900,"currency":"GHS"}}`)

	// Five redeliveries of the SAME domain fact, each with a DIFFERENT event
	// id — which is what a Kafka replay after a rebalance looks like, and the
	// case Redis dedupe alone cannot catch.
	for i := 0; i < 5; i++ {
		e := &events.Envelope{
			ID:      "evt_distinct_" + string(rune('a'+i)),
			Type:    events.TopicGivingCompleted,
			Subject: churchID,
		}
		if err := handler(context.Background(), e, raw); err != nil {
			t.Fatalf("delivery %d: %v", i+1, err)
		}
	}

	if sms.count() != 1 {
		t.Fatalf("5 redeliveries sent %d receipts, want exactly 1 — the "+
			"notification dedupe key is what has to catch this, because each "+
			"delivery had a different event id", sms.count())
	}
}
