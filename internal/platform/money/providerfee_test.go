package money

import "testing"

// Q-4: the giver bears the payment fee by default. That makes this arithmetic
// the difference between what a member's bank statement says and what their
// church receives, so each direction of getting it wrong is tested by name.

func TestGiverBearingTheFeeIsChargedMoreSoTheChurchGetsTheWholeGift(t *testing.T) {
	gift := MustNew(10000, "GHS") // GHS 100.00
	schedule := FeeSchedule{BasisPoints: 195}

	quote := QuoteFee(gift, schedule, BearerGiver)

	if quote.Gift.Minor != 10000 {
		t.Errorf("the gift changed: %s", quote.Gift)
	}
	if quote.ProviderFee.Minor != 195 {
		t.Errorf("fee = %s, want GHS 1.95", quote.ProviderFee)
	}
	if quote.Charged.Minor != 10195 {
		t.Errorf("charged = %s, want GHS 101.95", quote.Charged)
	}
	if quote.Bearer != BearerGiver {
		t.Errorf("bearer = %q", quote.Bearer)
	}
}

func TestChurchBearingTheFeeLeavesTheGiverPayingWhatTheyChose(t *testing.T) {
	gift := MustNew(10000, "GHS")
	quote := QuoteFee(gift, FeeSchedule{BasisPoints: 195}, BearerChurch)

	if quote.Charged.Minor != gift.Minor {
		t.Errorf("charged = %s, want the gift %s — the church absorbs the fee "+
			"at settlement, the giver is not charged extra", quote.Charged, gift)
	}
	// The fee is still reported, because the church needs to see what its own
	// choice costs it.
	if quote.ProviderFee.Minor != 195 {
		t.Errorf("fee = %s, want it reported even though the giver does not pay it",
			quote.ProviderFee)
	}
}

func TestTheGiftItselfIsNeverReduced(t *testing.T) {
	// Whichever way the flag points, the amount recorded as given is what the
	// person decided to give. A receipt that says otherwise is the thing a
	// church cannot explain to a member.
	gift := MustNew(5000, "GHS")
	for _, bearer := range []FeeBearer{BearerGiver, BearerChurch} {
		quote := QuoteFee(gift, FeeSchedule{BasisPoints: 300, FlatMinor: 50}, bearer)
		if quote.Gift.Minor != gift.Minor {
			t.Errorf("bearer %q reduced the gift to %s", bearer, quote.Gift)
		}
	}
}

func TestFeeScheduleAppliesItsCapAndItsWaiver(t *testing.T) {
	schedule := FeeSchedule{BasisPoints: 195, FlatMinor: 30, CapMinor: 1000, WaiveBelowMinor: 500}

	// Below the waiver: nothing.
	if fee := schedule.Fee(MustNew(400, "GHS")); fee.Minor != 0 {
		t.Errorf("a waived transaction was charged %s", fee)
	}
	// In the ordinary band: percentage plus flat.
	if fee := schedule.Fee(MustNew(10000, "GHS")); fee.Minor != 225 {
		t.Errorf("fee = %s, want 1.95%% + 0.30 = GHS 2.25", fee)
	}
	// Above the cap: capped.
	if fee := schedule.Fee(MustNew(1000000, "GHS")); fee.Minor != 1000 {
		t.Errorf("fee = %s, want the GHS 10.00 cap", fee)
	}
}

func TestAnUnconfiguredScheduleChargesNothing(t *testing.T) {
	// The direction is deliberate and it is the opposite of "fail safe":
	// guessing a rate would show a giver a number nobody entered, whereas
	// charging nothing means the church absorbs a fee it will query on its own
	// statement. A wrong number in front of a giver is the worse failure.
	quote := QuoteFee(MustNew(10000, "GHS"), FeeSchedule{}, BearerGiver)
	if quote.Charged.Minor != 10000 || quote.ProviderFee.Minor != 0 {
		t.Errorf("an unconfigured schedule produced %s charged / %s fee",
			quote.Charged, quote.ProviderFee)
	}
}

