package money

// Ghana's Electronic Transfer Levy (E-Levy), still active at 1% on transfers
// above GHS 100 per day as of April 2026, despite widely-reported expectations
// of permanent abolition (§2.3).
//
// This is modelled here rather than left to the UI for one reason: the giver
// is debited more than the church receives, and a giving flow that quietly
// under-delivers versus the amount debited destroys trust faster than any bug.
// The levy is computed before confirmation, shown to the giver, stored on the
// transaction, and excluded from the church's recognised income.
const (
	// ELevyBasisPoints is 1%.
	ELevyBasisPoints int64 = 100
	// ELevyDailyThresholdMinor is GHS 100.00 in pesewas. Transfers at or below
	// the cumulative daily threshold are exempt.
	ELevyDailyThresholdMinor int64 = 10000
	// ELevyCurrency is the only currency the levy applies to.
	ELevyCurrency = "GHS"
)

// LevyQuote is the levy position for one intended transfer.
type LevyQuote struct {
	// Levy is the amount the levy adds. Zero when exempt.
	Levy Amount `json:"levy"`
	// Total is what the giver is actually debited (transfer + levy).
	Total Amount `json:"total"`
	// Exempt reports whether the levy did not apply.
	Exempt bool `json:"exempt"`
	// Reason explains the position in words the giver can read.
	Reason string `json:"reason"`
}

// QuoteELevy computes the levy on a transfer, given how much the same person
// has already transferred today.
//
// priorTodayMinor is the giver's cumulative transfers for the day. The
// threshold is cumulative and per-day, not per-transaction: five GHS 30 gifts
// in one day cross GHS 100 even though no single one does. Charging per
// transaction would under-quote exactly the giver who gives most often.
//
// Only the portion above the threshold is levied, which is how the daily
// allowance actually works.
func QuoteELevy(transfer Amount, channel string, priorTodayMinor int64) LevyQuote {
	exempt := func(reason string) LevyQuote {
		return LevyQuote{
			Levy:   Zero(transfer.Currency),
			Total:  transfer,
			Exempt: true,
			Reason: reason,
		}
	}

	if transfer.Currency != ELevyCurrency {
		return exempt("E-Levy applies only to Ghana cedi transfers")
	}
	// The levy is on electronic transfers. Cash counted at a service and
	// card payments are not electronic transfers in the levied sense.
	if channel != ChannelMobileMoney && channel != ChannelBankTransfer && channel != ChannelUSSD {
		return exempt("E-Levy applies only to mobile money and bank transfers")
	}
	if transfer.Minor <= 0 {
		return exempt("no transfer amount")
	}

	if priorTodayMinor < 0 {
		priorTodayMinor = 0
	}
	remainingAllowance := ELevyDailyThresholdMinor - priorTodayMinor
	if remainingAllowance < 0 {
		remainingAllowance = 0
	}

	levyableMinor := transfer.Minor - remainingAllowance
	if levyableMinor <= 0 {
		return exempt("within the GHS 100 daily exemption")
	}

	levyable := Amount{Minor: levyableMinor, Currency: transfer.Currency}
	levy := levyable.PercentBasisPoints(ELevyBasisPoints)
	total, _ := transfer.Add(levy)

	reason := "1% E-Levy on the amount above the GHS 100 daily exemption"
	if remainingAllowance == 0 {
		reason = "1% E-Levy — the GHS 100 daily exemption is already used"
	}
	return LevyQuote{Levy: levy, Total: total, Exempt: false, Reason: reason}
}

// Payment channels. Mobile money is the default rail in Ghana, not an option
// alongside card (§2.3).
const (
	ChannelMobileMoney  = "mobile_money"
	ChannelCard         = "card"
	ChannelBankTransfer = "bank_transfer"
	ChannelUSSD         = "ussd"
	ChannelCash         = "cash"
)

// ValidChannel reports whether a channel is recognised.
func ValidChannel(c string) bool {
	switch c {
	case ChannelMobileMoney, ChannelCard, ChannelBankTransfer, ChannelUSSD, ChannelCash:
		return true
	}
	return false
}
