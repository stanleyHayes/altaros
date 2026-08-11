package finance

import (
	"encoding/json"
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/fieldcrypt"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/payments"
)

// The danger in one-tap giving is not a stranger charging somebody — the
// authorization is merchant-scoped and useless elsewhere. It is a person
// giving ten times what they meant to, during a service, and finding out
// afterwards. These pin the protections that exist for that.

func validTap() TapRequest {
	return TapRequest{
		MemberID: "6a6f3460a6b0e0738ca16496", AmountMinor: 2_000,
		Currency: "GHS", TapID: "tap-abc123",
	}
}

func TestATapMustCarryItsOwnIdempotencyKey(t *testing.T) {
	req := validTap()
	req.TapID = ""
	if err := req.Validate(); err != ErrTapIDRequired {
		t.Fatalf("a tap with no key was accepted (%v) — a retry on a bad "+
			"connection would become a second gift", err)
	}
}

// The amounts are buttons, not a keypad. Most mis-taps are a wrong DIGIT, and
// a free-text field is what makes a wrong digit possible.
func TestOnlyOfferedAmountsCanBeTapped(t *testing.T) {
	for _, ok := range PresetAmountsMinor {
		req := validTap()
		req.AmountMinor = ok
		if err := req.Validate(); err != nil {
			t.Errorf("preset %d was refused: %v", ok, err)
		}
	}
	// The classic fat-finger: an extra zero on a real preset.
	for _, bad := range []int64{200_000, 1, 999, 1_500, 100_000} {
		req := validTap()
		req.AmountMinor = bad
		if err := req.Validate(); err == nil {
			t.Errorf("%d was accepted as a tap, but it is not a button — so "+
				"none of the one-tap protections were applied to it", bad)
		}
	}
}

// The ceiling is where a mistake stops being recoverable pocket money.
func TestNothingAboveTheCeilingIsOneTap(t *testing.T) {
	for _, a := range PresetAmountsMinor {
		if a > TapLimitMinor {
			t.Errorf("preset %d is above the tap ceiling %d, so a button "+
				"exists that bypasses the confirmation it was meant to force",
				a, TapLimitMinor)
		}
	}
	req := validTap()
	req.AmountMinor = TapLimitMinor + 1_000
	if err := req.Validate(); err != ErrAboveTapLimit {
		t.Errorf("an amount over the ceiling returned %v", err)
	}
}

func TestATapNeedsAMemberBecauseItChargesTheirInstrument(t *testing.T) {
	req := validTap()
	req.MemberID = ""
	if err := req.Validate(); err != ErrTapMemberRequired {
		t.Fatalf("an unattributed tap was accepted (%v); one-tap charges a "+
			"specific person's saved method, so there is no anonymous version", err)
	}
	req = validTap()
	req.AmountMinor = 0
	if err := req.Validate(); err == nil {
		t.Error("a zero-amount tap was accepted")
	}
}

// The stored credential must never reach a client. The json tag is the only
// thing standing between an authorization code and a debug response.
func TestTheStoredAuthorizationIsNeverSerialised(t *testing.T) {
	m := &PaymentMethod{Code: "AUTH_supersecret", Last4: "4321", Brand: "visa"}
	blob := mustJSON(t, m)
	if contains(blob, "AUTH_supersecret") {
		t.Fatal("the authorization code is serialised into JSON — it can move " +
			"money, and this is the one field that must never leave the server")
	}
	// The parts a person needs to recognise their own card must survive.
	for _, want := range []string{"4321", "visa"} {
		if !contains(blob, want) {
			t.Errorf("%q was stripped; the member cannot tell which card this is", want)
		}
	}
}

// A label a person recognises, without ever holding a full number.
func TestTheLabelIdentifiesTheInstrumentWithoutTheNumber(t *testing.T) {
	for _, c := range []struct {
		m    PaymentMethod
		want string
	}{
		{PaymentMethod{Bank: "MTN MoMo", Last4: "7788"}, "MTN MoMo ••••7788"},
		{PaymentMethod{Brand: "visa", Last4: "4321"}, "visa ••••4321"},
		{PaymentMethod{Last4: "0001"}, "••••0001"},
		{PaymentMethod{Channel: "mobile_money"}, "mobile_money"},
	} {
		if got := c.m.Label(); got != c.want {
			t.Errorf("label = %q, want %q", got, c.want)
		}
	}
	var none *PaymentMethod
	if none.Label() != "" {
		t.Error("a nil method produced a label")
	}
}

