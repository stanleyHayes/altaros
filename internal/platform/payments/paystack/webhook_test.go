package paystack

import (
	"errors"
	"strings"
	"testing"

	"github.com/hayfordstanley/altar-os/internal/platform/payments"
)

const successBody = `{"event":"charge.success","data":{"id":3021482,"reference":"ref_1","status":"success","amount":10000,"currency":"GHS","metadata":{"churchId":"c1","memberId":"m1"}}}`

func webhookGateway() *Gateway {
	return New(Config{SecretKey: testKey, BaseURL: "http://unused.invalid"})
}

func TestValidWebhookIsParsed(t *testing.T) {
	g := webhookGateway()
	body := []byte(successBody)

	event, err := g.ParseWebhook(SignPayload(testKey, body), body)
	if err != nil {
		t.Fatalf("ParseWebhook: %v", err)
	}
	if event.Type != payments.EventChargeSuccess {
		t.Errorf("type = %q, want charge.success", event.Type)
	}
	if event.Reference != "ref_1" {
		t.Errorf("reference = %q", event.Reference)
	}
	if event.Status != payments.StatusSuccess {
		t.Errorf("status = %s", event.Status)
	}
	if event.Amount.Minor != 10000 || event.Amount.Currency != "GHS" {
		t.Errorf("amount = %s, want GHS 100.00", event.Amount)
	}
	if event.Meta["churchId"] != "c1" {
		t.Errorf("metadata should carry churchId, got %v", event.Meta)
	}
}

// Without this check, anyone who can reach the endpoint can forge a payment.
func TestForgedWebhookIsRejected(t *testing.T) {
	g := webhookGateway()
	body := []byte(successBody)

	cases := []struct {
		name, signature string
	}{
		{"signed with the wrong key", SignPayload("sk_test_attacker", body)},
		{"no signature at all", ""},
		{"whitespace only", "   "},
		{"garbage", "not-a-signature"},
		{"empty hex", strings.Repeat("0", 128)},
	}
	for _, c := range cases {
		if _, err := g.ParseWebhook(c.signature, body); !errors.Is(err, payments.ErrInvalidSignature) {
			t.Errorf("%s: want ErrInvalidSignature, got %v", c.name, err)
		}
	}
}

// The signature covers the exact bytes, so a body altered after signing must
// not verify — this is what stops an amount being edited in transit.
func TestTamperedBodyIsRejected(t *testing.T) {
	g := webhookGateway()
	original := []byte(successBody)
	signature := SignPayload(testKey, original)

	tampered := []byte(strings.Replace(successBody, `"amount":10000`, `"amount":9999900`, 1))
	if _, err := g.ParseWebhook(signature, tampered); !errors.Is(err, payments.ErrInvalidSignature) {
		t.Fatalf("a tampered amount must not verify, got %v", err)
	}
}

// Paystack sends lowercase hex; tolerating case must not cost constant-time
// comparison or accept a wrong digest.
func TestSignatureCaseIsTolerated(t *testing.T) {
	g := webhookGateway()
	body := []byte(successBody)

	if _, err := g.ParseWebhook(strings.ToUpper(SignPayload(testKey, body)), body); err != nil {
		t.Fatalf("uppercase hex should verify: %v", err)
	}
}

// WP-13 acceptance: replaying the webhook three times must produce exactly one
// transaction. The adapter's job is a stable dedupe key; the consumer dedupes
// on it before granting value.
func TestReplayedWebhookYieldsOneDedupeKey(t *testing.T) {
	g := webhookGateway()
	body := []byte(successBody)
	signature := SignPayload(testKey, body)

	seen := map[string]int{}
	for i := 0; i < 3; i++ {
		event, err := g.ParseWebhook(signature, body)
		if err != nil {
			t.Fatalf("delivery %d: %v", i+1, err)
		}
		seen[event.ID]++
	}

	if len(seen) != 1 {
		t.Fatalf("3 deliveries of one event must share one dedupe key, got %d distinct: %v", len(seen), seen)
	}
	for id, count := range seen {
		if count != 3 {
			t.Errorf("key %q seen %d times, want 3", id, count)
		}
		// Scoped by event type: a charge.success and a later refund for the
		// same transaction are different events and must not collide.
		if !strings.HasPrefix(id, "charge.success:") {
			t.Errorf("dedupe key %q should be scoped by event type", id)
		}
	}
}

// Two different transactions must not share a dedupe key, or the second gift
// is silently discarded as a duplicate.
func TestDistinctTransactionsGetDistinctKeys(t *testing.T) {
	g := webhookGateway()

	first := []byte(successBody)
	second := []byte(strings.Replace(
		strings.Replace(successBody, `"id":3021482`, `"id":3021483`, 1),
		`"reference":"ref_1"`, `"reference":"ref_2"`, 1))

	a, err := g.ParseWebhook(SignPayload(testKey, first), first)
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	b, err := g.ParseWebhook(SignPayload(testKey, second), second)
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if a.ID == b.ID {
		t.Fatalf("two transactions share the dedupe key %q; the second gift would be discarded", a.ID)
	}
}