func TestTheLevyIsQuotedOnWhatIsActuallyTransferred(t *testing.T) {
	// The ordering bug this guards. The E-Levy is charged on the amount
	// transferred, so when the giver bears the provider fee the transfer is
	// gift+fee — and quoting the levy on the gift alone under-quotes every
	// gift near a threshold, which is the direction that ends with a debit
	// larger than the screen promised.
	gift := MustNew(50000, "GHS") // well past the daily allowance
	schedule := FeeSchedule{BasisPoints: 195}

	combined := QuoteGiving(gift, ChannelMobileMoney, 0, schedule, BearerGiver)
	onGiftAlone := QuoteELevy(gift, ChannelMobileMoney, 0)

	if combined.Levy.Levy.Minor <= onGiftAlone.Levy.Minor {
		t.Fatalf("levy on gift+fee (%s) should exceed levy on the gift alone (%s)",
			combined.Levy.Levy, onGiftAlone.Levy)
	}
	// And the single total is what a confirmation must be checked against.
	if combined.Total.Minor != combined.Levy.Total.Minor {
		t.Errorf("total = %s but the levy quote says %s",
			combined.Total, combined.Levy.Total)
	}
	if combined.Total.Minor <= combined.Fee.Charged.Minor {
		t.Errorf("total %s does not include the levy on top of the charge %s",
			combined.Total, combined.Fee.Charged)
	}
}

func TestChurchBearingTheFeeQuotesTheLevyOnTheGiftAlone(t *testing.T) {
	// The mirror of the above: with the church bearing it, nothing is added to
	// the transfer, so the levy is the same as it always was.
	gift := MustNew(50000, "GHS")
	combined := QuoteGiving(gift, ChannelMobileMoney, 0,
		FeeSchedule{BasisPoints: 195}, BearerChurch)
	alone := QuoteELevy(gift, ChannelMobileMoney, 0)

	if combined.Total.Minor != alone.Total.Minor {
		t.Errorf("total = %s, want the unchanged %s", combined.Total, alone.Total)
	}
}

func TestAnUnrecognisedBearerFallsBackToTheDefault(t *testing.T) {
	// The fallback has to be the behaviour a church that never touched the
	// setting agreed to — not whichever is cheaper for the platform.
	for _, raw := range []string{"", "platform", "GIVER", "nonsense"} {
		got := NormaliseFeeBearer(raw)
		if raw == "giver" && got != BearerGiver {
			t.Errorf("NormaliseFeeBearer(%q) = %q", raw, got)
		}
		if !got.Valid() {
			t.Errorf("NormaliseFeeBearer(%q) produced an invalid bearer %q", raw, got)
		}
		if raw != "church" && got != BearerGiver {
			t.Errorf("NormaliseFeeBearer(%q) = %q, want the default %q",
				raw, got, BearerGiver)
		}
	}
	if got := NormaliseFeeBearer("church"); got != BearerChurch {
		t.Errorf("an explicit church choice was overridden: %q", got)
	}
}

func TestTheGiverIsAlwaysToldWhatTheyArePaying(t *testing.T) {
	// With the giver bearing the fee, the charged amount is by definition not
	// the amount typed. An explanation that does not name both numbers leaves
	// the difference to be discovered on a bank statement.
	quote := QuoteFee(MustNew(10000, "GHS"), FeeSchedule{BasisPoints: 195}, BearerGiver)
	for _, want := range []string{"101.95", "100.00", "1.95"} {
		if !containsSubstring(quote.Explanation, want) {
			t.Errorf("the explanation %q does not mention %s", quote.Explanation, want)
		}
	}
	if !quote.Estimated {
		t.Error("a computed fee must be marked estimated; the exact figure is " +
			"only known once the charge settles")
	}
}

func containsSubstring(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
