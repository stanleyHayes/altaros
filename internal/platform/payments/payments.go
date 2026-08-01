// Package payments defines the payment gateway port (WP-13).
//
// ADR-002 is the constraint that shapes this entire interface: ALTAR OS never
// holds church funds. Pooling tithes into an ALTAR OS account and disbursing
// to churches is merchant aggregation under Ghana's Payment Systems and
// Services Act, 2019 (Act 987) — a licensed activity requiring a PSP Medium
// licence, minimum capital, and local equity structure.
//
// So every church is its own merchant (a provider subaccount), money settles
// directly from giver to church, and ALTAR OS takes a commission split. There
// is deliberately no Payout, Balance, Transfer, or Disburse method on this
// interface. Their absence is the compliance boundary, not an omission — any
// feature request implying one triggers a licensing review before a line of
// code (§9, R-2).
package payments

import (
	"context"
	"errors"

	"github.com/hayfordstanley/altar-os/internal/platform/money"
)

var (
	// ErrDuplicateReference means a charge with that reference already exists
	// at the provider. This is a success for idempotency purposes, not a
	// failure: the caller should look up the existing charge.
	ErrDuplicateReference = errors.New("payments: reference already used")
	// ErrNotFound means the provider has no record of the reference.
	ErrNotFound = errors.New("payments: reference not found")
	// ErrInvalidSignature means a webhook did not come from the provider.
	ErrInvalidSignature = errors.New("payments: webhook signature is invalid")
	// ErrProvider wraps an error returned by the provider itself.
	ErrProvider = errors.New("payments: provider rejected the request")
	// ErrUnavailable means the provider could not be reached.
	ErrUnavailable = errors.New("payments: provider unavailable")
	// ErrNotConfigured means the gateway was built without credentials.
	ErrNotConfigured = errors.New("payments: gateway is not configured")
)

// Status is the lifecycle of a charge.
type Status string

const (
	StatusPending  Status = "pending"
	StatusSuccess  Status = "success"
	StatusFailed   Status = "failed"
	StatusReversed Status = "reversed"
)

// SubaccountRequest asks the provider to register a church as a merchant.
type SubaccountRequest struct {
	// ChurchID is ours; it is echoed in metadata so provider records can be
	// traced back without a lookup table.
	ChurchID string
	// BusinessName appears on the giver's statement. It must be the church's
	// name — the giver is paying the church, not ALTAR OS.
	BusinessName string
	// SettlementBank is the provider's bank code. For mobile money settlement
	// this is the MoMo provider code (MTN, Vodafone/Telecel, AirtelTigo).
	SettlementBank string
	// AccountNumber is the church's settlement account or MoMo number.
	AccountNumber string
	// CommissionBasisPoints is what ALTAR OS retains, in basis points.
	// 150 = 1.5%. Basis points rather than a float because 0.015 is not
	// representable in binary floating point, and a commission that rounds
	// differently from the provider reconciles short on every transaction.
	CommissionBasisPoints int64
	PrimaryContactEmail   string
	PrimaryContactPhone   string
}

// Subaccount is a church registered as a merchant with the provider.
type Subaccount struct {
	// Code is the provider's identifier, stored on the church record and sent
	// with every charge.
	Code                  string `json:"code"`
	BusinessName          string `json:"businessName"`
	SettlementBank        string `json:"settlementBank"`
	AccountNumber         string `json:"accountNumber"`
	CommissionBasisPoints int64  `json:"commissionBasisPoints"`
	Active                bool   `json:"active"`
}

// ChargeRequest initialises a payment from a giver to a church.
type ChargeRequest struct {
	// Reference is the idempotency key and must be unique forever. Sending the
	// same reference twice returns ErrDuplicateReference rather than charging
	// twice, which is what makes a retried request safe.
	Reference string
	// Amount is what the giver intends to give. The E-Levy is applied by the
	// mobile money operator on top of this and is quoted separately by
	// money.QuoteELevy before confirmation — it is not added here, because the
	// levy is not the provider's charge to collect.
	Amount money.Amount
	// SubaccountCode routes settlement to the church (ADR-002). A charge
	// without one would settle to ALTAR OS, which is the thing that must never
	// happen; implementations must refuse it.
	SubaccountCode string
	// PlatformFee is what ALTAR OS retains from this transaction. Computed by
	// the caller from Amount so that our ledger and the provider's split agree
	// to the pesewa.
	PlatformFee money.Amount
	// Channel restricts the payment method. Mobile money is the default rail
	// in Ghana, not an option alongside card (§2.3).
	Channel string
	// Email is required by most providers for receipts. A giver without one
	// gets a per-church fallback address rather than blocking the gift.
	Email string
	// CallbackURL is where the giver returns after authorising.
	CallbackURL string
	// Metadata is echoed back on verification and webhooks. Carry churchId and
	// memberId here so a webhook can be attributed without a lookup.
	Metadata map[string]string
}

