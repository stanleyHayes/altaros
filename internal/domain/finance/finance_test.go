package finance

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/money"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/payments"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

const (
	testChurch     = "church_finance_test"
	testSubaccount = "ACCT_grace_chapel"
)

// fakeGateway stands in for Paystack. Its Verify is what the service treats as
// authoritative, so the tests drive settlement through it rather than through
// webhook bodies — which is exactly the property under test.
type fakeGateway struct {
	mu sync.Mutex

	initialized []payments.ChargeRequest
	initErr     error

	// verify maps a reference to the answer the provider will give.
	verify    map[string]*payments.Verification
	verifyErr error
	// verifyCalls counts how often the provider was asked.
	verifyCalls map[string]int
}

func newFakeGateway() *fakeGateway {
	return &fakeGateway{
		verify:      map[string]*payments.Verification{},
		verifyCalls: map[string]int{},
	}
}

func (g *fakeGateway) UpdateSubaccountCommission(context.Context, string, int64) error {
	return nil
}

func (f *fakeGateway) Name() string { return "paystack" }

func (f *fakeGateway) CreateSubaccount(context.Context, payments.SubaccountRequest) (*payments.Subaccount, error) {
	return &payments.Subaccount{Code: testSubaccount}, nil
}

func (f *fakeGateway) Initialize(_ context.Context, req payments.ChargeRequest) (*payments.Charge, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.initErr != nil {
		return nil, f.initErr
	}
	f.initialized = append(f.initialized, req)
	return &payments.Charge{
		Reference:        req.Reference,
		AuthorizationURL: "https://checkout.paystack.com/" + req.Reference,
		AccessCode:       "ac_" + req.Reference,
		Status:           payments.StatusPending,
	}, nil
}

func (f *fakeGateway) Verify(_ context.Context, reference string) (*payments.Verification, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.verifyCalls[reference]++
	if f.verifyErr != nil {
		return nil, f.verifyErr
	}
	v, ok := f.verify[reference]
	if !ok {
		return nil, payments.ErrNotFound
	}
	copied := *v
	return &copied, nil
}

func (f *fakeGateway) ParseWebhook(string, []byte) (*payments.Event, error) {
	return nil, errors.New("not used in these tests")
}

// willSucceed arranges for a reference to verify as a successful payment.
func (f *fakeGateway) willSucceed(reference string, gross, providerFee, platformFee int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.verify[reference] = &payments.Verification{
		Reference:   reference,
		Status:      payments.StatusSuccess,
		Amount:      money.MustNew(gross, "GHS"),
		ProviderFee: money.MustNew(providerFee, "GHS"),
		PlatformFee: money.MustNew(platformFee, "GHS"),
		SettledTo:   testSubaccount,
		Channel:     money.ChannelMobileMoney,
		ProviderRef: "psk_" + reference,
	}
}

func (f *fakeGateway) willFail(reference, reason string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.verify[reference] = &payments.Verification{
		Reference:     reference,
		Status:        payments.StatusFailed,
		Amount:        money.Zero("GHS"),
		FailureReason: reason,
	}
}

func (f *fakeGateway) lastCharge() payments.ChargeRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.initialized) == 0 {
		return payments.ChargeRequest{}
	}
	return f.initialized[len(f.initialized)-1]
}

// staticDirectory resolves every church to one payout config.
type staticDirectory struct {
	payout   *ChurchPayout
	err      error
	schedule money.FeeSchedule
}

func (d *staticDirectory) PayoutFor(context.Context, string) (*ChurchPayout, error) {
	return d.payout, d.err
}

func (d *staticDirectory) FeeScheduleFor(context.Context, string) (money.FeeSchedule, error) {
	return d.schedule, nil
}

type capturePublisher struct {
	mu     sync.Mutex
	events []struct {
		Topic   string
		Payload map[string]any
	}
}

func (c *capturePublisher) Publish(_ context.Context, topic, _ string, payload any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	m, _ := payload.(map[string]any)
	c.events = append(c.events, struct {
		Topic   string
		Payload map[string]any
	}{topic, m})
	return nil
}

func (c *capturePublisher) countOf(topic string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	n := 0
	for _, e := range c.events {
		if e.Topic == topic {
			n++
		}
	}
	return n
}

func (c *capturePublisher) firstOf(topic string) map[string]any {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, e := range c.events {
		if e.Topic == topic {
			return e.Payload
		}
	}
	return nil
}

