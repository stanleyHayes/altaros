package paystack

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/hayfordstanley/altar-os/internal/platform/money"
	"github.com/hayfordstanley/altar-os/internal/platform/payments"
)

const testKey = "sk_test_altar_os_key"

// recorder is a fake Paystack that records what it was asked.
type recorder struct {
	server   *httptest.Server
	requests []recorded
	handler  func(r recorded) (int, string)
}

type recorded struct {
	Method string
	// Path is the decoded path. RawPath is what actually went over the wire,
	// which is the only one that shows whether escaping happened.
	Path    string
	RawPath string
	Auth    string
	Body    map[string]any
}

func newRecorder(t *testing.T, handler func(r recorded) (int, string)) *recorder {
	t.Helper()
	rec := &recorder{handler: handler}
	rec.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		entry := recorded{
			Method:  r.Method,
			Path:    r.URL.Path,
			RawPath: r.URL.EscapedPath(),
			Auth:    r.Header.Get("Authorization"),
		}
		if len(raw) > 0 {
			_ = json.Unmarshal(raw, &entry.Body)
		}
		rec.requests = append(rec.requests, entry)

		code, body := rec.handler(entry)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(rec.server.Close)
	return rec
}

func (rec *recorder) gateway() *Gateway {
	return New(Config{
		SecretKey:                    testKey,
		BaseURL:                      rec.server.URL,
		DefaultCommissionBasisPoints: 150,
	})
}

func (rec *recorder) last() recorded {
	if len(rec.requests) == 0 {
		return recorded{}
	}
	return rec.requests[len(rec.requests)-1]
}

// ADR-002's hard invariant. A charge with no subaccount settles to ALTAR OS,
// which is custody of church funds and the licensed activity the whole design
// exists to avoid.
func TestChargeWithoutSubaccountIsRefused(t *testing.T) {
	rec := newRecorder(t, func(recorded) (int, string) {
		t.Error("a charge with no subaccount must never reach the provider")
		return 200, `{"status":true}`
	})

	_, err := rec.gateway().Initialize(context.Background(), payments.ChargeRequest{
		Reference: "ref_1",
		Amount:    money.MustNew(5000, "GHS"),
		Email:     "giver@example.com",
	})
	if err == nil {
		t.Fatal("want an error, got none")
	}
	if !strings.Contains(err.Error(), "ADR-002") {
		t.Errorf("the error should name the invariant it protects, got %q", err)
	}
}

// The split is what the business runs on, so the number we send must be the
// number we computed — not a percentage the provider re-rounds.
func TestChargeSendsExplicitPlatformSplit(t *testing.T) {
	rec := newRecorder(t, func(recorded) (int, string) {
		return 200, `{"status":true,"data":{"authorization_url":"https://checkout.paystack.com/x","access_code":"ac_1","reference":"ref_1"}}`
	})

	gift := money.MustNew(10000, "GHS") // GHS 100.00
	fee := gift.PercentBasisPoints(150) // 1.5% = GHS 1.50

	charge, err := rec.gateway().Initialize(context.Background(), payments.ChargeRequest{
		Reference:      "ref_1",
		Amount:         gift,
		PlatformFee:    fee,
		SubaccountCode: "ACCT_church_1",
		Channel:        money.ChannelMobileMoney,
		Email:          "giver@example.com",
		Metadata:       map[string]string{"churchId": "c1", "memberId": "m1"},
	})
	if err != nil {
		t.Fatalf("Initialize: %v", err)
	}
	if charge.Status != payments.StatusPending {
		t.Errorf("a new charge is pending, got %s", charge.Status)
	}
	if charge.AuthorizationURL == "" {
		t.Error("the giver needs somewhere to authorise the payment")
	}

	body := rec.last().Body
	if got := body["subaccount"]; got != "ACCT_church_1" {
		t.Errorf("subaccount = %v, want ACCT_church_1", got)
	}
	// transaction_charge overrides the subaccount's configured split, so this
	// exact amount goes to the main account.
	if got := body["transaction_charge"]; got != float64(150) {
		t.Errorf("transaction_charge = %v, want 150 (GHS 1.50 in pesewas)", got)
	}
	// Minor units go over the wire unchanged. The old TS draft did amount*100
	// on a float, which loses a pesewa on amounts like 0.10.
	if got := body["amount"]; got != "10000" {
		t.Errorf("amount = %v, want \"10000\" pesewas", got)
	}
	if got := body["currency"]; got != "GHS" {
		t.Errorf("currency = %v, want GHS", got)
	}
	// MoMo-first: offering a card form to someone who came to pay by mobile
	// money is the drop-off (§2.3).
	channels, _ := body["channels"].([]any)
	if len(channels) != 1 || channels[0] != "mobile_money" {
		t.Errorf("channels = %v, want [mobile_money]", body["channels"])
	}
	if rec.last().Auth != "Bearer "+testKey {
		t.Error("the request must be authenticated")
	}
}

