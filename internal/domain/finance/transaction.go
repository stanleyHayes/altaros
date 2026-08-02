// Package finance is the giving and ledger domain (WP-14).
//
// The money model here is the field-level contract from §5.2, implemented on
// MongoDB per ADR-005. Two things carry over from the SQL definition without
// negotiation:
//
//   - Amounts are integer minor units. BSON double is IEEE-754 and would lose
//     cents; see internal/platform/money.
//   - The uq_idempotency and uq_provider_ref unique indexes are mandatory.
//     They are what stops a retried payment webhook from recording a tithe
//     twice, and they are enforced by the database rather than by a check the
//     application might race with itself on.
package finance

import (
	"errors"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/money"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// Collection holding transactions.
const Collection = "transactions"

// Type is what a transaction is for.
type Type string

const (
	TypeTithe         Type = "tithe"
	TypeOffering      Type = "offering"
	TypeDonation      Type = "donation"
	TypeCampaign      Type = "campaign"
	TypePledgePayment Type = "pledge_payment"
	// TypeExpense is the outgoing side of the ledger (§6.4).
	TypeExpense Type = "expense"
)

// Valid reports whether a type is recognised.
func (t Type) Valid() bool {
	switch t {
	case TypeTithe, TypeOffering, TypeDonation, TypeCampaign, TypePledgePayment, TypeExpense:
		return true
	}
	return false
}

// Direction separates income from expenditure.
type Direction string

const (
	DirectionIncome  Direction = "income"
	DirectionExpense Direction = "expense"
)

// Status is the lifecycle of a transaction.
type Status string

const (
	StatusPending  Status = "pending"
	StatusSuccess  Status = "success"
	StatusFailed   Status = "failed"
	StatusReversed Status = "reversed"
)

// Terminal reports whether a status can still change. A settled transaction
// must not be re-settled by a late webhook.
func (s Status) Terminal() bool {
	return s == StatusSuccess || s == StatusFailed || s == StatusReversed
}

var (
	// ErrNotFound means no transaction matched.
	ErrNotFound = errors.New("finance: transaction not found")
	// ErrInvalidType means an unrecognised transaction type.
	ErrInvalidType = errors.New("finance: unrecognised transaction type")
	// ErrInvalidChannel means an unrecognised payment channel.
	ErrInvalidChannel = errors.New("finance: unrecognised payment channel")
	// ErrAmountRequired means a non-positive amount was supplied.
	ErrAmountRequired = errors.New("finance: amount must be positive")
	// ErrDuplicate means the idempotency key or provider reference was already
	// recorded. The caller should read the existing transaction rather than
	// retry.
	ErrDuplicate = errors.New("finance: transaction already recorded")
	// ErrNoSubaccount means the church has no payout destination configured,
	// so a charge would have nowhere to settle but ALTAR OS (ADR-002).
	ErrNoSubaccount = errors.New("finance: church has no payout subaccount configured")
	// ErrAlreadySettled means a terminal transaction was asked to change.
	ErrAlreadySettled = errors.New("finance: transaction is already settled")
	// ErrAmountMismatch means the provider reported a different amount from
	// the one recorded. Never reconcile silently — this is either a bug or an
	// attack, and both need a human.
	ErrAmountMismatch = errors.New("finance: provider amount does not match the recorded transaction")
	// ErrWrongSettlement means the payment settled somewhere other than the
	// church's own subaccount, so it is not that church's income.
	ErrWrongSettlement = errors.New("finance: payment settled to a different subaccount")
)

// Transaction is one movement of money, income or expense.
//
// Amounts are stored as separate minor-unit fields with a single currency
// rather than as embedded money.Amount documents: it keeps the stored shape
// equal to the §5.2 contract and makes aggregation pipelines able to sum a
// field directly.
type Transaction struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`
	// MemberID is empty for anonymous giving, which must stay possible — a
	// visitor who gives should not be forced to identify themselves.
	MemberID mongodb.ID `bson:"memberId,omitempty" json:"memberId,omitempty"`
	// InitiatedBy privately associates a digital checkout with the signed-in
	// account that started it. It is never serialized: anonymous means church
	// reports do not identify the giver, not that the giver loses callback
	// verification, their own history, or a receipt.
	InitiatedBy mongodb.ID `bson:"initiatedBy,omitempty" json:"-"`
	Type        Type       `bson:"type"      json:"type"`
	Direction   Direction  `bson:"direction" json:"direction"`
	Channel     string     `bson:"channel"   json:"channel"`

	// GrossMinor is what the giver was debited, excluding the levy their
	// operator adds on top.
	GrossMinor int64 `bson:"grossMinor" json:"grossMinor"`
	// LevyMinor is the E-Levy quoted to the giver before confirmation. It is
	// recorded so the church can explain the difference between what a member
	// says they gave and what arrived, and it is excluded from recognised
	// income (§2.3).
	LevyMinor int64 `bson:"levyMinor" json:"levyMinor"`
	// ProviderFeeMinor is what the payment provider charged.
	ProviderFeeMinor int64 `bson:"providerFeeMinor" json:"providerFeeMinor"`
	// PlatformFeeMinor is the ALTAR OS commission (ADR-002).
	PlatformFeeMinor int64 `bson:"platformFeeMinor" json:"platformFeeMinor"`
	// NetMinor is what the church actually receives, and the only figure that
	// may be presented as the church's income.
	NetMinor int64  `bson:"netMinor" json:"netMinor"`
	Currency string `bson:"currency" json:"currency"`

	Status Status `bson:"status" json:"status"`
	// Provider and ProviderRef are empty for cash.
	Provider    string `bson:"provider,omitempty"    json:"provider,omitempty"`
	ProviderRef string `bson:"providerRef,omitempty" json:"providerRef,omitempty"`
	// IdempotencyKey is unique across the whole collection and doubles as the
	// provider reference for the charge.
	IdempotencyKey string `bson:"idempotencyKey" json:"idempotencyKey"`
	// SettledTo is the subaccount the money reached, checked against the
	// church's own before the transaction is recognised.
	SettledTo string `bson:"settledTo,omitempty" json:"settledTo,omitempty"`

	CampaignID mongodb.ID `bson:"campaignId,omitempty" json:"campaignId,omitempty"`
	// RecordedBy is who entered a cash transaction — the dual-control record
	// for money counted at a service (§8.2).
	RecordedBy mongodb.ID `bson:"recordedBy,omitempty" json:"recordedBy,omitempty"`
	// Note is free text: the expense description, or what an offering was for.
	Note string `bson:"note,omitempty" json:"note,omitempty"`
	// FailureReason is what to show the giver when a payment fails.
	FailureReason string `bson:"failureReason,omitempty" json:"failureReason,omitempty"`

	OccurredAt time.Time  `bson:"occurredAt" json:"occurredAt"`
	SettledAt  *time.Time `bson:"settledAt,omitempty" json:"settledAt,omitempty"`
	CreatedAt  time.Time  `bson:"createdAt"  json:"createdAt"`
	UpdatedAt  time.Time  `bson:"updatedAt"  json:"updatedAt"`
}

// Gross is what the giver was debited, excluding levy.
func (t *Transaction) Gross() money.Amount {
	return money.Amount{Minor: t.GrossMinor, Currency: t.Currency}
}

// Net is what the church receives.
func (t *Transaction) Net() money.Amount {
	return money.Amount{Minor: t.NetMinor, Currency: t.Currency}
}

// Levy is the E-Levy recorded against this gift.
func (t *Transaction) Levy() money.Amount {
	return money.Amount{Minor: t.LevyMinor, Currency: t.Currency}
}

// TotalDebited is what actually left the giver's wallet: the gift plus the
// levy their operator applied. This is the number to show on a receipt,
// because it is the number the giver will see on their own statement.
func (t *Transaction) TotalDebited() money.Amount {
	return money.Amount{Minor: t.GrossMinor + t.LevyMinor, Currency: t.Currency}
}
