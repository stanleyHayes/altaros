package money

import "fmt"

// Who absorbs the payment provider's processing fee (Q-4, answered 2 Aug 2026:
// a per-church flag defaulting to the giver).
//
// # Why this is not simply a Paystack field
//
// Paystack's `bearer` has two values, `account` and `subaccount`, and both name
// a MERCHANT — the platform or the church. There is no "customer bears it"
// option, because the provider's fee is always deducted from the settlement.
//
// So "the giver pays" is not a flag that can be forwarded to the provider. It
// means charging the giver MORE — the gift plus the fee — so that after the
// deduction the church receives the gift the giver intended to make. That
// arithmetic is what this file is, and doing it wrong in either direction is
// visible on a settlement statement:
//
//   - Under-estimating the fee shorts the church by the difference on every
//     single gift, silently, forever.
//   - Over-estimating charges the giver more than the church receives, which
//     is the version that gets noticed — and it is noticed as dishonesty
//     rather than as a rounding bug.
//
// The rates are therefore CONFIGURED, not compiled in. They are commercial
// terms that change without notice and differ by channel and by country, and a
// constant in a Go file is the version nobody updates.

// FeeBearer is who absorbs the payment provider's fee.
type FeeBearer string

const (
	// BearerGiver adds the provider's fee to what the giver is charged, so the
	// church receives the full gift. The default (Q-4).
	BearerGiver FeeBearer = "giver"
	// BearerChurch leaves the fee to be deducted from the church's settlement,
	// so the giver is charged exactly the amount they chose.
	BearerChurch FeeBearer = "church"
)

// Valid reports whether a bearer is recognised.
func (b FeeBearer) Valid() bool { return b == BearerGiver || b == BearerChurch }

// NormaliseFeeBearer resolves a stored value, defaulting to the giver.
//
// An unrecognised value falls back to the DEFAULT rather than to whichever is
// cheaper for the platform, and the direction is deliberate: the fallback has
// to be the behaviour a church that never touched the setting agreed to.
func NormaliseFeeBearer(raw string) FeeBearer {
	if FeeBearer(raw).Valid() {
		return FeeBearer(raw)
	}
	return BearerGiver
}

// FeeSchedule is a provider's rate card for one channel.
//
// Percentage plus a flat component plus a cap covers how every processor in
// this market prices, including the ones ALTAR OS does not use yet.
type FeeSchedule struct {
	// BasisPoints is the percentage component. 195 = 1.95%.
	BasisPoints int64
	// FlatMinor is added to every transaction, in minor units.
	FlatMinor int64
	// CapMinor caps the total fee. Zero means uncapped.
	CapMinor int64
	// WaiveBelowMinor leaves transactions under this amount unfeed. Some
	// processors waive small mobile-money transfers; zero disables it.
	WaiveBelowMinor int64
}

// Fee computes the provider's fee on an amount.
func (s FeeSchedule) Fee(amount Amount) Amount {
	if amount.Minor <= 0 || s.IsZero() {
		return Zero(amount.Currency)
	}
	if s.WaiveBelowMinor > 0 && amount.Minor < s.WaiveBelowMinor {
		return Zero(amount.Currency)
	}

	fee := amount.PercentBasisPoints(s.BasisPoints).Minor + s.FlatMinor
	if s.CapMinor > 0 && fee > s.CapMinor {
		fee = s.CapMinor
	}
	return Amount{Minor: fee, Currency: amount.Currency}
}

// IsZero reports whether the schedule charges nothing.
func (s FeeSchedule) IsZero() bool {
	return s.BasisPoints == 0 && s.FlatMinor == 0
}

