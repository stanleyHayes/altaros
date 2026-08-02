// Package platformsetting holds the commercial terms a platform operator sets
// from the dashboard, rather than a developer sets in a Go file.
//
// It exists because of Q-7 (answered 2 Aug 2026): the commission rate "will be
// a value that will be entered on the platform dashboard". Two things follow
// from that which are easy to get wrong, and both are handled here rather than
// left to the caller:
//
//   - **A rate change DOES take effect immediately, on every church.** This was
//     documented here as the opposite for a day, and the mistake is worth
//     recording because it is the intuitive reading and it is wrong. Paystack
//     does store a split on each subaccount, so it looks as though changing the
//     platform default could only affect new churches. But every charge ALTAR
//     OS initialises sends an explicit per-transaction `transaction_charge`
//     computed from the LIVE rate, and that OVERRIDES the stored split.
//
//     Measured against Paystack's test API on 2 Aug 2026 rather than reasoned
//     about: two identical GHS 100 charges against one subaccount stored at
//     2.5%%, one sending transaction_charge=150 and one not. They split
//     150/9655 and 250/9555. The explicit charge won.
//
//     What the stored split still governs is every charge ALTAR OS did not
//     originate — a payment link or recurring plan created in Paystack's own
//     dashboard — and the figure a church sees when it logs in there. That is
//     what BackfillCommission is for, and it is a consistency operation rather
//     than the thing that makes a rate live.
//
//   - **The provider's own fee schedule is not a constant either.** Q-4 makes
//     the giver bear it by default, which means the fee is added to what the
//     giver is charged — so an out-of-date rate card is not an accounting
//     detail, it is a number shown to a member before they confirm a payment.
//
// The collection is GLOBAL, not tenant-scoped. That is the exception this
// package deliberately makes visible: there is exactly one platform, and its
// terms are not a church's data.
package platformsetting

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/platform/money"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// Collection holds the single settings document.
const Collection = "platform_settings"

// singletonID is the fixed _id of the one settings document.
//
// A fixed id rather than "the first document found": two concurrent writes to
// a findOne-then-insert would produce two settings documents, and which one
// the platform then runs on would depend on collection order.
const singletonID = "platform"

var (
	// ErrInvalidRate means a commission rate is outside the allowed range.
	ErrInvalidRate = errors.New("platformsetting: commission rate is out of range")
	// ErrChurchNotFound means no church matched.
	ErrChurchNotFound = errors.New("platformsetting: church not found")
	// ErrInvalidFee means a provider fee schedule is not usable.
	ErrInvalidFee = errors.New("platformsetting: provider fee schedule is not valid")
)

// MaxCommissionBasisPoints caps what may be entered.
//
// 10% of every gift. Not a legal limit — a sanity one. The field is entered by
// hand on a dashboard, and the difference between 150 and 15000 is one
// keystroke against a number nobody can eyeball as a percentage. The failure it
// prevents is a church's entire Sunday offering being split to the platform
// before anybody notices.
const MaxCommissionBasisPoints int64 = 1000

// DefaultCommissionBasisPoints is what applies before an operator sets
// anything. 150 = 1.5%.
const DefaultCommissionBasisPoints int64 = 150