// A fee that swallows the gift means a misconfigured commission; the church
// receiving nothing is worse than the charge failing.
func TestFeeCannotConsumeTheGift(t *testing.T) {
	rec := newRecorder(t, func(recorded) (int, string) {
		t.Error("this charge must never reach the provider")
		return 200, `{"status":true}`
	})

	for _, fee := range []int64{5000, 6000} {
		_, err := rec.gateway().Initialize(context.Background(), payments.ChargeRequest{
			Reference:      "ref_1",
			Amount:         money.MustNew(5000, "GHS"),
			PlatformFee:    money.MustNew(fee, "GHS"),
			SubaccountCode: "ACCT_1",
			Email:          "giver@example.com",
		})
		if err == nil {
			t.Errorf("a fee of %d against a gift of 5000 must be refused", fee)
		}
	}
}

func TestFeeCurrencyMustMatchTheGift(t *testing.T) {
	rec := newRecorder(t, func(recorded) (int, string) {
		t.Error("mismatched currencies must never reach the provider")
		return 200, `{"status":true}`
	})

	_, err := rec.gateway().Initialize(context.Background(), payments.ChargeRequest{
		Reference:      "ref_1",
		Amount:         money.MustNew(10000, "GHS"),
		PlatformFee:    money.MustNew(150, "NGN"),
		SubaccountCode: "ACCT_1",
		Email:          "giver@example.com",
	})
	if err == nil {
		t.Fatal("a fee in a different currency must be refused")
	}
}

// A retried initialise is idempotent, not a new charge. The caller needs to
// tell "already done" apart from "rejected".
func TestDuplicateReferenceIsDistinguishable(t *testing.T) {
	rec := newRecorder(t, func(recorded) (int, string) {
		return 400, `{"status":false,"message":"Duplicate Transaction Reference"}`
	})

	_, err := rec.gateway().Initialize(context.Background(), payments.ChargeRequest{
		Reference:      "ref_1",
		Amount:         money.MustNew(5000, "GHS"),
		SubaccountCode: "ACCT_1",
		Email:          "giver@example.com",
	})
	if !errors.Is(err, payments.ErrDuplicateReference) {
		t.Fatalf("want ErrDuplicateReference, got %v", err)
	}
}

