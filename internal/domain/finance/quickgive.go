package finance

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/platform/fieldcrypt"
	"github.com/hayfordstanley/altar-os/internal/platform/money"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/payments"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
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
	// ErrPaymentKeyMissing means no encryption key is configured, so a stored
	// authorization could only be kept in the clear.
	ErrPaymentKeyMissing = errors.New("finance: saved payments are not configured")
	// ErrPaymentFailed means the provider declined the charge.
	ErrPaymentFailed = errors.New("finance: that payment did not go through")
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

// --- execution --------------------------------------------------------------

// SavePaymentMethod stores an instrument the giver consented to reuse.
//
// Called only after a SUCCESSFUL charge, because that is the only moment a
// provider hands back a reusable authorization and the only moment a person
// can meaningfully agree to it — nobody consents to saving a card that has not
// worked yet.
//
// Upsert on member, so a person has one saved instrument rather than a
// collection of forgotten ones. Giving with a different card replaces it, which
// is what somebody means when they use a different card.
func (s *Service) SavePaymentMethod(ctx context.Context, memberID string, auth *payments.Authorization) (*PaymentMethod, error) {
	if auth == nil || strings.TrimSpace(auth.Code) == "" {
		return nil, ErrNoPaymentMethod
	}
	if !auth.Reusable {
		// The provider itself says this cannot be charged again. Storing it
		// would give the member a one-tap button that fails at the moment they
		// use it, which is worse than not offering one.
		return nil, ErrMethodNotReusable
	}
	if s.crypto == nil {
		// No key configured. Refusing to store beats storing a live payment
		// credential in the clear — the same rule welfare follows.
		return nil, ErrPaymentKeyMissing
	}

	sealed, err := s.crypto.Encrypt(auth.Code)
	if err != nil {
		return nil, fmt.Errorf("finance: seal authorization: %w", err)
	}

	now := s.now()
	if _, err := s.methods.UpsertOne(ctx,
		bson.M{"memberId": mongodb.ID(memberID)},
		bson.M{
			"$set": bson.M{
				"code": sealed, "last4": auth.Last4, "brand": auth.Brand,
				"bank": auth.Bank, "channel": auth.Channel,
				"expiryMonth": auth.ExpiryMonth, "expiryYear": auth.ExpiryYear,
				"consentedAt": now, "updatedAt": now,
			},
			"$setOnInsert": bson.M{"createdAt": now},
		}); err != nil {
		return nil, fmt.Errorf("finance: save payment method: %w", err)
	}
	return s.PaymentMethodFor(ctx, memberID)
}

// PaymentMethodFor returns a member's saved instrument, without its code.
func (s *Service) PaymentMethodFor(ctx context.Context, memberID string) (*PaymentMethod, error) {
	var out PaymentMethod
	err := s.methods.FindOne(ctx, bson.M{"memberId": mongodb.ID(memberID)}, &out)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNoPaymentMethod
	}
	if err != nil {
		return nil, fmt.Errorf("finance: read payment method: %w", err)
	}
	// The caller gets the display fields; the credential stays here.
	out.Code = ""
	return &out, nil
}

// ForgetPaymentMethod removes a saved instrument.
//
// Deleted outright rather than flagged. A revoked payment credential that is
// still in the database is still a payment credential, and "the member asked
// us to forget their card" is not satisfied by a boolean.
func (s *Service) ForgetPaymentMethod(ctx context.Context, memberID string) error {
	if _, err := s.methods.DeleteMany(ctx,
		bson.M{"memberId": mongodb.ID(memberID)}); err != nil {
		return fmt.Errorf("finance: forget payment method: %w", err)
	}
	return nil
}

