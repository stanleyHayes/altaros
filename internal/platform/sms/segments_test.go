package sms

import "testing"

// The failure this package exists to prevent: a cost preview that is a
// division. One character outside GSM-7 turns a one-segment notice into three,
// and at 500 recipients that is a 3× bill for a punctuation mark nobody can see.

func TestGSM7SegmentBoundaries(t *testing.T) {
	cases := []struct {
		name     string
		body     string
		segments int
	}{
		{"empty", "", 0},
		{"short", "Service moves to 9am", 1},
		{"exactly one segment", repeat("a", 160), 1},
		{"one over", repeat("a", 161), 2},
		// Two segments hold 153 each, NOT 160 — the multipart header eats
		// seven septets. A naive /160 says 2 here and is wrong at 307.
		{"exactly two segments", repeat("a", 306), 2},
		{"one over two", repeat("a", 307), 3},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := Measure(c.body)
			if got.Segments != c.segments {
				t.Errorf("segments = %d, want %d", got.Segments, c.segments)
			}
			if got.Encoding != GSM7 {
				t.Errorf("encoding = %q, want GSM-7", got.Encoding)
			}
		})
	}
}

func TestExtendedGSMCharactersCostTwo(t *testing.T) {
	// € and the bracket characters are encoded as an escape plus the
	// character, so 80 of them fill a segment rather than 160.
	if got := Measure(repeat("€", 80)); got.Segments != 1 {
		t.Errorf("80 euro signs = %d segments, want 1", got.Segments)
	}
	if got := Measure(repeat("€", 81)); got.Segments != 2 {
		t.Errorf("81 euro signs = %d segments, want 2 — each costs two septets",
			got.Segments)
	}
}

func TestACurlyApostropheTriplesTheCost(t *testing.T) {
	// The headline case. Identical text, one character different.
	plain := "Dont forget the church picnic on Saturday. Bring a dish to share " +
		"and let us know if you need a lift. See you there."
	pasted := "Don’t forget the church picnic on Saturday. Bring a dish to share " +
		"and let us know if you need a lift. See you there."

	a, b := Measure(plain), Measure(pasted)
	if a.Segments != 1 {
		t.Fatalf("the plain version is %d segments; the fixture is wrong", a.Segments)
	}
	if b.Segments <= a.Segments {
		t.Fatalf("the pasted version is %d segments, same as plain — the "+
			"encoding switch was not detected", b.Segments)
	}
	if b.Encoding != UCS2 {
		t.Errorf("encoding = %q, want UCS-2", b.Encoding)
	}
	// Naming the character is the whole point: "this costs 3× because of a
	// character you cannot see" is unactionable.
	if b.ForcedUnicodeBy != "’" {
		t.Errorf("ForcedUnicodeBy = %q, want the curly apostrophe", b.ForcedUnicodeBy)
	}
	if b.Warning == "" {
		t.Error("no warning was produced for a message that costs 3×")
	}
	if !contains(b.Warning, "Word") {
		t.Errorf("the warning does not say where the character comes from: %q", b.Warning)
	}
}

func TestUCS2SegmentBoundaries(t *testing.T) {
	// "ç" is outside GSM-7 basic, so it forces UCS-2 at 70/67.
	if got := Measure(repeat("ç", 70)); got.Segments != 1 {
		t.Errorf("70 UCS-2 characters = %d segments, want 1", got.Segments)
	}
	if got := Measure(repeat("ç", 71)); got.Segments != 2 {
		t.Errorf("71 UCS-2 characters = %d segments, want 2", got.Segments)
	}
	if got := Measure(repeat("ç", 134)); got.Segments != 2 {
		t.Errorf("134 UCS-2 characters = %d segments, want 2 (67 each)", got.Segments)
	}
	if got := Measure(repeat("ç", 135)); got.Segments != 3 {
		t.Errorf("135 UCS-2 characters = %d segments, want 3", got.Segments)
	}
}

func TestAnEmojiCountsAsTwo(t *testing.T) {
	// Emoji are outside the Basic Multilingual Plane, so they occupy two
	// UTF-16 code units each. 35 of them fill a segment, not 70.
	if got := Measure(repeat("🙏", 35)); got.Segments != 1 {
		t.Errorf("35 emoji = %d segments, want 1", got.Segments)
	}
	if got := Measure(repeat("🙏", 36)); got.Segments != 2 {
		t.Errorf("36 emoji = %d segments, want 2 — each is two UTF-16 units",
			got.Segments)
	}
}

func TestRemainingTellsYouHowMuchToTrim(t *testing.T) {
	// So somebody can cut four words instead of paying for a whole extra
	// segment across the congregation.
	got := Measure(repeat("a", 150))
	if got.Remaining != 10 {
		t.Errorf("remaining = %d, want 10", got.Remaining)
	}
	over := Measure(repeat("a", 161))
	if over.Remaining != 2*gsm7Multipart-161 {
		t.Errorf("remaining = %d, want the headroom in two segments", over.Remaining)
	}
}

func TestPlainOffersTheFixWithoutApplyingIt(t *testing.T) {
	// Silently rewriting somebody's message is worse than charging them for
	// it, so this is a suggestion a composer can offer behind a button.
	pasted := "Don’t miss it — bring “a dish”…"
	fixed := Plain(pasted)

	if Measure(fixed).Encoding != GSM7 {
		t.Errorf("Plain(%q) = %q, still not GSM-7", pasted, fixed)
	}
	if Measure(pasted).Encoding != UCS2 {
		t.Error("Plain modified the original; it must return a copy")
	}
}

func TestCharacterCountIsRunesNotBytes(t *testing.T) {
	// A church administrator counts characters, not bytes. "Kwabena Ofosu-Ansah"
	// is not longer because of an accent somewhere else in the message.
	if got := Measure("Kofi ç"); got.Characters != 6 {
		t.Errorf("characters = %d, want 6", got.Characters)
	}
}

func repeat(s string, n int) string {
	out := make([]byte, 0, len(s)*n)
	for i := 0; i < n; i++ {
		out = append(out, s...)
	}
	return string(out)
}

func contains(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