type harness struct {
	svc *Service
	gw  *fakeGateway
	pub *capturePublisher
	dir *staticDirectory
	ctx context.Context
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
		Database:       "altar_test_finance",
		ConnectTimeout: 3 * time.Second,
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

	h := &harness{
		gw:  newFakeGateway(),
		pub: &capturePublisher{},
		dir: &staticDirectory{payout: &ChurchPayout{
			SubaccountCode:        testSubaccount,
			Currency:              "GHS",
			CommissionBasisPoints: 150, // 1.5%
			Name:                  "Grace Chapel",
		}},
	}
	h.svc = NewService(db, h.gw, h.dir, h.pub)
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

// give runs a full successful gift and returns the settled transaction.
func (h *harness) give(t *testing.T, amountMinor int64, typ Type) *Transaction {
	t.Helper()
	result, err := h.svc.StartGiving(h.ctx, GiveRequest{
		MemberID: "member_1",
		Type:     typ,
		Amount:   money.MustNew(amountMinor, "GHS"),
		Channel:  money.ChannelMobileMoney,
		Email:    "giver@example.com",
	})
	if err != nil {
		t.Fatalf("StartGiving: %v", err)
	}
	ref := result.Transaction.IdempotencyKey
	platformFee := amountMinor * 150 / 10000
	h.gw.willSucceed(ref, amountMinor, 195, platformFee)

	settled, err := h.svc.Settle(h.ctx, ref)
	if err != nil {
		t.Fatalf("Settle: %v", err)
	}
	return settled
}

// WP-14 acceptance: member gives via MoMo, the transaction settles, the
// church's balance reflects the NET, and giving.completed is emitted.
func TestGivingEndToEnd(t *testing.T) {
	h := newHarness(t)

	result, err := h.svc.StartGiving(h.ctx, GiveRequest{
		MemberID: "member_1",
		Type:     TypeTithe,
		Amount:   money.MustNew(10000, "GHS"), // GHS 100
		Channel:  money.ChannelMobileMoney,
		Email:    "ama@example.com",
	})
	if err != nil {
		t.Fatalf("StartGiving: %v", err)
	}

	if result.Transaction.Status != StatusPending {
		t.Errorf("a new gift is pending, got %s", result.Transaction.Status)
	}
	if result.AuthorizationURL == "" {
		t.Error("the giver needs somewhere to authorise")
	}
	// The levy must be quoted before the giver confirms (§2.3).
	if result.Levy.Reason == "" {
		t.Error("the giver must be told the levy position before authorising")
	}

	// ADR-002: the charge must carry the church's subaccount and our split.
	charge := h.gw.lastCharge()
	if charge.SubaccountCode != testSubaccount {
		t.Errorf("charge settles to %q, want the church's subaccount", charge.SubaccountCode)
	}
	if charge.PlatformFee.Minor != 150 { // 1.5% of GHS 100
		t.Errorf("platform fee sent = %s, want GHS 1.50", charge.PlatformFee)
	}
	if charge.Metadata["churchId"] != testChurch {
		t.Errorf("the charge must carry churchId for webhook attribution, got %v", charge.Metadata)
	}

	// The provider confirms: GHS 100 gross, GHS 1.95 provider fee, GHS 1.50 split.
	ref := result.Transaction.IdempotencyKey
	h.gw.willSucceed(ref, 10000, 195, 150)

	settled, err := h.svc.Settle(h.ctx, ref)
	if err != nil {
		t.Fatalf("Settle: %v", err)
	}
	if settled.Status != StatusSuccess {
		t.Fatalf("status = %s, want success", settled.Status)
	}
	if settled.NetMinor != 9655 { // 10000 - 195 - 150
		t.Errorf("net = %s, want GHS 96.55", settled.Net())
	}
	if settled.ProviderRef == "" {
		t.Error("the provider reference must be stored (§5.2 uq_provider_ref)")
	}
	if settled.SettledAt == nil {
		t.Error("a settled transaction needs a settlement time")
	}

	// The church's balance is the NET, not the gross.
	summary, err := h.svc.Summarize(h.ctx, time.Time{}, time.Time{}, "GHS")
	if err != nil {
		t.Fatalf("Summarize: %v", err)
	}
	if summary.Income.Minor != 9655 {
		t.Errorf("church income = %s, want GHS 96.55 (net, not gross)", summary.Income)
	}
	if summary.Balance.Minor != 9655 {
		t.Errorf("balance = %s, want GHS 96.55", summary.Balance)
	}
	if summary.Gross.Minor != 10000 {
		t.Errorf("gross = %s, want GHS 100.00", summary.Gross)
	}

	// giving.completed is what the notification service consumes.
	if h.pub.countOf(TopicGivingCompleted) != 1 {
		t.Fatalf("want 1 giving.completed, got %d", h.pub.countOf(TopicGivingCompleted))
	}
	event := h.pub.firstOf(TopicGivingCompleted)
	if event["churchId"] != testChurch {
		t.Errorf("event churchId = %v", event["churchId"])
	}
	if event["netMinor"] != int64(9655) {
		t.Errorf("event netMinor = %v, want 9655", event["netMinor"])
	}
}

// The acceptance criterion carried over from WP-13: replaying settlement must
// produce exactly one transaction and exactly one completion event.
func TestSettlingThreeTimesRecordsOneTransaction(t *testing.T) {
	h := newHarness(t)

	result, err := h.svc.StartGiving(h.ctx, GiveRequest{
		MemberID: "member_1",
		Type:     TypeOffering,
		Amount:   money.MustNew(5000, "GHS"),
		Channel:  money.ChannelMobileMoney,
		Email:    "giver@example.com",
	})
	if err != nil {
		t.Fatalf("StartGiving: %v", err)
	}
	ref := result.Transaction.IdempotencyKey
	h.gw.willSucceed(ref, 5000, 100, 75)

	for i := 0; i < 3; i++ {
		settled, err := h.svc.Settle(h.ctx, ref)
		if err != nil {
			t.Fatalf("settlement %d: %v", i+1, err)
		}
		if settled.Status != StatusSuccess {
			t.Fatalf("settlement %d: status = %s", i+1, settled.Status)
		}
	}

	count, err := h.svc.Count(h.ctx, Query{})
	if err != nil {
		t.Fatalf("Count: %v", err)
	}
	if count != 1 {
		t.Fatalf("3 settlements produced %d transactions, want exactly 1", count)
	}
	if got := h.pub.countOf(TopicGivingCompleted); got != 1 {
		t.Fatalf("3 settlements emitted %d completion events, want exactly 1", got)
	}

	// The balance must not have tripled.
	summary, _ := h.svc.Summarize(h.ctx, time.Time{}, time.Time{}, "GHS")
	if summary.Income.Minor != 4825 { // 5000 - 100 - 75
		t.Errorf("income = %s, want GHS 48.25 counted once", summary.Income)
	}
}

// Concurrent deliveries race each other; exactly one may perform the
// transition. This is the case a plain read-then-write loses.
func TestConcurrentSettlementRecordsOnce(t *testing.T) {
	h := newHarness(t)

	result, err := h.svc.StartGiving(h.ctx, GiveRequest{
		MemberID: "member_1",
		Type:     TypeTithe,
		Amount:   money.MustNew(20000, "GHS"),
		Channel:  money.ChannelMobileMoney,
		Email:    "giver@example.com",
	})
	if err != nil {
		t.Fatalf("StartGiving: %v", err)
	}
	ref := result.Transaction.IdempotencyKey
	h.gw.willSucceed(ref, 20000, 300, 300)

	const racers = 8
	var wg sync.WaitGroup
	errs := make([]error, racers)
	wg.Add(racers)
	for i := 0; i < racers; i++ {
		go func(i int) {
			defer wg.Done()
			_, errs[i] = h.svc.Settle(h.ctx, ref)
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Errorf("racer %d: %v", i, err)
		}
	}
	if count, _ := h.svc.Count(h.ctx, Query{}); count != 1 {
		t.Fatalf("%d concurrent settlements produced %d transactions, want 1", racers, count)
	}
	if got := h.pub.countOf(TopicGivingCompleted); got != 1 {
		t.Fatalf("%d concurrent settlements emitted %d events, want exactly 1", racers, got)
	}
}

// A webhook arrives with no session, so the church has to be resolved from the
// reference before anything is written.
func TestWebhookSettlesWithoutATenantInContext(t *testing.T) {
	h := newHarness(t)

	result, err := h.svc.StartGiving(h.ctx, GiveRequest{
		MemberID: "member_1",
		Type:     TypeTithe,
		Amount:   money.MustNew(10000, "GHS"),
		Channel:  money.ChannelMobileMoney,
		Email:    "giver@example.com",
	})
	if err != nil {
		t.Fatalf("StartGiving: %v", err)
	}
	ref := result.Transaction.IdempotencyKey
	h.gw.willSucceed(ref, 10000, 195, 150)

	// No tenancy scope at all — this is what the webhook endpoint has.
	settled, err := h.svc.SettleFromWebhook(context.Background(), &payments.Event{
		ID:        "charge.success:1",
		Type:      payments.EventChargeSuccess,
		Reference: ref,
		Status:    payments.StatusSuccess,
		Amount:    money.MustNew(10000, "GHS"),
	})
	if err != nil {
		t.Fatalf("SettleFromWebhook: %v", err)
	}
	if settled.Status != StatusSuccess {
		t.Fatalf("status = %s, want success", settled.Status)
	}
	if settled.ChurchID.String() != testChurch {
		t.Errorf("settled against church %q, want %q", settled.ChurchID, testChurch)
	}
}

// The webhook body is not authoritative. A forged body claiming a huge amount
// must not become income, because settlement re-verifies with the provider.
func TestWebhookBodyIsNotTrustedForValue(t *testing.T) {
	h := newHarness(t)

	result, err := h.svc.StartGiving(h.ctx, GiveRequest{
		MemberID: "member_1",
		Type:     TypeTithe,
		Amount:   money.MustNew(10000, "GHS"), // GHS 100 was actually intended
		Channel:  money.ChannelMobileMoney,
		Email:    "giver@example.com",
	})
	if err != nil {
		t.Fatalf("StartGiving: %v", err)
	}
	ref := result.Transaction.IdempotencyKey
	// The provider's truth: GHS 100.
	h.gw.willSucceed(ref, 10000, 195, 150)

	// The webhook claims GHS 1,000,000.
	settled, err := h.svc.SettleFromWebhook(context.Background(), &payments.Event{
		ID:        "charge.success:1",
		Type:      payments.EventChargeSuccess,
		Reference: ref,
		Status:    payments.StatusSuccess,
		Amount:    money.MustNew(100000000, "GHS"),
	})
	if err != nil {
		t.Fatalf("SettleFromWebhook: %v", err)
	}
	if settled.GrossMinor != 10000 {
		t.Fatalf("recorded %s; the webhook's claimed amount must be ignored", settled.Gross())
	}
	if settled.NetMinor != 9655 {
		t.Errorf("net = %s, want GHS 96.55 from the provider's figures", settled.Net())
	}
}

// If the provider reports a different amount from the one we recorded, that is
// either a bug or an attack. Silently adopting the provider's number would
// hide both.
func TestAmountMismatchIsRefusedNotReconciled(t *testing.T) {
	h := newHarness(t)

	result, err := h.svc.StartGiving(h.ctx, GiveRequest{
		MemberID: "member_1",
		Type:     TypeTithe,
		Amount:   money.MustNew(10000, "GHS"),
		Channel:  money.ChannelMobileMoney,
		Email:    "giver@example.com",
	})
	if err != nil {
		t.Fatalf("StartGiving: %v", err)
	}
	ref := result.Transaction.IdempotencyKey
	h.gw.willSucceed(ref, 500, 10, 7) // provider says GHS 5, we recorded GHS 100

	if _, err := h.svc.Settle(h.ctx, ref); !errors.Is(err, ErrAmountMismatch) {
		t.Fatalf("want ErrAmountMismatch, got %v", err)
	}

	// The transaction stays pending for a human, not silently settled.
	tx, err := h.svc.ByReference(h.ctx, ref)
	if err != nil {
		t.Fatalf("ByReference: %v", err)
	}
	if tx.Status != StatusPending {
		t.Errorf("status = %s; a mismatch must not settle", tx.Status)
	}
	if h.pub.countOf(TopicGivingCompleted) != 0 {
		t.Error("a mismatched payment must not emit a completion event")
	}
}

// Money that reached a different merchant is not this church's income,
// however successful the payment was.
func TestPaymentSettledElsewhereIsRefused(t *testing.T) {
	h := newHarness(t)

	result, err := h.svc.StartGiving(h.ctx, GiveRequest{
		MemberID: "member_1",
		Type:     TypeTithe,
		Amount:   money.MustNew(10000, "GHS"),
		Channel:  money.ChannelMobileMoney,
		Email:    "giver@example.com",
	})
	if err != nil {
		t.Fatalf("StartGiving: %v", err)
	}
	ref := result.Transaction.IdempotencyKey
	h.gw.willSucceed(ref, 10000, 195, 150)
	h.gw.verify[ref].SettledTo = "ACCT_someone_else"

	if _, err := h.svc.Settle(h.ctx, ref); !errors.Is(err, ErrWrongSettlement) {
		t.Fatalf("want ErrWrongSettlement, got %v", err)
	}
}

// ADR-002: without a subaccount the money would settle to ALTAR OS. Refusing
// the gift is correct; taking custody is not.
func TestGivingWithoutASubaccountIsRefused(t *testing.T) {
	h := newHarness(t)
	h.dir.payout = &ChurchPayout{Currency: "GHS", CommissionBasisPoints: 150}

	_, err := h.svc.StartGiving(h.ctx, GiveRequest{
		Type:    TypeTithe,
		Amount:  money.MustNew(10000, "GHS"),
		Channel: money.ChannelMobileMoney,
		Email:   "giver@example.com",
	})
	if !errors.Is(err, ErrNoSubaccount) {
		t.Fatalf("want ErrNoSubaccount, got %v", err)
	}
	if count, _ := h.svc.Count(h.ctx, Query{}); count != 0 {
		t.Error("no transaction should have been recorded")
	}
}

// A failed payment must be recorded as failed with a reason, and must not
// count as income.
func TestFailedPaymentIsRecordedAndExcluded(t *testing.T) {
	h := newHarness(t)

	result, err := h.svc.StartGiving(h.ctx, GiveRequest{
		MemberID: "member_1",
		Type:     TypeTithe,
		Amount:   money.MustNew(10000, "GHS"),
		Channel:  money.ChannelMobileMoney,
		Email:    "giver@example.com",
	})
	if err != nil {
		t.Fatalf("StartGiving: %v", err)
	}
	ref := result.Transaction.IdempotencyKey
	h.gw.willFail(ref, "Insufficient funds")

	failed, err := h.svc.Settle(h.ctx, ref)
	if err != nil {
		t.Fatalf("Settle: %v", err)
	}
	if failed.Status != StatusFailed {
		t.Errorf("status = %s, want failed", failed.Status)
	}
	if failed.FailureReason != "Insufficient funds" {
		t.Errorf("the giver needs a reason, got %q", failed.FailureReason)
	}

	summary, _ := h.svc.Summarize(h.ctx, time.Time{}, time.Time{}, "GHS")
	if summary.Income.Minor != 0 {
		t.Errorf("a failed payment must not be income, got %s", summary.Income)
	}
	if h.pub.countOf(TopicGivingFailed) != 1 {
		t.Errorf("want 1 giving.failed, got %d", h.pub.countOf(TopicGivingFailed))
	}
}

// An abandoned checkout must not inflate reported giving. Pending rows
// outnumber successful ones whenever a payment page is opened and closed.
func TestPendingGiftsAreNotIncome(t *testing.T) {
	h := newHarness(t)

	for i := 0; i < 5; i++ {
		if _, err := h.svc.StartGiving(h.ctx, GiveRequest{
			Type:    TypeOffering,
			Amount:  money.MustNew(50000, "GHS"),
			Channel: money.ChannelMobileMoney,
			Email:   "giver@example.com",
		}); err != nil {
			t.Fatalf("StartGiving: %v", err)
		}
	}

	summary, err := h.svc.Summarize(h.ctx, time.Time{}, time.Time{}, "GHS")
	if err != nil {
		t.Fatalf("Summarize: %v", err)
	}
	if summary.Income.Minor != 0 {
		t.Fatalf("5 abandoned checkouts reported %s of income, want zero", summary.Income)
	}
	if summary.Count != 0 {
		t.Errorf("count = %d, want 0", summary.Count)
	}
}

// Cash bypasses settlement entirely: no provider, no fees, gross equals net.
func TestCashOfferingIsRecordedWithoutFees(t *testing.T) {
	h := newHarness(t)

	sunday := time.Date(2026, 7, 26, 10, 0, 0, 0, time.UTC)
	tx, err := h.svc.RecordCash(h.ctx, CashRequest{
		Type:       TypeOffering,
		Amount:     money.MustNew(125050, "GHS"), // GHS 1,250.50 counted
		Note:       "Sunday second service",
		OccurredAt: sunday,
	})
	if err != nil {
		t.Fatalf("RecordCash: %v", err)
	}

	if tx.Status != StatusSuccess {
		t.Errorf("cash is settled on entry, got %s", tx.Status)
	}
	if tx.NetMinor != tx.GrossMinor {
		t.Errorf("cash has no fees: net %s != gross %s", tx.Net(), tx.Gross())
	}
	if tx.Provider != "" {
		t.Errorf("cash has no provider, got %q", tx.Provider)
	}
	// Money counted at a service needs an attributable human (§8.2).
	if tx.RecordedBy.String() != "admin_1" {
		t.Errorf("recordedBy = %q, want the counting user", tx.RecordedBy)
	}
	// Entered on Tuesday, but it happened on Sunday.
	if !tx.OccurredAt.Equal(sunday) {
		t.Errorf("occurredAt = %v, want the Sunday it was counted", tx.OccurredAt)
	}
}

// Expenses reduce the balance; income and expenditure must not be summed
// together.
func TestExpensesReduceTheBalance(t *testing.T) {
	h := newHarness(t)

	if _, err := h.svc.RecordCash(h.ctx, CashRequest{
		Type:   TypeOffering,
		Amount: money.MustNew(100000, "GHS"), // GHS 1,000 in
	}); err != nil {
		t.Fatalf("income: %v", err)
	}
	if _, err := h.svc.RecordCash(h.ctx, CashRequest{
		Type:      TypeExpense,
		Direction: DirectionExpense,
		Amount:    money.MustNew(30000, "GHS"), // GHS 300 out
		Note:      "Generator fuel",
	}); err != nil {
		t.Fatalf("expense: %v", err)
	}

	summary, err := h.svc.Summarize(h.ctx, time.Time{}, time.Time{}, "GHS")
	if err != nil {
		t.Fatalf("Summarize: %v", err)
	}
	if summary.Income.Minor != 100000 {
		t.Errorf("income = %s, want GHS 1,000", summary.Income)
	}
	if summary.Expenses.Minor != 30000 {
		t.Errorf("expenses = %s, want GHS 300", summary.Expenses)
	}
	if summary.Balance.Minor != 70000 {
		t.Errorf("balance = %s, want GHS 700", summary.Balance)
	}
}

func TestSummaryBreaksDownByType(t *testing.T) {
	h := newHarness(t)

	h.give(t, 10000, TypeTithe)
	h.give(t, 20000, TypeTithe)
	h.give(t, 5000, TypeOffering)

	summary, err := h.svc.Summarize(h.ctx, time.Time{}, time.Time{}, "GHS")
	if err != nil {
		t.Fatalf("Summarize: %v", err)
	}
	if summary.Count != 3 {
		t.Errorf("count = %d, want 3", summary.Count)
	}
	if len(summary.ByType) != 2 {
		t.Fatalf("want tithe and offering, got %v", summary.ByType)
	}
	if summary.ByType[TypeTithe].Minor <= summary.ByType[TypeOffering].Minor {
		t.Error("tithes here total more than offerings")
	}
}

// A member's statement must lead with what actually left their wallet, or it
// reads as a mistake against their own MoMo statement.
func TestMemberStatementReportsWhatWasDebited(t *testing.T) {
	h := newHarness(t)

	// GHS 150 crosses the GHS 100 daily allowance, so a levy applies.
	result, err := h.svc.StartGiving(h.ctx, GiveRequest{
		MemberID: "member_1",
		Type:     TypeTithe,
		Amount:   money.MustNew(15000, "GHS"),
		Channel:  money.ChannelMobileMoney,
		Email:    "giver@example.com",
	})
	if err != nil {
		t.Fatalf("StartGiving: %v", err)
	}
	if result.Levy.Exempt {
		t.Fatal("GHS 150 in one transfer exceeds the daily allowance")
	}
	ref := result.Transaction.IdempotencyKey
	h.gw.willSucceed(ref, 15000, 225, 225)
	if _, err := h.svc.Settle(h.ctx, ref); err != nil {
		t.Fatalf("Settle: %v", err)
	}

	giving, err := h.svc.GivingFor(h.ctx, "member_1", time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("GivingFor: %v", err)
	}
	if giving.Total.Minor != 15000 {
		t.Errorf("gift total = %s, want GHS 150", giving.Total)
	}
	// The levy is on top: GHS 150 + GHS 0.50.
	if giving.Debited.Minor != 15050 {
		t.Errorf("debited = %s, want GHS 150.50 (gift plus levy)", giving.Debited)
	}
	if giving.Count != 1 {
		t.Errorf("count = %d, want 1", giving.Count)
	}
}

// The levy threshold is cumulative per day, so the second gift must be quoted
// against what the member already gave.
func TestDailyTotalDrivesTheLevyQuote(t *testing.T) {
	h := newHarness(t)

	// First gift: GHS 80, inside the allowance.
	first := h.give(t, 8000, TypeOffering)
	if first.LevyMinor != 0 {
		t.Errorf("GHS 80 is within the allowance, got levy %s", first.Levy())
	}

	priorToday, err := h.svc.GivenTodayMinor(h.ctx, "member_1", time.Now())
	if err != nil {
		t.Fatalf("GivenTodayMinor: %v", err)
	}
	if priorToday != 8000 {
		t.Fatalf("prior today = %d, want 8000", priorToday)
	}

	// Second gift of GHS 50 crosses GHS 100; only GHS 30 is levied.
	result, err := h.svc.StartGiving(h.ctx, GiveRequest{
		MemberID:        "member_1",
		Type:            TypeOffering,
		Amount:          money.MustNew(5000, "GHS"),
		Channel:         money.ChannelMobileMoney,
		Email:           "giver@example.com",
		PriorTodayMinor: priorToday,
	})
	if err != nil {
		t.Fatalf("StartGiving: %v", err)
	}
	if result.Levy.Exempt {
		t.Fatal("the second gift crosses the daily threshold")
	}
	if result.Levy.Levy.Minor != 30 { // 1% of GHS 30
		t.Errorf("levy = %s, want GHS 0.30 on the GHS 30 above the allowance", result.Levy.Levy)
	}
}

// Cash does not consume the electronic transfer allowance.
func TestCashDoesNotConsumeTheLevyAllowance(t *testing.T) {
	h := newHarness(t)

	if _, err := h.svc.RecordCash(h.ctx, CashRequest{
		MemberID: "member_1",
		Type:     TypeOffering,
		Amount:   money.MustNew(50000, "GHS"), // GHS 500 in cash
	}); err != nil {
		t.Fatalf("RecordCash: %v", err)
	}

	prior, err := h.svc.GivenTodayMinor(h.ctx, "member_1", time.Now())
	if err != nil {
		t.Fatalf("GivenTodayMinor: %v", err)
	}
	if prior != 0 {
		t.Fatalf("cash is not an electronic transfer; prior = %d, want 0", prior)
	}
}

// Anonymous giving must stay possible — a visitor should not be forced to
// identify themselves to give.
func TestAnonymousGivingIsAllowed(t *testing.T) {
	h := newHarness(t)

	result, err := h.svc.StartGiving(h.ctx, GiveRequest{
		InitiatorID: "member_1",
		Type:        TypeDonation,
		Amount:      money.MustNew(5000, "GHS"),
		Channel:     money.ChannelMobileMoney,
		Email:       "visitor@example.com",
	})
	if err != nil {
		t.Fatalf("anonymous giving must work: %v", err)
	}
	if result.Transaction.MemberID != "" {
		t.Errorf("memberId should be empty, got %q", result.Transaction.MemberID)
	}
	if result.Transaction.InitiatedBy != "member_1" {
		t.Errorf("private initiator = %q, want member_1", result.Transaction.InitiatedBy)
	}

	ref := result.Transaction.IdempotencyKey
	h.gw.willSucceed(ref, 5000, 100, 75)
	if _, err := h.svc.Settle(h.ctx, ref); err != nil {
		t.Fatalf("settle anonymous gift: %v", err)
	}
	prior, err := h.svc.GivenTodayMinor(h.ctx, "member_1", time.Now())
	if err != nil {
		t.Fatalf("anonymous daily total: %v", err)
	}
	if prior != 5000 {
		t.Fatalf("anonymous gift must still consume private daily allowance: got %d", prior)
	}
	history, err := h.svc.List(h.ctx, Query{OwnerID: "member_1"})
	if err != nil {
		t.Fatalf("private anonymous history: %v", err)
	}
	if len(history) != 1 || history[0].MemberID != "" {
		t.Fatalf("private history should contain one still-anonymous gift: %#v", history)
	}
	completed := h.pub.firstOf(TopicGivingCompleted)
	if completed["memberId"] != "member_1" {
		t.Fatalf("receipt must target the private initiator, got %#v", completed)
	}
}

// Two members giving the same amount in the same second is ordinary on a
// Sunday; a derived idempotency key would make the second a duplicate.
func TestIdenticalConcurrentGiftsAreDistinct(t *testing.T) {
	h := newHarness(t)

	const givers = 12
	var wg sync.WaitGroup
	refs := make([]string, givers)
	errs := make([]error, givers)

	wg.Add(givers)
	for i := 0; i < givers; i++ {
		go func(i int) {
			defer wg.Done()
			result, err := h.svc.StartGiving(h.ctx, GiveRequest{
				MemberID: fmt.Sprintf("member_%d", i),
				Type:     TypeOffering,
				Amount:   money.MustNew(5000, "GHS"),
				Channel:  money.ChannelMobileMoney,
				Email:    "giver@example.com",
			})
			errs[i] = err
			if err == nil {
				refs[i] = result.Transaction.IdempotencyKey
			}
		}(i)
	}
	wg.Wait()

	unique := map[string]bool{}
	for i, err := range errs {
		if err != nil {
			t.Fatalf("giver %d: %v", i, err)
		}
		if unique[refs[i]] {
			t.Fatalf("giver %d reused reference %q", i, refs[i])
		}
		unique[refs[i]] = true
	}
	if count, _ := h.svc.Count(h.ctx, Query{}); count != givers {
		t.Fatalf("%d simultaneous gifts recorded %d transactions", givers, count)
	}
}

// Ledgers are tenant-scoped like everything else. A church must never see
// another's giving.
func TestLedgerDoesNotCrossChurches(t *testing.T) {
	h := newHarness(t)
	other := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: "other_church", UserID: "u", Role: "CHURCH_ADMIN",
	})

	h.give(t, 10000, TypeTithe)

	if count, _ := h.svc.Count(other, Query{}); count != 0 {
		t.Errorf("another church sees %d transactions, want 0", count)
	}
	summary, err := h.svc.Summarize(other, time.Time{}, time.Time{}, "GHS")
	if err != nil {
		t.Fatalf("Summarize: %v", err)
	}
	// The aggregation is the dangerous one: without a forced tenant stage a
	// $group would sum every church's giving into one number.
	if summary.Income.Minor != 0 {
		t.Fatalf("another church's summary reports %s of income, want zero", summary.Income)
	}
	if summary.Count != 0 {
		t.Errorf("another church's summary counts %d transactions, want 0", summary.Count)
	}
}

