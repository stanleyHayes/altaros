// Package money represents amounts as integer minor units.
//
// ADR-005 removed DECIMAL(19,4) when the datastore moved to MongoDB, and BSON
// has no decimal-by-default: an amount stored as a BSON double is IEEE-754 and
// will lose cents. GHS 0.10 is not representable in binary floating point, so
// a hundred ten-pesewa offerings do not add up to GHS 10.00.
//
// Every amount in the system is therefore an int64 count of the currency's
// smallest unit — pesewas for GHS, kobo for NGN, cents for USD — paired with
// its currency code. This is also the unit Paystack's API speaks, so no
// conversion happens at the boundary where conversion errors are most costly.
package money

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

var (
	// ErrCurrencyMismatch means two amounts in different currencies were
	// combined. GHS 10 plus NGN 10 is not a number.
	ErrCurrencyMismatch = errors.New("money: currencies do not match")
	// ErrUnknownCurrency means the currency code is not supported.
	ErrUnknownCurrency = errors.New("money: unsupported currency")
	// ErrNegative means an operation produced a negative amount where one is
	// not meaningful.
	ErrNegative = errors.New("money: amount cannot be negative")
	// ErrMalformed means a string could not be parsed as an amount.
	ErrMalformed = errors.New("money: malformed amount")
)

// exponents maps a currency to its number of decimal places. Currencies with
// no minor unit (JPY, and several African currencies) have exponent 0, so
// assuming "×100 everywhere" is wrong even before leaving the launch region.
var exponents = map[string]int{
	"GHS": 2, // pesewa
	"NGN": 2, // kobo
	"KES": 2, // cent
	"ZAR": 2, // cent
	"USD": 2,
	"GBP": 2,
	"EUR": 2,
	"UGX": 0, // no minor unit in practice
	"RWF": 0,
}

// Exponent returns the number of decimal places for a currency.
func Exponent(currency string) (int, error) {
	e, ok := exponents[normalizeCurrency(currency)]
	if !ok {
		return 0, fmt.Errorf("%w: %q", ErrUnknownCurrency, currency)
	}
	return e, nil
}

func normalizeCurrency(c string) string {
	return strings.ToUpper(strings.TrimSpace(c))
}

// Amount is a quantity of money: minor units plus the currency they are in.
//
// The zero Amount has no currency and is only valid as "nothing yet"; use
// Zero(currency) for a real zero balance.
type Amount struct {
	// Minor is the count of the currency's smallest unit. GHS 12.34 is 1234.
	Minor int64 `bson:"minor" json:"minor"`
	// Currency is the ISO-4217 code.
	Currency string `bson:"currency" json:"currency"`
}

// New builds an Amount from minor units.
func New(minor int64, currency string) (Amount, error) {
	c := normalizeCurrency(currency)
	if _, ok := exponents[c]; !ok {
		return Amount{}, fmt.Errorf("%w: %q", ErrUnknownCurrency, currency)
	}
	return Amount{Minor: minor, Currency: c}, nil
}

// MustNew is for tests and constants; it panics on an unsupported currency.
func MustNew(minor int64, currency string) Amount {
	a, err := New(minor, currency)
	if err != nil {
		panic(err.Error())
	}
	return a
}

// Zero returns a zero balance in a currency.
func Zero(currency string) Amount {
	return Amount{Minor: 0, Currency: normalizeCurrency(currency)}
}

// IsZero reports whether the amount is nil.
func (a Amount) IsZero() bool { return a.Minor == 0 }

// IsNegative reports whether the amount is below zero.
func (a Amount) IsNegative() bool { return a.Minor < 0 }

// Add returns a + b, refusing to mix currencies.
func (a Amount) Add(b Amount) (Amount, error) {
	if err := a.sameCurrency(b); err != nil {
		return Amount{}, err
	}
	return Amount{Minor: a.Minor + b.Minor, Currency: a.Currency}, nil
}

// Sub returns a - b, refusing to mix currencies.
func (a Amount) Sub(b Amount) (Amount, error) {
	if err := a.sameCurrency(b); err != nil {
		return Amount{}, err
	}
	return Amount{Minor: a.Minor - b.Minor, Currency: a.Currency}, nil
}

func (a Amount) sameCurrency(b Amount) error {
	if a.Currency != b.Currency {
		return fmt.Errorf("%w: %s and %s", ErrCurrencyMismatch, a.Currency, b.Currency)
	}
	return nil
}