// A refund for the same transaction is a different event.
func TestDifferentEventTypesOnOneTransactionDoNotCollide(t *testing.T) {
	g := webhookGateway()

	charge := []byte(successBody)
	refund := []byte(strings.Replace(successBody, `"event":"charge.success"`, `"event":"refund.processed"`, 1))

	a, err := g.ParseWebhook(SignPayload(testKey, charge), charge)
	if err != nil {
		t.Fatalf("charge: %v", err)
	}
	b, err := g.ParseWebhook(SignPayload(testKey, refund), refund)
	if err != nil {
		t.Fatalf("refund: %v", err)
	}
	if a.ID == b.ID {
		t.Fatal("a refund must not be deduped away as a replay of the charge")
	}
}

// An event with no transaction id still needs a stable key, or every redelivery
// looks new.
func TestEventWithoutIDFallsBackToReference(t *testing.T) {
	g := webhookGateway()
	body := []byte(`{"event":"charge.success","data":{"reference":"ref_x","status":"success","amount":100,"currency":"GHS"}}`)
	signature := SignPayload(testKey, body)

	first, err := g.ParseWebhook(signature, body)
	if err != nil {
		t.Fatalf("ParseWebhook: %v", err)
	}
	second, _ := g.ParseWebhook(signature, body)

	if first.ID != second.ID {
		t.Fatal("the fallback key must be stable across deliveries")
	}
	if !strings.Contains(first.ID, "ref_x") {
		t.Errorf("key %q should fall back to the reference", first.ID)
	}
}

// The signature proved the sender, so an unreadable body is a contract change
// worth surfacing rather than a payment to drop silently.
func TestSignedButUnreadableBodyIsSurfaced(t *testing.T) {
	g := webhookGateway()

	notJSON := []byte(`this is not json`)
	if _, err := g.ParseWebhook(SignPayload(testKey, notJSON), notJSON); err == nil {
		t.Error("an unreadable body should error")
	} else if errors.Is(err, payments.ErrInvalidSignature) {
		t.Error("the signature was valid; the error should say the body is wrong")
	}

	noEvent := []byte(`{"data":{"reference":"r"}}`)
	if _, err := g.ParseWebhook(SignPayload(testKey, noEvent), noEvent); err == nil {
		t.Error("a webhook with no event type should error")
	}
}

// Paystack sometimes sends metadata as a JSON-encoded string rather than an
// object, and losing churchId means the payment cannot be attributed.
func TestMetadataAsEncodedStringIsDecoded(t *testing.T) {
	g := webhookGateway()
	body := []byte(`{"event":"charge.success","data":{"id":1,"reference":"r","status":"success","amount":100,"currency":"GHS","metadata":"{\"churchId\":\"c1\",\"memberId\":\"m9\"}"}}`)

	event, err := g.ParseWebhook(SignPayload(testKey, body), body)
	if err != nil {
		t.Fatalf("ParseWebhook: %v", err)
	}
	if event.Meta["churchId"] != "c1" || event.Meta["memberId"] != "m9" {
		t.Errorf("metadata not decoded from the encoded form: %v", event.Meta)
	}
}

// Numeric metadata is common from web forms and must survive.
func TestNumericMetadataIsPreserved(t *testing.T) {
	g := webhookGateway()
	body := []byte(`{"event":"charge.success","data":{"id":1,"reference":"r","status":"success","amount":100,"currency":"GHS","metadata":{"campaignId":42,"anonymous":true}}}`)

	event, err := g.ParseWebhook(SignPayload(testKey, body), body)
	if err != nil {
		t.Fatalf("ParseWebhook: %v", err)
	}
	if event.Meta["campaignId"] != "42" {
		t.Errorf("campaignId = %q, want \"42\"", event.Meta["campaignId"])
	}
	if event.Meta["anonymous"] != "true" {
		t.Errorf("anonymous = %q, want \"true\"", event.Meta["anonymous"])
	}
}

// A gateway with no signing key must refuse rather than accept everything.
func TestWebhookWithoutKeyRefuses(t *testing.T) {
	g := New(Config{})
	body := []byte(successBody)

	if _, err := g.ParseWebhook(SignPayload("anything", body), body); !errors.Is(err, payments.ErrNotConfigured) {
		t.Fatalf("want ErrNotConfigured, got %v", err)
	}
}

// A separately-configured webhook secret must actually be the key used, or a
// staged rotation silently verifies against the wrong one.
func TestExplicitWebhookSecretOverridesSecretKey(t *testing.T) {
	g := New(Config{SecretKey: testKey, WebhookSecret: "whsec_separate"})
	body := []byte(successBody)

	if _, err := g.ParseWebhook(SignPayload("whsec_separate", body), body); err != nil {
		t.Errorf("the configured webhook secret should verify: %v", err)
	}
	if _, err := g.ParseWebhook(SignPayload(testKey, body), body); !errors.Is(err, payments.ErrInvalidSignature) {
		t.Error("once a webhook secret is set, the secret key must not also verify")
	}
}
