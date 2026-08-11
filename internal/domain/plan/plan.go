// Package plan is what a church is paying for, and what that entitles it to.
//
// A tier decides three separate things, and they are listed here rather than
// scattered across the features that consult them:
//
//   - whether the church may stream at all
//   - how many people may watch at once
//   - what percentage ALTAR OS takes of giving
//
// # Why the commission lives here
//
// It already existed as CommissionBasisPoints on each church, set by hand and
// backfilled onto Paystack subaccounts. Making it a property of the TIER means
// the number a church pays is derived from a plan somebody sold them rather
// than typed into a field, and a negotiated rate becomes a deliberate override
// of a known default instead of the only way the value is ever set.
//
// # ADR-009: the two flows do not touch
//
// The commission is taken as the Paystack split on money a member gives to
// their church. The subscription is charged separately, by us, to the church.
// A church in arrears loses FEATURES — streaming, viewer capacity — and never
// loses giving. That money was never ours to withhold, and a congregation
// should not be punished for its church's unpaid invoice.
package plan

import (
	"errors"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// Collection holds each church's subscription.
const Collection = "church_plans"

var (
	// ErrTierUnknown means an unrecognised tier name.
	ErrTierUnknown = errors.New("plan: that tier is not recognised")
	// ErrNotEntitled means the church's tier does not include this.
	ErrNotEntitled = errors.New("plan: your plan does not include this")
	// ErrAtCapacity means the viewer limit for the tier is reached.
	ErrAtCapacity = errors.New("plan: this service is full")
)

// Tier is a named plan.
type Tier string

const (
	// TierFree is what a church gets before it pays anything.
	//
	// Deliberately usable rather than crippled: the product only works if a
	// congregation is actually on it, and a church that cannot run its
	// giving without paying will not start. It carries the HIGHEST commission
	// — the free tier is funded by the transaction split, which is the honest
	// trade and the one to state plainly in the pricing page.
	TierFree Tier = "free"
	// TierStarter is a single congregation that has begun paying.
	TierStarter Tier = "starter"
	// TierGrowth is a church running midweek services and events online.
	TierGrowth Tier = "growth"
	// TierMinistry is a multi-branch network.
	TierMinistry Tier = "ministry"
)

// Entitlement is what one tier includes.
type Entitlement struct {
	Tier Tier   `bson:"tier" json:"tier"`
	Name string `bson:"name" json:"name"`

	// Streaming is whether the church may go live at all.
	Streaming bool `bson:"streaming" json:"streaming"`
	// MaxConcurrentViewers caps a single live session.
	//
	// Zero means no streaming rather than unlimited. The zero value of an int
	// is the safe answer here: a tier added later without setting this cannot
	// accidentally grant unlimited capacity, which is the expensive direction
	// to be wrong in when every viewer costs bandwidth.
	MaxConcurrentViewers int `bson:"maxConcurrentViewers" json:"maxConcurrentViewers"`

	// CommissionBasisPoints is our cut of giving. 150 = 1.5%.
	CommissionBasisPoints int64 `bson:"commissionBasisPoints" json:"commissionBasisPoints"`

	// MonthlyMinor is the subscription price in minor units, in Currency.
	MonthlyMinor int64  `bson:"monthlyMinor" json:"monthlyMinor"`
	Currency     string `bson:"currency"     json:"currency"`
}

// Catalogue is every tier ALTAR OS sells.
//
// Prices are GHS and deliberately not a translation of US church-software
// pricing: these are Ghanaian church budgets, and a tier priced against a US
// megachurch is a tier nobody here buys. The commission FALLS as the
// subscription rises, which is the whole shape of the offer — a church that
// pays more keeps more of what its members give.
var Catalogue = []Entitlement{
	{
		Tier: TierFree, Name: "Free",
		Streaming: false, MaxConcurrentViewers: 0,
		CommissionBasisPoints: 250, // 2.5%
		MonthlyMinor:          0, Currency: "GHS",
	},
	{
		Tier: TierStarter, Name: "Starter",
		Streaming: true, MaxConcurrentViewers: 100,
		CommissionBasisPoints: 200,                    // 2.0%
		MonthlyMinor:          20000, Currency: "GHS", // GHS 200
	},
	{
		Tier: TierGrowth, Name: "Growth",
		Streaming: true, MaxConcurrentViewers: 500,
		CommissionBasisPoints: 150,                    // 1.5%
		MonthlyMinor:          50000, Currency: "GHS", // GHS 500
	},
	{
		Tier: TierMinistry, Name: "Ministry",
		Streaming: true, MaxConcurrentViewers: 2000,
		CommissionBasisPoints: 100,                     // 1.0%
		MonthlyMinor:          150000, Currency: "GHS", // GHS 1,500
	},
}

// EntitlementFor returns what a tier includes.
//
// An unrecognised tier resolves to FREE rather than erroring. A church whose
// plan record says something this build has never heard of — a tier renamed,
// a record half-written — keeps a working product on the most conservative
// terms, instead of having its giving fail because of a string.
func EntitlementFor(t Tier) Entitlement {
	for _, e := range Catalogue {
		if e.Tier == t {
			return e
		}
	}
	return Catalogue[0]
}

// Status is where a church's subscription stands.
type Status string

const (
	StatusActive Status = "active"
	// StatusPastDue is unpaid but still inside the grace period.
	StatusPastDue Status = "past_due"
	// StatusSuspended is past the grace period: tier features stop.
	StatusSuspended Status = "suspended"
	StatusCancelled Status = "cancelled"
)

// GracePeriod is how long a failed payment keeps its features.
//
// A church treasurer is a volunteer, and a card expiring the week of a
// conference should not take the livestream down mid-service. Fourteen days is
// long enough to reach a human and short enough that it is not a free tier by
// another name.
const GracePeriod = 14 * 24 * time.Hour

// Subscription is one church's plan.
type Subscription struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`

	Tier   Tier   `bson:"tier"   json:"tier"`
	Status Status `bson:"status" json:"status"`

	// CommissionOverrideBasisPoints is a negotiated rate.
	//
	// Nil means "use the tier's". A pointer rather than a zero-check because
	// 0 is a legitimate negotiated rate — a partner church we take nothing
	// from — and a plain int64 could not tell that apart from "unset".
	CommissionOverrideBasisPoints *int64 `bson:"commissionOverrideBasisPoints,omitempty" json:"commissionOverrideBasisPoints,omitempty"`

	CurrentPeriodEnd time.Time  `bson:"currentPeriodEnd,omitempty" json:"currentPeriodEnd,omitempty"`
	PastDueSince     *time.Time `bson:"pastDueSince,omitempty"     json:"pastDueSince,omitempty"`

	CreatedAt time.Time `bson:"createdAt" json:"createdAt"`
	UpdatedAt time.Time `bson:"updatedAt" json:"updatedAt"`
}

// Effective is what this church may actually do right now.
//
// Suspension withdraws FEATURES and leaves the commission alone. Raising the
// commission on a church that has not paid would take the shortfall out of its
// members' giving, which is ADR-009's forbidden netting wearing a different
// hat.
func (s *Subscription) Effective() Entitlement {
	if s == nil {
		return Catalogue[0]
	}
	e := EntitlementFor(s.Tier)

	if s.Status == StatusSuspended || s.Status == StatusCancelled {
		e.Streaming = false
		e.MaxConcurrentViewers = 0
	}
	if s.CommissionOverrideBasisPoints != nil {
		e.CommissionBasisPoints = *s.CommissionOverrideBasisPoints
	}
	return e
}

// GraceExpired reports whether a past-due subscription has run out of grace.
func (s *Subscription) GraceExpired(now time.Time) bool {
	return s != nil && s.Status == StatusPastDue && s.PastDueSince != nil &&
		now.After(s.PastDueSince.Add(GracePeriod))
}