// Tap performs a one-tap gift.
func (s *Service) Tap(ctx context.Context, req TapRequest) (*Transaction, error) {
	if err := req.Validate(); err != nil {
		return nil, err
	}
	if s.crypto == nil {
		return nil, ErrPaymentKeyMissing
	}

	// The tap id IS the idempotency key. A phone that retried because the
	// screen froze sends the same one, and the unique index refuses the second
	// insert — so the member is charged once whatever the network did.
	key := "tap_" + strings.TrimSpace(req.TapID)
	var existing Transaction
	err := s.coll.FindOne(ctx, bson.M{"idempotencyKey": key}, &existing)
	if err == nil {
		return &existing, nil
	}
	if !errors.Is(err, mongo.ErrNoDocuments) {
		return nil, fmt.Errorf("finance: check tap: %w", err)
	}

	// Debounce: a DIFFERENT tap id for the same member, amount and session
	// inside the window is a double press, not a second decision.
	since := s.now().Add(-TapDebounce)
	recent, err := s.coll.CountDocuments(ctx, bson.M{
		"memberId":   mongodb.ID(req.MemberID),
		"grossMinor": req.AmountMinor,
		"createdAt":  bson.M{"$gt": since},
	})
	if err != nil {
		return nil, fmt.Errorf("finance: debounce: %w", err)
	}
	if recent > 0 {
		return nil, ErrTooSoon
	}

	var stored PaymentMethod
	if err := s.methods.FindOne(ctx,
		bson.M{"memberId": mongodb.ID(req.MemberID)}, &stored); err != nil {
		return nil, ErrNoPaymentMethod
	}
	code, err := s.crypto.Decrypt(stored.Code)
	if err != nil {
		return nil, fmt.Errorf("finance: open authorization: %w", err)
	}

	churchID, err := tenancy.MustChurchID(ctx)
	if err != nil {
		return nil, err
	}
	payout, err := s.dir.PayoutFor(ctx, churchID)
	if err != nil {
		return nil, err
	}
	amount := money.Amount{Minor: req.AmountMinor, Currency: payout.Currency}
	fee := money.Amount{
		Minor:    amount.Minor * payout.CommissionBasisPoints / 10_000,
		Currency: payout.Currency,
	}

	verified, err := s.gateway.ChargeAuthorization(ctx, payments.AuthorizationChargeRequest{
		Reference: key, Code: code, Amount: amount,
		SubaccountCode: payout.SubaccountCode, PlatformFee: fee,
		Email: req.Email,
		Metadata: map[string]string{
			"churchId": payout.SubaccountCode, "sessionId": req.SessionID,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("finance: one-tap charge: %w", err)
	}
	if verified.Status != payments.StatusSuccess {
		return nil, fmt.Errorf("%w: %s", ErrPaymentFailed, verified.FailureReason)
	}

	now := s.now()
	doc := bson.M{
		"memberId": mongodb.ID(req.MemberID), "type": string(TypeOffering),
		"direction": string(DirectionIncome), "channel": verified.Channel,
		"grossMinor": verified.Amount.Minor, "netMinor": verified.Amount.Minor - verified.PlatformFee.Minor,
		"platformFeeMinor": verified.PlatformFee.Minor, "levyMinor": int64(0),
		"currency": verified.Amount.Currency, "status": string(StatusSuccess),
		"idempotencyKey": key, "reference": key, "providerRef": verified.ProviderRef,
		"occurredAt": now, "settledAt": now, "createdAt": now, "updatedAt": now,
	}
	if req.CampaignID != "" {
		doc["campaignId"] = mongodb.ID(req.CampaignID)
	}
	if req.SessionID != "" {
		doc["liveSessionId"] = mongodb.ID(req.SessionID)
	}

	res, err := s.coll.InsertOne(ctx, doc)
	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			// The retry that raced us won. Their row is the gift.
			if e := s.coll.FindOne(ctx, bson.M{"idempotencyKey": key}, &existing); e == nil {
				return &existing, nil
			}
		}
		// Charged but unrecorded. Loud, because the member's money moved and
		// the church's ledger does not know: this is the one failure here that
		// needs a human.
		return nil, fmt.Errorf("finance: TAP CHARGED BUT NOT RECORDED, ref %s: %w", key, err)
	}

	_, _ = s.methods.UpdateOne(ctx, bson.M{"memberId": mongodb.ID(req.MemberID)},
		bson.M{"$set": bson.M{"lastUsedAt": now}})

	var out Transaction
	oid, _ := res.InsertedID.(bson.ObjectID)
	if err := s.coll.FindOne(ctx, bson.M{"_id": oid}, &out); err != nil {
		return nil, fmt.Errorf("finance: read tap: %w", err)
	}
	return &out, nil
}

// WithPaymentCrypto switches on saved payment methods.
//
// A separate setter rather than a NewService argument, so that every existing
// caller keeps compiling with the feature OFF. That is the right default for
// something that stores a credential capable of moving money: it exists only
// where somebody deliberately turned it on and supplied a key.
//
// The key is its OWN secret, not the welfare key and not the JWT secret.
// Losing any one of them must not disclose the others.
func (s *Service) WithPaymentCrypto(c *fieldcrypt.Cipher) *Service {
	s.crypto = c
	return s
}

// EnsurePaymentMethodIndexes creates what one-tap giving needs.
func (s *Service) EnsurePaymentMethodIndexes(ctx context.Context) error {
	return s.methods.EnsureIndexes(ctx, []mongo.IndexModel{{
		// One saved instrument per member. Two would mean a one-tap button
		// whose behaviour depends on which row the query happened to return.
		Keys:    bson.D{{Key: "churchId", Value: 1}, {Key: "memberId", Value: 1}},
		Options: options.Index().SetName("church_member_method").SetUnique(true),
	}})
}