func TestLedgerRequiresATenant(t *testing.T) {
	h := newHarness(t)

	if _, err := h.svc.Count(context.Background(), Query{}); !errors.Is(err, tenancy.ErrNoTenant) {
		t.Errorf("Count without a tenant: want ErrNoTenant, got %v", err)
	}
	if _, err := h.svc.Summarize(context.Background(), time.Time{}, time.Time{}, "GHS"); !errors.Is(err, tenancy.ErrNoTenant) {
		t.Errorf("Summarize without a tenant: want ErrNoTenant, got %v", err)
	}
	if _, err := h.svc.RecordCash(context.Background(), CashRequest{
		Type: TypeOffering, Amount: money.MustNew(100, "GHS"),
	}); !errors.Is(err, tenancy.ErrNoTenant) {
		t.Errorf("RecordCash without a tenant: want ErrNoTenant, got %v", err)
	}
}

func TestInvalidGiftsAreRefused(t *testing.T) {
	h := newHarness(t)

	cases := []struct {
		name string
		req  GiveRequest
		want error
	}{
		{"zero amount", GiveRequest{Type: TypeTithe, Amount: money.MustNew(0, "GHS"), Channel: money.ChannelMobileMoney, Email: "a@b.c"}, ErrAmountRequired},
		{"negative amount", GiveRequest{Type: TypeTithe, Amount: money.MustNew(-100, "GHS"), Channel: money.ChannelMobileMoney, Email: "a@b.c"}, ErrAmountRequired},
		{"unknown type", GiveRequest{Type: Type("bribe"), Amount: money.MustNew(100, "GHS"), Channel: money.ChannelMobileMoney, Email: "a@b.c"}, ErrInvalidType},
		{"expense via giving", GiveRequest{Type: TypeExpense, Amount: money.MustNew(100, "GHS"), Channel: money.ChannelMobileMoney, Email: "a@b.c"}, ErrInvalidType},
		{"unknown channel", GiveRequest{Type: TypeTithe, Amount: money.MustNew(100, "GHS"), Channel: "crypto", Email: "a@b.c"}, ErrInvalidChannel},
		{"cash via giving", GiveRequest{Type: TypeTithe, Amount: money.MustNew(100, "GHS"), Channel: money.ChannelCash, Email: "a@b.c"}, ErrInvalidChannel},
	}
	for _, c := range cases {
		if _, err := h.svc.StartGiving(h.ctx, c.req); !errors.Is(err, c.want) {
			t.Errorf("%s: want %v, got %v", c.name, c.want, err)
		}
	}
	if count, _ := h.svc.Count(h.ctx, Query{}); count != 0 {
		t.Error("no invalid gift should have been recorded")
	}
}