func TestVerifyReadsTheSplitAndSettlement(t *testing.T) {
	rec := newRecorder(t, func(recorded) (int, string) {
		return 200, `{"status":true,"data":{
			"id": 3021482,
			"reference":"ref_1",
			"status":"success",
			"amount":10000,
			"currency":"GHS",
			"fees":195,
			"channel":"mobile_money",
			"paid_at":"2026-07-31T10:00:00.000Z",
			"subaccount":{"subaccount_code":"ACCT_church_1"},
			"fees_split":{"paystack":195,"integration":150,"subaccount":9655},
			"metadata":{"churchId":"c1","memberId":"m1"}
		}}`
	})

	v, err := rec.gateway().Verify(context.Background(), "ref_1")
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if v.Status != payments.StatusSuccess {
		t.Errorf("status = %s, want success", v.Status)
	}
	if v.Amount.Minor != 10000 || v.Amount.Currency != "GHS" {
		t.Errorf("amount = %s, want GHS 100.00", v.Amount)
	}
	if v.ProviderFee.Minor != 195 {
		t.Errorf("provider fee = %s, want GHS 1.95", v.ProviderFee)
	}
	if v.PlatformFee.Minor != 150 {
		t.Errorf("platform fee = %s, want GHS 1.50", v.PlatformFee)
	}
	// Where it settled decides whose income it is.
	if v.SettledTo != "ACCT_church_1" {
		t.Errorf("settled to %q, want ACCT_church_1", v.SettledTo)
	}
	// The provider ref satisfies the uq_provider_ref constraint in §5.2.
	if v.ProviderRef != "3021482" {
		t.Errorf("provider ref = %q, want 3021482", v.ProviderRef)
	}
	if v.Metadata["churchId"] != "c1" {
		t.Errorf("metadata should carry churchId, got %v", v.Metadata)
	}

	net, err := v.NetToChurch()
	if err != nil {
		t.Fatalf("NetToChurch: %v", err)
	}
	// GHS 100.00 - 1.95 provider - 1.50 platform = GHS 96.55
	if net.Minor != 9655 {
		t.Errorf("net to church = %s, want GHS 96.55", net)
	}
}

// A failed payment must carry a reason the giver can read, or support has
// nothing to tell them.
func TestVerifyExplainsFailure(t *testing.T) {
	rec := newRecorder(t, func(recorded) (int, string) {
		return 200, `{"status":true,"data":{
			"reference":"ref_1","status":"failed","amount":10000,"currency":"GHS",
			"gateway_response":"Insufficient funds"
		}}`
	})

	v, err := rec.gateway().Verify(context.Background(), "ref_1")
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if v.Status != payments.StatusFailed {
		t.Errorf("status = %s, want failed", v.Status)
	}
	if v.FailureReason != "Insufficient funds" {
		t.Errorf("failure reason = %q, want \"Insufficient funds\"", v.FailureReason)
	}
}

// A reference is caller-controlled; one containing a slash must not reach a
// different endpoint.
func TestVerifyEscapesTheReference(t *testing.T) {
	rec := newRecorder(t, func(recorded) (int, string) {
		return 200, `{"status":true,"data":{"reference":"x","status":"success","amount":1,"currency":"GHS"}}`
	})

	_, _ = rec.gateway().Verify(context.Background(), "../../subaccount")
	if got := rec.last().RawPath; got != "/transaction/verify/..%2F..%2Fsubaccount" {
		t.Errorf("wire path = %q; the reference must be escaped into one segment", got)
	}
}

// An unreachable provider is retryable; a rejected request is not. Retrying a
// rejection forever is how a queue backs up.
func TestOutagesAreDistinguishableFromRejections(t *testing.T) {
	outage := newRecorder(t, func(recorded) (int, string) {
		return 502, `{"status":false,"message":"Bad gateway"}`
	})
	_, err := outage.gateway().Verify(context.Background(), "ref_1")
	if !errors.Is(err, payments.ErrUnavailable) {
		t.Errorf("a 502 is an outage, got %v", err)
	}
	if !ErrIsRetryable(err) {
		t.Error("an outage should be retryable")
	}

	rejection := newRecorder(t, func(recorded) (int, string) {
		return 400, `{"status":false,"message":"Invalid amount"}`
	})
	_, err = rejection.gateway().Verify(context.Background(), "ref_1")
	if !errors.Is(err, payments.ErrProvider) {
		t.Errorf("a 400 is a rejection, got %v", err)
	}
	if ErrIsRetryable(err) {
		t.Error("a rejection must not be retried")
	}
}

