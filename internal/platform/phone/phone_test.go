package phone

import (
	"errors"
	"testing"
)

// The headline case: every way a Ghanaian congregation actually writes one
// number must collapse to a single stored value. Without this they are six
// different members and the unique index does nothing.
func TestGhanaianSpellingsCollapseToOneNumber(t *testing.T) {
	spellings := []string{
		"024 123 4567",
		"0241234567",
		"024-123-4567",
		"24 123 4567",
		"241234567",
		"+233 24 123 4567",
		"+233241234567",
		"233241234567",
		"00233241234567",
		"  0241234567  ",
		"(024) 123-4567",
	}

	const want = "+233241234567"
	for _, raw := range spellings {
		got, err := Normalize(raw, "GH")
		if err != nil {
			t.Errorf("Normalize(%q): unexpected error %v", raw, err)
			continue
		}
		if got != want {
			t.Errorf("Normalize(%q) = %q, want %q", raw, got, want)
		}
	}
}

// An explicit international number must never be rewritten into the church's
// country — a member with a UK number is not a Ghanaian number.
func TestInternationalNumberIsNotRewrittenToLocalCountry(t *testing.T) {
	got, err := Normalize("+447700900123", "GH")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "+447700900123" {
		t.Errorf("a +44 number must stay +44, got %q", got)
	}
}

func TestExpansionMarkets(t *testing.T) {
	cases := []struct{ raw, country, want string }{
		{"08012345678", "NG", "+2348012345678"},
		{"0712345678", "KE", "+254712345678"},
		{"0821234567", "ZA", "+27821234567"},
	}
	for _, c := range cases {
		got, err := Normalize(c.raw, c.country)
		if err != nil {
			t.Errorf("Normalize(%q, %s): %v", c.raw, c.country, err)
			continue
		}
		if got != c.want {
			t.Errorf("Normalize(%q, %s) = %q, want %q", c.raw, c.country, got, c.want)
		}
	}
}

// Without a country, a domestic number is ambiguous. Guessing would silently
// write wrong numbers, so it must be refused.
func TestDomesticNumberWithoutCountryIsRefused(t *testing.T) {
	if _, err := Normalize("0241234567", ""); !errors.Is(err, ErrUnknownFormat) {
		t.Fatalf("want ErrUnknownFormat, got %v", err)
	}
	if _, err := Normalize("0241234567", "XX"); !errors.Is(err, ErrUnknownFormat) {
		t.Fatalf("an unknown country must be refused, got %v", err)
	}
}

func TestRejectsUnusableInput(t *testing.T) {
	cases := []struct {
		raw, country string
		wantErr      error
	}{
		{"", "GH", ErrEmpty},
		{"   ", "GH", ErrEmpty},
		{"abc", "GH", ErrEmpty},
		{"024", "GH", ErrTooShort},
		{"+1234567890123456789", "GH", ErrTooLong},
	}
	for _, c := range cases {
		_, err := Normalize(c.raw, c.country)
		if !errors.Is(err, c.wantErr) {
			t.Errorf("Normalize(%q): want %v, got %v", c.raw, c.wantErr, err)
		}
	}
}

// Normalising an already-normalised number must be a no-op, so re-importing a
// previously-imported file does not corrupt records.
func TestNormalizeIsIdempotent(t *testing.T) {
	once, err := Normalize("024 123 4567", "GH")
	if err != nil {
		t.Fatalf("first pass: %v", err)
	}
	twice, err := Normalize(once, "GH")
	if err != nil {
		t.Fatalf("second pass: %v", err)
	}
	if once != twice {
		t.Errorf("not idempotent: %q then %q", once, twice)
	}
}

func TestIsE164(t *testing.T) {
	valid := []string{"+233241234567", "+14155552671", "+447700900123"}
	for _, s := range valid {
		if !IsE164(s) {
			t.Errorf("%q should be recognised as E.164", s)
		}
	}
	invalid := []string{"", "0241234567", "233241234567", "+233 241234567", "+abc"}
	for _, s := range invalid {
		if IsE164(s) {
			t.Errorf("%q should NOT be recognised as E.164", s)
		}
	}
}

// A number that differs only in formatting must produce the same key, which is
// what makes the unique index and dedupe work.
func TestDistinctNumbersStayDistinct(t *testing.T) {
	a := MustNormalize("0241234567", "GH")
	b := MustNormalize("0241234568", "GH")
	if a == b {
		t.Fatal("two genuinely different numbers must not collapse together")
	}
}