// If the provider call fails, the pending row must not be left hanging.
func TestFailedInitialisationDoesNotLeavePendingRows(t *testing.T) {
	h := newHarness(t)
	h.gw.initErr = errors.New("provider is down")

	if _, err := h.svc.StartGiving(h.ctx, GiveRequest{
		Type:    TypeTithe,
		Amount:  money.MustNew(10000, "GHS"),
		Channel: money.ChannelMobileMoney,
		Email:   "giver@example.com",
	}); err == nil {
		t.Fatal("want an error when the provider is down")
	}

	pending, err := h.svc.Count(h.ctx, Query{Status: StatusPending})
	if err != nil {
		t.Fatalf("Count: %v", err)
	}
	if pending != 0 {
		t.Errorf("%d rows left pending after a failed initialisation", pending)
	}
	failed, _ := h.svc.Count(h.ctx, Query{Status: StatusFailed})
	if failed != 1 {
		t.Errorf("the attempt should be recorded as failed, got %d", failed)
	}
}

// A webhook for a reference we never issued is not ours to record.
func TestWebhookForUnknownReferenceIsNotFound(t *testing.T) {
	h := newHarness(t)

	_, err := h.svc.SettleFromWebhook(context.Background(), &payments.Event{
		ID:        "charge.success:9",
		Type:      payments.EventChargeSuccess,
		Reference: "alt_never_issued",
	})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}

