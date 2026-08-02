// Package sms answers the one question a church actually asks before pressing
// send: how much will this cost?
//
// SMS is billed per SEGMENT, not per message, and the segment count is not
// length/160. It depends on which alphabet the text fits in:
//
//	GSM-7   160 characters in one segment, 153 each when split
//	UCS-2    70 characters in one segment,  67 each when split
//
// The consequence is the thing nobody expects and everybody hits: ONE character
// outside GSM-7 — a curly apostrophe pasted from Word, an emoji, an accented
// name — moves the whole message to UCS-2 and can turn a one-segment notice
// into three. At 500 recipients that is a 3× bill for a punctuation mark, and
// the church finds out on an invoice.
//
// So this package exists to say it BEFORE send, and to say which character did
// it. A cost preview that is merely a division is worse than none: it is
// confidently wrong in the direction that costs money.
package sms

import (
	"strings"
	"unicode/utf8"
)

// Encoding is the alphabet a message will be sent in.
type Encoding string

const (
	// GSM7 is the default 7-bit alphabet: 160 characters per segment.
	GSM7 Encoding = "GSM-7"
	// UCS2 is UTF-16: 70 characters per segment. Any character outside GSM-7
	// forces the whole message into it.
	UCS2 Encoding = "UCS-2"
)

// Segment sizes, from GSM 03.38 / 23.038.
const (
	gsm7Single    = 160
	gsm7Multipart = 153
	ucs2Single    = 70
	ucs2Multipart = 67
)

// gsm7Basic is the GSM 03.38 basic character set.
//
// Written out rather than computed, because it is a fixed historical table with
// no pattern to it — the alternative is a range check that is subtly wrong for
// the handful of Greek capitals and currency symbols in the middle of it.
const gsm7Basic = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
	"¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"

// gsm7Extended characters cost TWO septets each, because they are encoded as an
// escape followed by the character. A message of 80 euro signs is 160 septets,
// not 80 — which is exactly the boundary case a naive count gets wrong.
const gsm7Extended = "^{}\\[~]|€"

var (
	gsm7BasicSet    = runeSet(gsm7Basic)
	gsm7ExtendedSet = runeSet(gsm7Extended)
)

func runeSet(s string) map[rune]bool {
	out := make(map[rune]bool, len(s))
	for _, r := range s {
		out[r] = true
	}
	return out
}

// Estimate is what a message will cost to send to one recipient.
type Estimate struct {
	// Encoding is the alphabet the message will be sent in.
	Encoding Encoding `json:"encoding"`
	// Characters is the count a person would recognise — runes, not bytes.
	Characters int `json:"characters"`
	// Segments is what the provider bills.
	Segments int `json:"segments"`
	// Remaining is how many more characters fit before another segment is
	// added. Shown in the composer so somebody can trim four words instead of
	// paying for a whole extra segment across the congregation.
	Remaining int `json:"remaining"`
	// ForcedUnicodeBy is the first character that pushed the message out of
	// GSM-7, empty when it stayed in it.
	//
	// The specific character, not a boolean: "this message costs 3× because of
	// a character you cannot see" is unactionable, and the offender is almost
	// always a curly apostrophe or a non-breaking space pasted from a document.
	ForcedUnicodeBy string `json:"forcedUnicodeBy,omitempty"`
	// Warning is the sentence to show beside the composer. Empty when there is
	// nothing worth saying.
	Warning string `json:"warning,omitempty"`
}

// Measure works out the encoding, segment count and headroom of a message.
func Measure(body string) Estimate {
	units, offender := septets(body)
	characters := utf8.RuneCountInString(body)

	if offender == "" {
		return finish(Estimate{
			Encoding:   GSM7,
			Characters: characters,
		}, units, gsm7Single, gsm7Multipart)
	}

	// UCS-2 is billed in UTF-16 code units, so a character outside the Basic
	// Multilingual Plane — every emoji — counts as TWO. A 35-emoji message is
	// two segments, not one.
	units = 0
	for _, r := range body {
		if r > 0xFFFF {
			units += 2
		} else {
			units++
		}
	}

	est := finish(Estimate{
		Encoding:        UCS2,
		Characters:      characters,
		ForcedUnicodeBy: offender,
	}, units, ucs2Single, ucs2Multipart)

	est.Warning = "This message contains " + describe(offender) +
		", which more than halves how much fits in each SMS. Replacing it " +
		"would reduce the cost."
	return est
}

// finish computes segments and headroom for a given size table.
func finish(est Estimate, units, single, multipart int) Estimate {
	switch {
	case units == 0:
		est.Segments = 0
		est.Remaining = single
	case units <= single:
		est.Segments = 1
		est.Remaining = single - units
	default:
		est.Segments = (units + multipart - 1) / multipart
		est.Remaining = est.Segments*multipart - units
	}
	return est
}

// septets counts a message in GSM-7 units, and names the first character that
// makes that impossible.
func septets(body string) (int, string) {
	total := 0
	for _, r := range body {
		switch {
		case gsm7BasicSet[r]:
			total++
		case gsm7ExtendedSet[r]:
			// Escape plus character.
			total += 2
		default:
			return 0, string(r)
		}
	}
	return total, ""
}

// describe names a character in words somebody can act on.
//
// "U+2019" is precise and useless to a church administrator. The names below
// cover what actually appears: text pasted out of Word, and emoji.
func describe(offender string) string {
	named := map[string]string{
		"’":  "a curly apostrophe (’), usually pasted from Word",
		"‘":  "a curly quote (‘), usually pasted from Word",
		"“":  "a curly quote (“), usually pasted from Word",
		"”":  "a curly quote (”), usually pasted from Word",
		"–":  "an en dash (–), usually pasted from Word",
		"—":  "an em dash (—), usually pasted from Word",
		"…":  "an ellipsis character (…) rather than three full stops",
		" ":  "a non-breaking space, which looks identical to a normal one",
		"\t": "a tab character",
	}
	if name, ok := named[offender]; ok {
		return name
	}
	if r, _ := utf8.DecodeRuneInString(offender); r > 0x2100 {
		return "an emoji or symbol (" + offender + ")"
	}
	return "the character " + offender
}

// Plain converts the common paste-from-a-document characters to their GSM-7
// equivalents.
//
// Offered rather than applied: silently rewriting somebody's message is worse
// than charging them for it. A composer can call this behind a "fix this"
// button, which is the version where the person stays in control of their own
// words.
func Plain(body string) string {
	return strings.NewReplacer(
		"’", "'", "‘", "'",
		"“", `"`, "”", `"`,
		"–", "-", "—", "-",
		"…", "...",
		" ", " ",
		"\t", " ",
	).Replace(body)
}
