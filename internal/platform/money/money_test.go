package money

import (
	"errors"
	"testing"
)

// The reason this package exists: a hundred ten-pesewa offerings must total
// exactly GHS 10.00. Through float64 they do not.
func TestSmallAmountsSumExactly(t *testing.T) {
	total := Zero("GHS")
	tenPesewas := MustNew(10, "GHS")
	for i := 0; i < 100; i++ {
		var err error
		total, err = total.Add(tenPesewas)
		if err != nil {
			t.Fatalf("Add: %v", err)
		}
	}
	if total.Minor != 1000 {
		t.Fatalf("100 × GHS 0.10 must be GHS 10.00 (1000 pesewas), got %d", total.Minor)
	}
	if total.Decimal() != "10.00" {
		t.Errorf("Decimal() = %q, want \"10.00\"", total.Decimal())
	}
}

// Parsing must not route through float64. "0.10" as a float times 100 is
// 10.000000000000002, which truncates to 9.
func TestParseDoesNotLoseAPesewa(t *testing.T) {
	cases := []struct {
		in   string
		want int64
	}{
		{"0.10", 10},
		{"0.01", 1},
		{"12.34", 1234},
		{"12", 1200},
		{"12.3", 1230},
		{"1,200.50", 120050},
		{"  50.00  ", 5000},
		{"-25.50", -2550},
		{"+7.25", 725},
		{".50", 50},
		{"0", 0},
	}
	for _, c := range cases {
		got, err := Parse(c.in, "GHS")
		if err != nil {
			t.Errorf("Parse(%q): %v", c.in, err)
			continue
		}
		if got.Minor != c.want {
			t.Errorf("Parse(%q) = %d minor, want %d", c.in, got.Minor, c.want)
		}
	}
}

// Silently truncating extra precision hides whether the input was a typo.
func TestParseRefusesExcessPrecision(t *testing.T) {
	if _, err := Parse("10.999", "GHS"); !errors.Is(err, ErrMalformed) {
		t.Fatalf("want ErrMalformed for excess precision, got %v", err)
	}
}

func TestParseRejectsGarbage(t *testing.T) {
	for _, in := range []string{"", "  ", "abc", "1.2.3", "-", "+"} {
		if _, err := Parse(in, "GHS"); err == nil {
			t.Errorf("Parse(%q) should have failed", in)
		}
	}
}

// Round-tripping must be lossless, or reconciliation reports disagree with
// the ledger they are built from.
func TestParseDecimalRoundTrip(t *testing.T) {
	for _, s := range []string{"0.00", "0.01", "9.99", "100.00", "1234.56", "-25.50"} {
		a, err := Parse(s, "GHS")
		if err != nil {
			t.Fatalf("Parse(%q): %v", s, err)
		}
		if a.Decimal() != s {
			t.Errorf("round trip %q -> %q", s, a.Decimal())
		}
	}
}

// Currencies with no minor unit exist in the expansion markets, so "×100
// everywhere" is wrong before leaving the region.
func TestZeroExponentCurrency(t *testing.T) {
	a, err := Parse("1500", "UGX")
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if a.Minor != 1500 {
		t.Errorf("UGX 1500 should be 1500 minor units, got %d", a.Minor)
	}
	if a.Decimal() != "1500" {
		t.Errorf("Decimal() = %q, want \"1500\"", a.Decimal())
	}
	if _, err := Parse("15.50", "UGX"); err == nil {
		t.Error("UGX has no decimal places; 15.50 should be refused")
	}
}

// GHS 10 plus NGN 10 is not a number.
func TestCurrenciesDoNotMix(t *testing.T) {
	ghs := MustNew(1000, "GHS")
	ngn := MustNew(1000, "NGN")

	if _, err := ghs.Add(ngn); !errors.Is(err, ErrCurrencyMismatch) {
		t.Errorf("Add across currencies must fail, got %v", err)
	}
	if _, err := ghs.Sub(ngn); !errors.Is(err, ErrCurrencyMismatch) {
		t.Errorf("Sub across currencies must fail, got %v", err)
	}
	if _, err := ghs.Compare(ngn); !errors.Is(err, ErrCurrencyMismatch) {
		t.Errorf("Compare across currencies must fail, got %v", err)
	}
}

func TestUnknownCurrencyIsRefused(t *testing.T) {
	if _, err := New(100, "XYZ"); !errors.Is(err, ErrUnknownCurrency) {
		t.Fatalf("want ErrUnknownCurrency, got %v", err)
	}
}

// The split must round the same way the provider does, or every transaction
// reconciles a pesewa short.
func TestPercentBasisPointsRoundsHalfUp(t *testing.T) {
	cases := []struct {
		minor int64
		bps   int64
		want  int64
	}{
		{10000, 150, 150}, // GHS 100 at 1.5% = GHS 1.50
		{10000, 100, 100}, // GHS 100 at 1%   = GHS 1.00
		{333, 150, 5},     // 4.995 -> 5 (half-up, not 4)
		{100, 150, 2},     // 1.5   -> 2
		{1, 150, 0},       // 0.015 -> 0
		{0, 150, 0},
		{10000, 0, 0},
		{-10000, 150, -150}, // symmetric for refunds
	}
	for _, c := range cases {
		got := Amount{Minor: c.minor, Currency: "GHS"}.PercentBasisPoints(c.bps)
		if got.Minor != c.want {
			t.Errorf("%d minor at %d bps = %d, want %d", c.minor, c.bps, got.Minor, c.want)
		}
	}
}

func TestStringIncludesCurrency(t *testing.T) {
	if got := MustNew(1234, "GHS").String(); got != "GHS 12.34" {
		t.Errorf("String() = %q, want \"GHS 12.34\"", got)
	}
}