// Compare returns -1, 0 or 1. It refuses to compare across currencies.
func (a Amount) Compare(b Amount) (int, error) {
	if err := a.sameCurrency(b); err != nil {
		return 0, err
	}
	switch {
	case a.Minor < b.Minor:
		return -1, nil
	case a.Minor > b.Minor:
		return 1, nil
	default:
		return 0, nil
	}
}

// PercentBasisPoints returns bps/10000 of the amount, rounded half-up.
//
// Basis points rather than a float percentage: a 1.5% platform commission is
// 150 bps exactly, whereas 0.015 as a float64 is not 0.015. The rounding is
// half-up because that is what payment providers do, and a split that rounds
// differently from the provider reconciles a pesewa short on every
// transaction — which is a support ticket per giver, forever.
func (a Amount) PercentBasisPoints(bps int64) Amount {
	if bps == 0 || a.Minor == 0 {
		return Zero(a.Currency)
	}
	negative := a.Minor < 0
	minor := a.Minor
	if negative {
		minor = -minor
	}
	// +5000 before dividing by 10000 is half-up rounding in integer maths.
	result := (minor*bps + 5000) / 10000
	if negative {
		result = -result
	}
	return Amount{Minor: result, Currency: a.Currency}
}

// String renders the amount for display, e.g. "GHS 12.34".
func (a Amount) String() string {
	return a.Currency + " " + a.Decimal()
}

// Decimal renders just the number, e.g. "12.34".
func (a Amount) Decimal() string {
	exp, ok := exponents[a.Currency]
	if !ok || exp == 0 {
		return strconv.FormatInt(a.Minor, 10)
	}

	negative := a.Minor < 0
	minor := a.Minor
	if negative {
		minor = -minor
	}

	divisor := int64(1)
	for i := 0; i < exp; i++ {
		divisor *= 10
	}

	whole := minor / divisor
	frac := minor % divisor

	var b strings.Builder
	if negative {
		b.WriteByte('-')
	}
	b.WriteString(strconv.FormatInt(whole, 10))
	b.WriteByte('.')
	fracStr := strconv.FormatInt(frac, 10)
	for i := len(fracStr); i < exp; i++ {
		b.WriteByte('0')
	}
	b.WriteString(fracStr)
	return b.String()
}

// Parse reads a human-written amount ("12.34", "12", "1,200.50") into minor
// units for the given currency.
//
// This exists for CSV imports and admin entry of cash offerings. It never goes
// through float64 — parsing "0.10" as a float and multiplying by 100 yields
// 10.000000000000002, which truncates to 9 pesewas.
func Parse(s, currency string) (Amount, error) {
	exp, err := Exponent(currency)
	if err != nil {
		return Amount{}, err
	}

	raw := strings.TrimSpace(s)
	if raw == "" {
		return Amount{}, fmt.Errorf("%w: empty", ErrMalformed)
	}
	raw = strings.ReplaceAll(raw, ",", "")
	raw = strings.ReplaceAll(raw, " ", "")

	negative := false
	switch raw[0] {
	case '-':
		negative, raw = true, raw[1:]
	case '+':
		raw = raw[1:]
	}
	if raw == "" {
		return Amount{}, fmt.Errorf("%w: %q", ErrMalformed, s)
	}

	wholeStr, fracStr, hasFrac := strings.Cut(raw, ".")
	if wholeStr == "" {
		wholeStr = "0"
	}
	if hasFrac && len(fracStr) > exp {
		// Refuse rather than silently truncate: "GHS 10.999" is either a typo
		// or a different currency's precision, and quietly recording 10.99
		// hides which.
		return Amount{}, fmt.Errorf("%w: %q has more than %d decimal places for %s",
			ErrMalformed, s, exp, normalizeCurrency(currency))
	}

	whole, err := strconv.ParseInt(wholeStr, 10, 64)
	if err != nil {
		return Amount{}, fmt.Errorf("%w: %q", ErrMalformed, s)
	}

	divisor := int64(1)
	for i := 0; i < exp; i++ {
		divisor *= 10
	}

	var frac int64
	if hasFrac && fracStr != "" {
		padded := fracStr + strings.Repeat("0", exp-len(fracStr))
		frac, err = strconv.ParseInt(padded, 10, 64)
		if err != nil {
			return Amount{}, fmt.Errorf("%w: %q", ErrMalformed, s)
		}
	}

	minor := whole*divisor + frac
	if negative {
		minor = -minor
	}
	return Amount{Minor: minor, Currency: normalizeCurrency(currency)}, nil
}