// An HTML outage page from a proxy is not a Paystack answer and must not be
// read as one.
func TestNonJSONResponseIsNotTreatedAsSuccess(t *testing.T) {
	rec := newRecorder(t, func(recorded) (int, string) {
		return 200, `<html><body>Service Unavailable</body></html>`
	})
	if _, err := rec.gateway().Verify(context.Background(), "ref_1"); err == nil {
		t.Fatal("an HTML body must not verify as a successful payment")
	}
}

func TestUnknownReferenceIsNotFound(t *testing.T) {
	rec := newRecorder(t, func(recorded) (int, string) {
		return 404, `{"status":false,"message":"Transaction not found"}`
	})
	if _, err := rec.gateway().Verify(context.Background(), "nope"); !errors.Is(err, payments.ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}

// The stub this replaces returned success unconditionally. A gateway with no
// key must fail loudly rather than inherit that behaviour.
func TestUnconfiguredGatewayRefusesEverything(t *testing.T) {
	g := New(Config{})

	if _, err := g.Verify(context.Background(), "ref_1"); !errors.Is(err, payments.ErrNotConfigured) {
		t.Errorf("Verify: want ErrNotConfigured, got %v", err)
	}
	if _, err := g.Initialize(context.Background(), payments.ChargeRequest{
		Reference: "r", Amount: money.MustNew(100, "GHS"), SubaccountCode: "A", Email: "a@b.c",
	}); !errors.Is(err, payments.ErrNotConfigured) {
		t.Errorf("Initialize: want ErrNotConfigured, got %v", err)
	}
	if _, err := g.CreateSubaccount(context.Background(), payments.SubaccountRequest{
		BusinessName: "X", SettlementBank: "MTN", AccountNumber: "024",
	}); !errors.Is(err, payments.ErrNotConfigured) {
		t.Errorf("CreateSubaccount: want ErrNotConfigured, got %v", err)
	}
}

func TestCreateSubaccountSendsCommissionAsPercentage(t *testing.T) {
	rec := newRecorder(t, func(recorded) (int, string) {
		return 200, `{"status":true,"data":{
			"subaccount_code":"ACCT_church_1",
			"business_name":"Grace Chapel",
			"settlement_bank":"MTN",
			"account_number":"0241234567",
			"percentage_charge":1.5,
			"active":true
		}}`
	})

	sub, err := rec.gateway().CreateSubaccount(context.Background(), payments.SubaccountRequest{
		ChurchID:              "c1",
		BusinessName:          "Grace Chapel",
		SettlementBank:        "MTN",
		AccountNumber:         "0241234567",
		CommissionBasisPoints: 150,
	})
	if err != nil {
		t.Fatalf("CreateSubaccount: %v", err)
	}
	if sub.Code != "ACCT_church_1" {
		t.Errorf("code = %q", sub.Code)
	}
	// Round-trip through Paystack's percentage must return the same bps.
	if sub.CommissionBasisPoints != 150 {
		t.Errorf("commission = %d bps, want 150", sub.CommissionBasisPoints)
	}

	body := rec.last().Body
	if got := body["percentage_charge"]; got != 1.5 {
		t.Errorf("percentage_charge = %v, want 1.5", got)
	}
	// The name on the giver's statement must be the church's — they are
	// paying the church, not ALTAR OS.
	if got := body["business_name"]; got != "Grace Chapel" {
		t.Errorf("business_name = %v, want Grace Chapel", got)
	}
	meta, _ := body["metadata"].(map[string]any)
	if meta["churchId"] != "c1" {
		t.Errorf("metadata should trace back to the church, got %v", meta)
	}
}

func TestCommissionOutOfRangeIsRefused(t *testing.T) {
	rec := newRecorder(t, func(recorded) (int, string) {
		t.Error("an out-of-range commission must never reach the provider")
		return 200, `{"status":true}`
	})

	_, err := rec.gateway().CreateSubaccount(context.Background(), payments.SubaccountRequest{
		BusinessName: "X", SettlementBank: "MTN", AccountNumber: "024",
		CommissionBasisPoints: 20000, // 200%
	})
	if err == nil {
		t.Fatal("a 200% commission must be refused")
	}
}