// Charge is an initialised payment awaiting the giver's authorisation.
type Charge struct {
	Reference string `json:"reference"`
	// AuthorizationURL is where the giver completes the payment.
	AuthorizationURL string `json:"authorizationUrl"`
	// AccessCode drives the in-app SDK rather than a redirect.
	AccessCode string `json:"accessCode"`
	Status     Status `json:"status"`
}

// Verification is the provider's authoritative word on a charge.
//
// This is the only thing that may grant value. A webhook says a payment
// happened; verification confirms how much and to whom. Treating the webhook
// body as authoritative means anyone who can forge one can record a tithe.
type Verification struct {
	Reference string       `json:"reference"`
	Status    Status       `json:"status"`
	Amount    money.Amount `json:"amount"`
	// ProviderFee is what the provider charged. Deducted from the church's net.
	ProviderFee money.Amount `json:"providerFee"`
	// PlatformFee is what ALTAR OS retained via the split.
	PlatformFee money.Amount `json:"platformFee"`
	// SettledTo is the subaccount the money went to. Verified against the
	// church's stored subaccount before value is granted — a charge that
	// settled elsewhere is not that church's income.
	SettledTo string `json:"settledTo"`
	Channel   string `json:"channel"`
	PaidAt    string `json:"paidAt"`
	// ProviderRef is the provider's own transaction id, stored to satisfy the
	// uq_provider_ref unique constraint in §5.2.
	ProviderRef string            `json:"providerRef"`
	Metadata    map[string]string `json:"metadata"`
	// FailureReason is set when Status is failed, for the giver to read.
	FailureReason string `json:"failureReason,omitempty"`
}

// NetToChurch is what the church actually receives: the gift less the
// provider's fee and the platform commission.
func (v *Verification) NetToChurch() (money.Amount, error) {
	afterProvider, err := v.Amount.Sub(v.ProviderFee)
	if err != nil {
		return money.Amount{}, err
	}
	return afterProvider.Sub(v.PlatformFee)
}

// Event is a verified webhook from the provider.
type Event struct {
	// ID deduplicates redelivery. The same event can arrive more than once;
	// consumers must dedupe on this before granting value.
	ID string `json:"id"`
	// Type is the provider's event name, normalised.
	Type string `json:"type"`
	// Reference is the charge this event concerns.
	Reference string `json:"reference"`
	Status    Status `json:"status"`
	// Amount is what the event claims. Never trusted for granting value —
	// re-verify with the provider first.
	Amount money.Amount      `json:"amount"`
	Raw    map[string]any    `json:"-"`
	Meta   map[string]string `json:"meta"`
}

// Event types, normalised across providers.
const (
	EventChargeSuccess = "charge.success"
	EventChargeFailed  = "charge.failed"
	EventRefund        = "refund.processed"
	EventTransferFail  = "transfer.failed"
)

// Gateway is a payment provider.
type Gateway interface {
	// Name identifies the provider on stored transactions.
	Name() string
	// CreateSubaccount registers a church as its own merchant (ADR-002).
	CreateSubaccount(ctx context.Context, req SubaccountRequest) (*Subaccount, error)
	// Initialize starts a charge that settles to the church's subaccount.
	Initialize(ctx context.Context, req ChargeRequest) (*Charge, error)
	// Verify asks the provider what actually happened. The only source of
	// truth for granting value.
	Verify(ctx context.Context, reference string) (*Verification, error)
	// ParseWebhook authenticates and decodes an inbound webhook. It must
	// return ErrInvalidSignature for anything it cannot prove came from the
	// provider, and must never fall back to trusting an unsigned body.
	ParseWebhook(signature string, body []byte) (*Event, error)
}