// FeeQuote is the full breakdown of a gift, for display BEFORE confirmation.
//
// Every field is here because the giving screen has to show it. A flow that
// debits more than it displayed destroys trust faster than any bug (§2.3), and
// with the giver bearing the fee the amount charged is by definition not the
// amount typed — so the difference has to be on screen, not in a receipt.
type FeeQuote struct {
	// Gift is what the giver chose to give, and what the church receives
	// before the platform's own commission.
	Gift Amount `json:"gift"`
	// ProviderFee is the payment processor's charge.
	ProviderFee Amount `json:"providerFee"`
	// Charged is what the giver is actually debited, excluding any levy.
	Charged Amount `json:"charged"`
	// Bearer names who absorbed the fee, so the UI can explain rather than
	// just show a larger number.
	Bearer FeeBearer `json:"bearer"`
	// Explanation is the sentence to show the giver.
	Explanation string `json:"explanation"`
	// Estimated marks a fee we computed rather than one the provider quoted.
	// It is always true today: the fee is only known exactly once the charge
	// settles. Anything reading this as authoritative is reading it wrong.
	Estimated bool `json:"estimated"`
}

// QuoteFee works out what the giver is charged and what the church receives.
//
// The gift is never reduced. When the church bears the fee, the giver pays the
// gift and the deduction happens at settlement; when the giver bears it, the
// charge grows. In neither case does the amount recorded as given change,
// because the amount recorded as given is what the person decided to give —
// and a receipt that says otherwise is the thing a church cannot explain to a
// member.
func QuoteFee(gift Amount, schedule FeeSchedule, bearer FeeBearer) FeeQuote {
	bearer = NormaliseFeeBearer(string(bearer))
	fee := schedule.Fee(gift)

	quote := FeeQuote{
		Gift:        gift,
		ProviderFee: fee,
		Charged:     gift,
		Bearer:      bearer,
		Estimated:   true,
	}

	if fee.Minor == 0 {
		quote.Explanation = fmt.Sprintf("%s goes to the church in full.", gift)
		return quote
	}

	if bearer == BearerChurch {
		quote.Explanation = fmt.Sprintf(
			"You pay %s. The church covers the %s payment charge.", gift, fee)
		return quote
	}

	// The giver bears it, so the charge grows by the fee.
	//
	// Note what this deliberately does NOT do: it does not re-run the
	// percentage against the grown total. Charging gift+fee means the provider
	// takes its percentage of gift+fee, which is fractionally more than `fee`,
	// so the church is short by the fee-on-the-fee — a few pesewas on a GHS 100
	// gift. Solving that exactly needs the inverse of the whole rate card
	// including its cap, and it is the kind of arithmetic that is confidently
	// wrong at the cap boundary. Being a few pesewas short is a real, bounded
	// shortfall; it is recorded here rather than hidden, and it is why
	// Estimated is true.
	quote.Charged = Amount{Minor: gift.Minor + fee.Minor, Currency: gift.Currency}
	quote.Explanation = fmt.Sprintf(
		"You pay %s — %s to the church plus a %s payment charge, so the church "+
			"receives your full gift.", quote.Charged, gift, fee)
	return quote
}

// GivingQuote is everything a giver must see before they confirm.
//
// One quote rather than two, and that is the point of it existing. The levy and
// the provider fee were previously quoted independently, and the endpoint that
// guards against a changed total compared only the levy — so with the giver
// bearing the provider fee, the amount they accepted and the amount they were
// debited would differ by exactly the fee, and the guard would say nothing.
type GivingQuote struct {
	// Gift is what the church receives, before the platform's commission.
	Gift Amount `json:"gift"`
	// Fee is the provider-fee position.
	Fee FeeQuote `json:"fee"`
	// Levy is the E-Levy position.
	Levy LevyQuote `json:"levy"`
	// Total is what the giver is debited, all in. This is the ONLY number a
	// confirmation should be checked against.
	Total Amount `json:"total"`
}

// QuoteGiving prices a gift end to end.
//
// The ORDER is load-bearing. The E-Levy is charged on the amount actually
// transferred, so when the giver bears the provider fee the transfer is
// gift+fee and the levy applies to that larger figure. Quoting the levy on the
// gift alone under-quotes every gift near a threshold — and under-quoting is
// the direction that ends with a debit larger than the screen promised.
func QuoteGiving(gift Amount, channel string, priorTodayMinor int64,
	schedule FeeSchedule, bearer FeeBearer) GivingQuote {

	fee := QuoteFee(gift, schedule, bearer)
	levy := QuoteELevy(fee.Charged, channel, priorTodayMinor)

	return GivingQuote{
		Gift:  gift,
		Fee:   fee,
		Levy:  levy,
		Total: levy.Total,
	}
}