// Settings is the platform's commercial configuration.
type Settings struct {
	ID string `bson:"_id" json:"-"`

	// CommissionBasisPoints is the platform's cut of each gift, applied to
	// churches that have no rate of their own.
	CommissionBasisPoints int64 `bson:"commissionBasisPoints" json:"commissionBasisPoints"`

	// DefaultFeeBearer is what a NEW church starts with. Existing churches
	// keep whatever they chose (Q-4).
	DefaultFeeBearer money.FeeBearer `bson:"defaultFeeBearer" json:"defaultFeeBearer"`

	// ProviderFees is the payment provider's rate card, per channel.
	//
	// Stored rather than compiled in because it is a commercial term that
	// changes without notice, and because with the giver bearing the fee it is
	// a number shown to a member before they confirm a payment.
	ProviderFees map[string]money.FeeSchedule `bson:"providerFees" json:"providerFees"`

	// MessagingRates is what one billed unit costs on each channel — per SMS
	// SEGMENT, not per message, because that is how providers bill and it is
	// the number a cost preview has to multiply.
	//
	// Stored in minor units with a currency, so a rate can be entered in the
	// currency the platform is actually invoiced in.
	MessagingRates map[string]money.Amount `bson:"messagingRates" json:"messagingRates"`

	UpdatedBy mongodb.ID `bson:"updatedBy,omitempty" json:"updatedBy,omitempty"`
	UpdatedAt time.Time  `bson:"updatedAt" json:"updatedAt"`
}

// FeeFor returns the schedule for a channel, falling back to a default entry.
func (s *Settings) FeeFor(channel string) money.FeeSchedule {
	if s == nil {
		return money.FeeSchedule{}
	}
	if schedule, ok := s.ProviderFees[strings.ToLower(strings.TrimSpace(channel))]; ok {
		return schedule
	}
	// A channel nobody configured charges NOTHING rather than guessing.
	//
	// The direction matters and it is the opposite of the usual "fail safe".
	// Guessing high overcharges a giver for a channel the operator never
	// priced; charging nothing means the church absorbs a fee it did not
	// expect, which shows up on its own statement where somebody will query it.
	// A wrong number in front of a giver is worse than a missing one behind
	// the scenes.
	return money.FeeSchedule{}
}

// Defaults is the configuration before an operator has entered anything.
//
// The provider fees are deliberately EMPTY rather than pre-filled with
// plausible Ghanaian rates. A plausible-looking rate card that nobody entered
// is the worst of both worlds: it is wrong, and it looks deliberate. Empty
// means every gift quotes a zero fee until an operator types the real one,
// which is visibly incomplete rather than quietly incorrect.
func Defaults() *Settings {
	return &Settings{
		ID:                    singletonID,
		CommissionBasisPoints: DefaultCommissionBasisPoints,
		DefaultFeeBearer:      money.BearerGiver,
		ProviderFees:          map[string]money.FeeSchedule{},
		MessagingRates:        map[string]money.Amount{},
	}
}

// MessagingRate returns the price per billed unit on a channel.
//
// The second return says whether a rate EXISTS. Zero and unconfigured must not
// be conflated: a church shown "GHS 0.00" for a broadcast to four hundred
// people will believe it, and the correction arrives as an invoice.
func (s *Settings) MessagingRate(channel string) (money.Amount, bool) {
	if s == nil {
		return money.Amount{}, false
	}
	rate, ok := s.MessagingRates[strings.ToLower(strings.TrimSpace(channel))]
	if !ok || rate.Minor <= 0 {
		return money.Amount{}, false
	}
	return rate, true
}

// Service reads and writes the platform's settings.
type Service struct {
	coll *mongo.Collection
	now  func() time.Time
}

// NewService builds the settings service.
func NewService(db *mongodb.DB) *Service {
	return &Service{coll: db.Global(Collection), now: time.Now}
}

// Current returns the settings, falling back to defaults.
//
// Never returns an error for "not configured yet" — a platform with no settings
// document is a new platform, not a broken one, and every giving request reads
// this.
func (s *Service) Current(ctx context.Context) (*Settings, error) {
	var found Settings
	err := s.coll.FindOne(ctx, bson.M{"_id": singletonID}).Decode(&found)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return Defaults(), nil
	}
	if err != nil {
		return nil, fmt.Errorf("platformsetting: read: %w", err)
	}

	// Fill anything a partial document is missing, so adding a field later
	// does not read as zero on every existing deployment.
	if found.CommissionBasisPoints <= 0 {
		found.CommissionBasisPoints = DefaultCommissionBasisPoints
	}
	found.DefaultFeeBearer = money.NormaliseFeeBearer(string(found.DefaultFeeBearer))
	if found.ProviderFees == nil {
		found.ProviderFees = map[string]money.FeeSchedule{}
	}
	if found.MessagingRates == nil {
		found.MessagingRates = map[string]money.Amount{}
	}
	return &found, nil
}

