package money

import "testing"

// The threshold is cumulative per day, not per transaction. Five GHS 30 gifts
// cross GHS 100 even though no single one does; charging per transaction
// under-quotes exactly the giver who gives most often.
func TestELevyThresholdIsCumulativePerDay(t *testing.T) {
	thirty := MustNew(3000, "GHS")

	// First three gifts stay inside the GHS 100 allowance (30, 60, 90).
	prior := int64(0)
	for i := 0; i < 3; i++ {
		q := QuoteELevy(thirty, ChannelMobileMoney, prior)
		if !q.Exempt {
			t.Fatalf("gift %d (prior %d) should be exempt, got levy %s", i+1, prior, q.Levy)
		}
		prior += thirty.Minor
	}

	// The fourth crosses: allowance has 10.00 left, so 20.00 is levied.
	q := QuoteELevy(thirty, ChannelMobileMoney, prior)
	if q.Exempt {
		t.Fatal("the fourth gift crosses GHS 100 and must be levied")
	}
	if q.Levy.Minor != 20 { // 1% of GHS 20.00 = 20 pesewas
		t.Errorf("levy = %s, want GHS 0.20", q.Levy)
	}
	if q.Total.Minor != thirty.Minor+20 {
		t.Errorf("total debit = %s, want GHS 30.20", q.Total)
	}
}

// Only the portion above the allowance is levied — that is how the daily
// allowance works, and levying the whole amount over-quotes the giver.
func TestOnlyTheAmountAboveTheAllowanceIsLevied(t *testing.T) {
	q := QuoteELevy(MustNew(15000, "GHS"), ChannelMobileMoney, 0) // GHS 150, nothing prior
	if q.Exempt {
		t.Fatal("GHS 150 in one transfer exceeds the allowance")
	}
	// Levyable is GHS 50.00; 1% is 50 pesewas.
	if q.Levy.Minor != 50 {
		t.Errorf("levy = %s, want GHS 0.50 (1%% of the GHS 50 above the allowance)", q.Levy)
	}
}

// Once the allowance is spent, the whole transfer is levied.
func TestFullyLeviedOnceAllowanceIsSpent(t *testing.T) {
	q := QuoteELevy(MustNew(5000, "GHS"), ChannelMobileMoney, 20000) // GHS 200 already today
	if q.Exempt {
		t.Fatal("the allowance is spent; this must be levied")
	}
	if q.Levy.Minor != 50 { // 1% of GHS 50.00
		t.Errorf("levy = %s, want GHS 0.50", q.Levy)
	}
}

// Cash counted at a service is not an electronic transfer.
func TestChannelsThatAreNotElectronicTransfers(t *testing.T) {
	big := MustNew(100000, "GHS") // GHS 1,000
	for _, ch := range []string{ChannelCash, ChannelCard} {
		q := QuoteELevy(big, ch, 0)
		if !q.Exempt {
			t.Errorf("%s is not a levied transfer, got levy %s", ch, q.Levy)
		}
		if q.Total.Minor != big.Minor {
			t.Errorf("%s total should equal the gift, got %s", ch, q.Total)
		}
	}
	for _, ch := range []string{ChannelMobileMoney, ChannelBankTransfer, ChannelUSSD} {
		if q := QuoteELevy(big, ch, 0); q.Exempt {
			t.Errorf("%s is an electronic transfer and must be levied", ch)
		}
	}
}

// The levy is a Ghanaian tax; a Nigerian gift is not subject to it.
func TestLevyIsGhanaOnly(t *testing.T) {
	q := QuoteELevy(MustNew(100000, "NGN"), ChannelMobileMoney, 0)
	if !q.Exempt {
		t.Fatal("E-Levy must not be applied to NGN")
	}
}

// Whatever the position, the giver must be told in plain words — this string
// goes on the confirmation screen before they authorise the debit.
func TestQuoteAlwaysExplainsItself(t *testing.T) {
	cases := []LevyQuote{
		QuoteELevy(MustNew(1000, "GHS"), ChannelMobileMoney, 0),
		QuoteELevy(MustNew(50000, "GHS"), ChannelMobileMoney, 0),
		QuoteELevy(MustNew(5000, "GHS"), ChannelMobileMoney, 20000),
		QuoteELevy(MustNew(5000, "GHS"), ChannelCash, 0),
		QuoteELevy(MustNew(5000, "NGN"), ChannelMobileMoney, 0),
	}
	for i, q := range cases {
		if q.Reason == "" {
			t.Errorf("case %d has no explanation for the giver", i)
		}
	}
}

// The total is what the giver is debited, and must never be less than the
// gift — the church receiving less than the giver intended is the failure
// this whole model exists to prevent.
func TestTotalNeverUndercutsTheGift(t *testing.T) {
	for _, prior := range []int64{0, 5000, 10000, 50000, -1} {
		for _, minor := range []int64{1, 100, 9999, 10000, 10001, 1000000} {
			gift := MustNew(minor, "GHS")
			q := QuoteELevy(gift, ChannelMobileMoney, prior)
			if q.Total.Minor < gift.Minor {
				t.Fatalf("gift %s prior %d: total %s is less than the gift", gift, prior, q.Total)
			}
			if q.Levy.Minor < 0 {
				t.Fatalf("gift %s prior %d: negative levy %s", gift, prior, q.Levy)
			}
			if sum, _ := gift.Add(q.Levy); sum.Minor != q.Total.Minor {
				t.Fatalf("gift %s prior %d: total is not gift+levy", gift, prior)
			}
		}
	}
}
