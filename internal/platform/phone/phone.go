// Package phone normalises phone numbers to E.164.
//
// This is load-bearing rather than cosmetic. In Ghana the same number is
// written every one of these ways, often within one congregation's records:
//
//	024 123 4567      0241234567       24 123 4567
//	+233 24 123 4567  233241234567     +233-24-123-4567
//
// Stored verbatim, those are six different members. Deduplication fails, the
// unique index does nothing, and OTP delivery fails for whichever spellings
// the SMS gateway rejects — which for a phone-first login is the whole product.
//
// Normalisation happens at the boundary; client formatting is never trusted.
package phone

import (
	"errors"
	"fmt"
	"strings"
)

var (
	// ErrEmpty means no digits were supplied.
	ErrEmpty = errors.New("phone: number is empty")
	// ErrTooShort means the number cannot be a real subscriber number.
	ErrTooShort = errors.New("phone: too short to be a valid number")
	// ErrTooLong means the number exceeds the E.164 maximum of 15 digits.
	ErrTooLong = errors.New("phone: longer than the E.164 maximum of 15 digits")
	// ErrUnknownFormat means the number could not be resolved to a country.
	ErrUnknownFormat = errors.New("phone: cannot determine country; supply the number in international format")
)

// Country describes the dialling rules for a launch market.
type Country struct {
	ISO string
	// CallingCode without the plus, e.g. "233".
	CallingCode string
	// NationalLength is the digit count after the trunk prefix is removed
	// (Ghana: 241234567 -> 9).
	NationalLength int
	// TrunkPrefix is the leading digit used domestically, "0" across these
	// markets.
	TrunkPrefix string
}

// countries covers the launch market and the expansion markets named in the
// plan. Adding a country is a data change, not a code change.
var countries = map[string]Country{
	"GH": {ISO: "GH", CallingCode: "233", NationalLength: 9, TrunkPrefix: "0"},
	"NG": {ISO: "NG", CallingCode: "234", NationalLength: 10, TrunkPrefix: "0"},
	"KE": {ISO: "KE", CallingCode: "254", NationalLength: 9, TrunkPrefix: "0"},
	"ZA": {ISO: "ZA", CallingCode: "27", NationalLength: 9, TrunkPrefix: "0"},
	"UK": {ISO: "UK", CallingCode: "44", NationalLength: 10, TrunkPrefix: "0"},
	"US": {ISO: "US", CallingCode: "1", NationalLength: 10, TrunkPrefix: "1"},
}

// SupportedCountries lists the ISO codes this package can normalise.
func SupportedCountries() []string {
	out := make([]string, 0, len(countries))
	for iso := range countries {
		out = append(out, iso)
	}
	return out
}

// Normalize converts a number to E.164 (+<calling code><national number>).
//
// defaultCountry is the ISO code of the church's country and is used only when
// the number is written domestically. An explicit + always wins, so a member
// with a foreign number is never rewritten into the local country.
func Normalize(raw, defaultCountry string) (string, error) {
	digits, hadPlus := extractDigits(raw)
	if digits == "" {
		return "", ErrEmpty
	}
	if len(digits) > 15 {
		return "", ErrTooLong
	}

	// International form: trust it, whoever wrote it meant it.
	if hadPlus {
		if len(digits) < 8 {
			return "", ErrTooShort
		}
		return "+" + digits, nil
	}

	country, known := countries[strings.ToUpper(strings.TrimSpace(defaultCountry))]
	if !known {
		// Without a country there is no way to tell 0241234567 in Ghana from
		// the same digits elsewhere. Guessing would silently corrupt records.
		return "", ErrUnknownFormat
	}

	// Already carries the calling code, just without the plus.
	if strings.HasPrefix(digits, country.CallingCode) {
		national := digits[len(country.CallingCode):]
		if len(national) == country.NationalLength {
			return "+" + country.CallingCode + national, nil
		}
	}

	// Domestic trunk form: 0241234567.
	if country.TrunkPrefix != "" && strings.HasPrefix(digits, country.TrunkPrefix) {
		national := digits[len(country.TrunkPrefix):]
		if len(national) == country.NationalLength {
			return "+" + country.CallingCode + national, nil
		}
	}

	// Bare national number: 241234567.
	if len(digits) == country.NationalLength {
		return "+" + country.CallingCode + digits, nil
	}

	if len(digits) < country.NationalLength {
		return "", ErrTooShort
	}
	return "", fmt.Errorf("%w: %q is not a valid %s number", ErrUnknownFormat, raw, country.ISO)
}

// MustNormalize is for tests and fixtures; it panics on invalid input.
func MustNormalize(raw, defaultCountry string) string {
	n, err := Normalize(raw, defaultCountry)
	if err != nil {
		panic(fmt.Sprintf("phone: %q (%s): %v", raw, defaultCountry, err))
	}
	return n
}

// IsE164 reports whether a string is already normalised.
func IsE164(s string) bool {
	if len(s) < 8 || len(s) > 16 || !strings.HasPrefix(s, "+") {
		return false
	}
	for _, r := range s[1:] {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// extractDigits strips formatting and reports whether the number was written
// in international form.
//
// A leading 00 is the other international prefix (00233... is +233...), and is
// treated the same as a plus.
func extractDigits(raw string) (digits string, hadPlus bool) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", false
	}

	if strings.HasPrefix(s, "+") {
		hadPlus = true
		s = s[1:]
	} else if strings.HasPrefix(s, "00") {
		hadPlus = true
		s = s[2:]
	}

	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String(), hadPlus
}