// The debounce has to absorb a fumble without refusing a deliberate second
// gift during an appeal.
func TestTheDebounceIsShortEnoughToAllowGivingTwice(t *testing.T) {
	if TapDebounce <= 0 {
		t.Fatal("no debounce, so a double tap is two gifts")
	}
	if TapDebounce > 30_000_000_000 { // 30s
		t.Errorf("the debounce is %s — somebody deliberately giving twice "+
			"during an appeal would be told no", TapDebounce)
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

func contains(haystack, needle string) bool { return strings.Contains(haystack, needle) }

// --- execution -------------------------------------------------------------

func tapHarness(t *testing.T) *harness {
	t.Helper()
	h := newHarness(t)
	cipher, err := fieldcrypt.New("test-payment-key-not-the-welfare-one")
	if err != nil {
		t.Fatalf("cipher: %v", err)
	}
	h.svc.WithPaymentCrypto(cipher)
	if err := h.svc.EnsurePaymentMethodIndexes(h.ctx); err != nil {
		t.Fatalf("EnsurePaymentMethodIndexes: %v", err)
	}
	return h
}

func saveMethod(t *testing.T, h *harness, memberID string) {
	t.Helper()
	if _, err := h.svc.SavePaymentMethod(h.ctx, memberID, &payments.Authorization{
		Code: "AUTH_test_code", Last4: "4321", Brand: "visa", Reusable: true,
	}); err != nil {
		t.Fatalf("SavePaymentMethod: %v", err)
	}
}

// The phone froze and the member pressed again. Same tap, one gift.
func TestARetriedTapChargesOnce(t *testing.T) {
	h := tapHarness(t)
	member := "6a6f3460a6b0e0738ca16496"
	saveMethod(t, h, member)

	req := TapRequest{
		MemberID: member, AmountMinor: 2_000, Currency: "GHS",
		TapID: "tap-frozen-screen", Email: "ama@example.com",
	}
	first, err := h.svc.Tap(h.ctx, req)
	if err != nil {
		t.Fatalf("first tap: %v", err)
	}
	for i := 0; i < 4; i++ {
		again, err := h.svc.Tap(h.ctx, req)
		if err != nil {
			t.Fatalf("retry %d: %v", i, err)
		}
		if again.ID != first.ID {
			t.Fatalf("retry %d created a second gift (%s vs %s) — the member "+
				"has been charged twice for one tap", i, again.ID.Hex(), first.ID.Hex())
		}
	}

	n, err := h.svc.coll.CountDocuments(h.ctx, bson.M{"memberId": mongodb.ID(member)})
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1 {
		t.Fatalf("%d transactions recorded for one tap", n)
	}
}

// A different tap id for the same amount, seconds apart, is a double press.
func TestADoublePressIsRefused(t *testing.T) {
	h := tapHarness(t)
	member := "6a6f3460a6b0e0738ca16497"
	saveMethod(t, h, member)

	base := TapRequest{
		MemberID: member, AmountMinor: 5_000, Currency: "GHS",
		Email: "kwame@example.com",
	}
	first := base
	first.TapID = "tap-one"
	if _, err := h.svc.Tap(h.ctx, first); err != nil {
		t.Fatalf("first tap: %v", err)
	}

	second := base
	second.TapID = "tap-two" // genuinely a different tap, moments later
	if _, err := h.svc.Tap(h.ctx, second); err != ErrTooSoon {
		t.Fatalf("a second identical gift seconds later returned %v, want "+
			"ErrTooSoon — that is the fumbled press this guard exists for", err)
	}
}

// The charge must still carry the church's subaccount and our fee. A stored
// authorization changes who confirms, never where the money lands (ADR-002).
func TestAOneTapGiftStillSettlesToTheChurch(t *testing.T) {
	h := tapHarness(t)
	member := "6a6f3460a6b0e0738ca16498"
	saveMethod(t, h, member)

	if _, err := h.svc.Tap(h.ctx, TapRequest{
		MemberID: member, AmountMinor: 10_000, Currency: "GHS",
		TapID: "tap-settle", Email: "ada@example.com",
	}); err != nil {
		t.Fatalf("Tap: %v", err)
	}

	h.gw.mu.Lock()
	defer h.gw.mu.Unlock()
	if len(h.gw.authCharges) != 1 {
		t.Fatalf("%d authorization charges", len(h.gw.authCharges))
	}
	got := h.gw.authCharges[0]
	if got.SubaccountCode != testSubaccount {
		t.Errorf("settled to %q, not the church's subaccount", got.SubaccountCode)
	}
	if got.PlatformFee.Minor != 10_000*150/10_000 {
		t.Errorf("platform fee = %d", got.PlatformFee.Minor)
	}
	if got.Code == "" {
		t.Error("no authorization code was sent")
	}
}

// The credential is sealed at rest. A database dump must not yield something
// that can move money.
func TestTheStoredAuthorizationIsEncryptedAtRest(t *testing.T) {
	h := tapHarness(t)
	member := "6a6f3460a6b0e0738ca16499"
	saveMethod(t, h, member)

	var raw bson.M
	if err := h.svc.methods.FindOne(h.ctx,
		bson.M{"memberId": mongodb.ID(member)}, &raw); err != nil {
		t.Fatalf("read raw: %v", err)
	}
	stored, _ := raw["code"].(string)
	if stored == "AUTH_test_code" {
		t.Fatal("the authorization is stored in the clear — a database dump " +
			"would hand somebody a live payment credential")
	}
	if !fieldcrypt.IsEncrypted(stored) {
		t.Errorf("the stored code carries no encryption marker: %q", stored)
	}

	// And the read path never hands it back.
	shown, err := h.svc.PaymentMethodFor(h.ctx, member)
	if err != nil {
		t.Fatalf("PaymentMethodFor: %v", err)
	}
	if shown.Code != "" {
		t.Error("the credential was returned to the caller")
	}
	if shown.Last4 != "4321" {
		t.Errorf("last4 = %q; the member cannot tell which card this is", shown.Last4)
	}
}

// Without a key, refuse to store rather than keep a live credential in clear.
func TestWithoutAKeySavedPaymentsAreRefusedNotDowngraded(t *testing.T) {
	h := newHarness(t) // no WithPaymentCrypto
	if _, err := h.svc.SavePaymentMethod(h.ctx, "6a6f3460a6b0e0738ca1649a",
		&payments.Authorization{Code: "AUTH_x", Reusable: true}); err != ErrPaymentKeyMissing {
		t.Fatalf("SavePaymentMethod returned %v, want ErrPaymentKeyMissing", err)
	}
}

// A provider that says an instrument is not reusable must be believed.
func TestANonReusableAuthorizationIsNotSaved(t *testing.T) {
	h := tapHarness(t)
	if _, err := h.svc.SavePaymentMethod(h.ctx, "6a6f3460a6b0e0738ca1649b",
		&payments.Authorization{Code: "AUTH_once", Reusable: false}); err != ErrMethodNotReusable {
		t.Fatalf("a one-time authorization was saved (%v) — the member would "+
			"get a one-tap button that fails when they use it", err)
	}
}

// Forgetting removes the row, not a flag.
func TestForgettingDestroysTheCredential(t *testing.T) {
	h := tapHarness(t)
	member := "6a6f3460a6b0e0738ca1649c"
	saveMethod(t, h, member)

	if err := h.svc.ForgetPaymentMethod(h.ctx, member); err != nil {
		t.Fatalf("ForgetPaymentMethod: %v", err)
	}
	n, err := h.svc.methods.CountDocuments(h.ctx, bson.M{"memberId": mongodb.ID(member)})
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Fatal("the payment method row survived being forgotten — a revoked " +
			"credential still in the database is still a credential")
	}
	if _, err := h.svc.Tap(h.ctx, TapRequest{
		MemberID: member, AmountMinor: 2_000, Currency: "GHS", TapID: "tap-after-forget",
	}); err != ErrNoPaymentMethod {
		t.Errorf("a tap after forgetting returned %v", err)
	}
}