// A church settling in GHS must not be handed a gift denominated in NGN.
func TestCurrencyMustMatchTheChurch(t *testing.T) {
	h := newHarness(t)

	_, err := h.svc.StartGiving(h.ctx, GiveRequest{
		Type:    TypeTithe,
		Amount:  money.MustNew(10000, "NGN"),
		Channel: money.ChannelMobileMoney,
		Email:   "giver@example.com",
	})
	if !errors.Is(err, money.ErrCurrencyMismatch) {
		t.Fatalf("want ErrCurrencyMismatch, got %v", err)
	}
}

// Windowed reporting must not leak transactions from outside the window.
func TestSummaryRespectsTheWindow(t *testing.T) {
	h := newHarness(t)

	june := time.Date(2026, 6, 15, 10, 0, 0, 0, time.UTC)
	july := time.Date(2026, 7, 15, 10, 0, 0, 0, time.UTC)

	for _, when := range []time.Time{june, july} {
		if _, err := h.svc.RecordCash(h.ctx, CashRequest{
			Type: TypeOffering, Amount: money.MustNew(10000, "GHS"), OccurredAt: when,
		}); err != nil {
			t.Fatalf("RecordCash: %v", err)
		}
	}

	julyOnly, err := h.svc.Summarize(h.ctx,
		time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC),
		time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC), "GHS")
	if err != nil {
		t.Fatalf("Summarize: %v", err)
	}
	if julyOnly.Count != 1 {
		t.Fatalf("July should contain 1 transaction, got %d", julyOnly.Count)
	}
	if julyOnly.Income.Minor != 10000 {
		t.Errorf("July income = %s, want GHS 100", julyOnly.Income)
	}
}
