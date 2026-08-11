package finance

import (
	"errors"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// One-tap giving.
//
// A member who has given once and chose to save the instrument can give again
// with a single tap — no mobile-money menu, no PIN, no leaving the live
// service. That is the whole point: the moment somebody decides to give during
// a service is short, and a two-minute USSD detour is where the decision dies.
//
// # The failure mode this is designed around is not fraud
//
// It is a mis-tap. A person watching a service on a phone, moved by what is
// being said, with a saved card and a button on the screen. The dangerous
// outcome is not a stranger charging them — the authorization is merchant-
// scoped and useless elsewhere — it is THEM giving ten times what they meant
// to, and discovering it afterwards. A church that has to refund a member who
// fat-fingered GHS 2,000 during worship has done that member harm, and the
// software handed them the means.
//
// So the protections are shaped for accidents rather than attackers:
//
//   - preset amounts, not a free-text field
//   - a per-charge ceiling above which one tap is not enough
//   - a debounce window, because a double tap is a slow tap
//   - an idempotency key derived from the tap, so a retried request on a bad
//     connection cannot become a second gift
//
// # The stored code is a credential
//
// It can move money. It is encrypted at rest under its own key, never
// returned to a client, never logged, and removed when the account is deleted.

// PaymentMethodCollection holds saved authorizations.
const PaymentMethodCollection = "payment_methods"

var (
	// ErrNoPaymentMethod means the member has not saved one.
	ErrNoPaymentMethod = errors.New("finance: no saved payment method")
	// ErrAboveTapLimit means the amount needs full confirmation.
	ErrAboveTapLimit = errors.New("finance: that amount needs confirming")
	// ErrTooSoon means an identical gift arrived inside the debounce window.
	ErrTooSoon = errors.New("finance: that looks like a double tap")
	// ErrMethodNotReusable means the provider will not charge it again.
	ErrMethodNotReusable = errors.New("finance: that payment method cannot be reused")
)

// TapLimitMinor is the most that may be given with a single tap.
//
// GHS 500. Above it the giver goes through the full flow with their PIN, which
// is not a security boundary — the authorization would work — but a moment of
// friction placed exactly where a mistake stops being recoverable pocket money
// and starts being somebody's rent.
const TapLimitMinor int64 = 50_000

// TapDebounce is how long an identical repeat is treated as a double tap.
//
// Five seconds. Long enough to absorb a fumbled press or a laggy screen
// repaint, short enough that somebody deliberately giving twice — which
// happens, during an appeal — is not told no.
const TapDebounce = 5 * time.Second

// PresetAmountsMinor are the amounts a tap may give.
//
// A fixed set rather than a free-text box. Most mis-taps are a wrong DIGIT,
// and a keypad is what makes a wrong digit possible; buttons cannot produce
// GHS 2,000 when the person meant GHS 20.
var PresetAmountsMinor = []int64{1_000, 2_000, 5_000, 10_000, 20_000, 50_000}

// IsPreset reports whether an amount is one of the offered buttons.
func IsPreset(minor int64) bool {
	for _, a := range PresetAmountsMinor {
		if a == minor {
			return true
		}
	}
	return false
}

// PaymentMethod is an instrument a member consented to reuse.
type PaymentMethod struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`
	MemberID mongodb.ID    `bson:"memberId"      json:"memberId"`

	// Code is the provider's authorization, ENCRYPTED. The json tag is "-"
	// so no handler can return it by accident.
	Code string `bson:"code" json:"-"`

	// What a person recognises their own instrument by. No full number: we
	// never receive one, and storing what we cannot see is a risk not worth
	// inventing.
	Last4       string `bson:"last4,omitempty"       json:"last4,omitempty"`
	Brand       string `bson:"brand,omitempty"       json:"brand,omitempty"`
	Bank        string `bson:"bank,omitempty"        json:"bank,omitempty"`
	Channel     string `bson:"channel,omitempty"     json:"channel,omitempty"`
	ExpiryMonth string `bson:"expiryMonth,omitempty" json:"expiryMonth,omitempty"`
	ExpiryYear  string `bson:"expiryYear,omitempty"  json:"expiryYear,omitempty"`

	// ConsentedAt is when the member agreed to this being kept. Recorded
	// because "did they agree" is a question that gets asked later, and
	// "the code exists so they must have" is not an answer.
	ConsentedAt time.Time  `bson:"consentedAt" json:"consentedAt"`
	LastUsedAt  *time.Time `bson:"lastUsedAt,omitempty" json:"lastUsedAt,omitempty"`

	CreatedAt time.Time `bson:"createdAt" json:"createdAt"`
	UpdatedAt time.Time `bson:"updatedAt" json:"updatedAt"`
}

// Label describes the instrument in the words a person would use.
func (p *PaymentMethod) Label() string {
	if p == nil {
		return ""
	}
	switch {
	case p.Bank != "" && p.Last4 != "":
		return p.Bank + " ••••" + p.Last4
	case p.Brand != "" && p.Last4 != "":
		return p.Brand + " ••••" + p.Last4
	case p.Last4 != "":
		return "••••" + p.Last4
	}
	return p.Channel
}

// TapRequest is one press of a give button.
type TapRequest struct {
	MemberID string
	// AmountMinor must be one of PresetAmountsMinor.
	AmountMinor int64
	Currency    string
	// SessionID ties the gift to the live service it happened in, so a church
	// can see what a service raised.
	SessionID string
	// CampaignID is usually taken from the session rather than chosen — during
	// a service nobody wants a dropdown.
	CampaignID string
	// TapID is generated by the client PER TAP and repeated on retry.
	//
	// This is what makes a flaky connection safe: the phone retries the same
	// tap, the server recognises it, and the member is charged once. Without
	// it, "it did not seem to work so I pressed again" becomes two gifts.
	TapID string
	Email string
}

// Validate checks a tap before any money moves.
func (t TapRequest) Validate() error {
	if t.MemberID == "" {
		// One-tap is inherently attributed: it charges a specific person's
		// saved instrument, so there is no anonymous version of it.
		return ErrTapMemberRequired
	}
	if t.AmountMinor <= 0 {
		return ErrAmountRequired
	}
	if !IsPreset(t.AmountMinor) {
		// Not merely "too big": an amount that is not on a button did not come
		// from a tap, so the one-tap protections were never applied to it.
		return ErrAboveTapLimit
	}
	if t.AmountMinor > TapLimitMinor {
		return ErrAboveTapLimit
	}
	if t.TapID == "" {
		// Refusing rather than generating one here is deliberate: a server-side
		// key would be unique per REQUEST, which is exactly the retry it is
		// supposed to collapse.
		return ErrTapIDRequired
	}
	return nil
}

var (
	// ErrTapIDRequired means the client sent no per-tap idempotency key.
	ErrTapIDRequired = errors.New("finance: a tap needs an idempotency key")
	// ErrTapMemberRequired means the tap named nobody.
	ErrTapMemberRequired = errors.New("finance: one-tap giving needs a member")
)
