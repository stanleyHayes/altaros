package finance

import (
	"encoding/json"
	"strings"
	"testing"
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