// Update is a partial write. Nil fields are left alone.
type Update struct {
	CommissionBasisPoints *int64
	DefaultFeeBearer      *string
	ProviderFees          map[string]money.FeeSchedule
	MessagingRates        map[string]money.Amount
	ActorID               string
}

// Save applies an update.
func (s *Service) Save(ctx context.Context, in Update) (*Settings, error) {
	set := bson.M{"updatedAt": s.now().UTC()}

	if in.CommissionBasisPoints != nil {
		rate := *in.CommissionBasisPoints
		if rate < 0 || rate > MaxCommissionBasisPoints {
			return nil, fmt.Errorf("%w: %d is outside 0–%d basis points",
				ErrInvalidRate, rate, MaxCommissionBasisPoints)
		}
		set["commissionBasisPoints"] = rate
	}

	if in.DefaultFeeBearer != nil {
		bearer := money.FeeBearer(*in.DefaultFeeBearer)
		if !bearer.Valid() {
			return nil, fmt.Errorf("%w: fee bearer must be %q or %q",
				ErrInvalidFee, money.BearerGiver, money.BearerChurch)
		}
		set["defaultFeeBearer"] = string(bearer)
	}

	if in.ProviderFees != nil {
		cleaned := make(map[string]money.FeeSchedule, len(in.ProviderFees))
		for channel, schedule := range in.ProviderFees {
			key := strings.ToLower(strings.TrimSpace(channel))
			if key == "" {
				return nil, fmt.Errorf("%w: a fee schedule with no channel", ErrInvalidFee)
			}
			if schedule.BasisPoints < 0 || schedule.FlatMinor < 0 ||
				schedule.CapMinor < 0 || schedule.WaiveBelowMinor < 0 {
				return nil, fmt.Errorf("%w: %s has a negative component", ErrInvalidFee, key)
			}
			// A percentage above 10% on a payment channel is a typo, for the
			// same reason the commission cap exists.
			if schedule.BasisPoints > MaxCommissionBasisPoints {
				return nil, fmt.Errorf("%w: %s charges %d basis points, which is above the %d cap",
					ErrInvalidFee, key, schedule.BasisPoints, MaxCommissionBasisPoints)
			}
			cleaned[key] = schedule
		}
		set["providerFees"] = cleaned
	}

	if in.MessagingRates != nil {
		cleaned := make(map[string]money.Amount, len(in.MessagingRates))
		for channel, rate := range in.MessagingRates {
			key := strings.ToLower(strings.TrimSpace(channel))
			if key == "" {
				return nil, fmt.Errorf("%w: a messaging rate with no channel", ErrInvalidFee)
			}
			if rate.Minor < 0 {
				return nil, fmt.Errorf("%w: %s has a negative rate", ErrInvalidFee, key)
			}
			if rate.Currency == "" {
				return nil, fmt.Errorf("%w: %s has no currency", ErrInvalidFee, key)
			}
			cleaned[key] = rate
		}
		set["messagingRates"] = cleaned
	}

	if in.ActorID != "" {
		set["updatedBy"] = mongodb.ID(in.ActorID)
	}

	_, err := s.coll.UpdateOne(ctx, bson.M{"_id": singletonID},
		bson.M{
			"$set": set,
			"$setOnInsert": bson.M{
				"_id":       singletonID,
				"createdAt": s.now().UTC(),
			},
		},
		options.UpdateOne().SetUpsert(true))
	if err != nil {
		return nil, fmt.Errorf("platformsetting: save: %w", err)
	}
	return s.Current(ctx)
}
