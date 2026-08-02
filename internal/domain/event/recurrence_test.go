package event

import (
	"testing"
	"time"
)

func mustParse(t *testing.T, rule string) *Recurrence {
	t.Helper()
	parsed, err := ParseRecurrence(rule)
	if err != nil {
		t.Fatalf("ParseRecurrence(%q): %v", rule, err)
	}
	return parsed
}

func at(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatalf("bad test timestamp %q: %v", value, err)
	}
	return parsed.UTC()
}

func dates(times []time.Time) []string {
	out := make([]string, 0, len(times))
	for _, at := range times {
		out = append(out, at.Format("2006-01-02T15:04"))
	}
	return out
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestWeeklyServiceExpandsToRealSundays(t *testing.T) {
	// The case the whole feature exists for: a Sunday service that started
	// years ago must still answer "when is the next one".
	start := at(t, "2019-01-06T09:00:00Z") // a Sunday
	rule := mustParse(t, "FREQ=WEEKLY")

	from := at(t, "2026-08-01T00:00:00Z")
	got := dates(rule.Occurrences(start, from, from.AddDate(0, 1, 0), 3))

	want := []string{"2026-08-02T09:00", "2026-08-09T09:00", "2026-08-16T09:00"}
	if !equal(got, want) {
		t.Fatalf("weekly service:\n got %v\nwant %v", got, want)
	}
}

func TestSeriesStartIsItsOwnFirstOccurrence(t *testing.T) {
	// RFC 5545: DTSTART is occurrence one, and a rule never moves it. This is
	// why "every Sunday" needs no BYDAY.
	start := at(t, "2026-08-05T18:30:00Z")
	rule := mustParse(t, "FREQ=WEEKLY")

	got := dates(rule.Occurrences(start, start, start.AddDate(0, 0, 8), 5))
	want := []string{"2026-08-05T18:30", "2026-08-12T18:30"}
	if !equal(got, want) {
		t.Fatalf("series start:\n got %v\nwant %v", got, want)
	}
}

func TestByDayProducesEveryNamedWeekday(t *testing.T) {
	// A midweek service on Tuesdays and Thursdays.
	start := at(t, "2026-08-04T19:00:00Z") // Tuesday
	rule := mustParse(t, "FREQ=WEEKLY;BYDAY=TU,TH")

	got := dates(rule.Occurrences(start, start, start.AddDate(0, 0, 15), 5))
	want := []string{
		"2026-08-04T19:00", "2026-08-06T19:00",
		"2026-08-11T19:00", "2026-08-13T19:00",
		"2026-08-18T19:00",
	}
	if !equal(got, want) {
		t.Fatalf("BYDAY:\n got %v\nwant %v", got, want)
	}
}

func TestFortnightlyByDaySkipsAWholeWeek(t *testing.T) {
	start := at(t, "2026-08-04T19:00:00Z") // Tuesday
	rule := mustParse(t, "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU")

	got := dates(rule.Occurrences(start, start, start.AddDate(0, 2, 0), 3))
	want := []string{"2026-08-04T19:00", "2026-08-18T19:00", "2026-09-01T19:00"}
	if !equal(got, want) {
		t.Fatalf("fortnightly:\n got %v\nwant %v", got, want)
	}
}

func TestMonthlyOnThe31stSkipsShortMonths(t *testing.T) {
	// The trap this implementation exists to avoid. Go's AddDate normalises
	// 31 January + 1 month to 3 March, which would turn "the 31st of every
	// month" into a series landing on the 3rd, the 31st, the 1st. RFC 5545
	// says a month without the day simply has no occurrence.
	start := at(t, "2026-01-31T10:00:00Z")
	rule := mustParse(t, "FREQ=MONTHLY")

	got := dates(rule.Occurrences(start, start, at(t, "2026-06-01T00:00:00Z"), 10))
	want := []string{
		"2026-01-31T10:00", // January
		"2026-03-31T10:00", // February skipped
		"2026-05-31T10:00", // April skipped
	}
	if !equal(got, want) {
		t.Fatalf("monthly on the 31st:\n got %v\nwant %v", got, want)
	}
}

func TestMonthlyReturnsToTheAnchorDay(t *testing.T) {
	// A series anchored on the 31st must come BACK to the 31st, not drift to
	// whatever the previous month could hold.
	start := at(t, "2026-01-31T10:00:00Z")
	rule := mustParse(t, "FREQ=MONTHLY")

	got := rule.Occurrences(start, start, at(t, "2027-01-01T00:00:00Z"), 20)
	for _, occurrence := range got {
		if occurrence.Day() != 31 {
			t.Fatalf("occurrence %s is not on the 31st", occurrence.Format(time.RFC3339))
		}
	}
}

func TestCountBoundsTheSeries(t *testing.T) {
	start := at(t, "2026-08-05T09:00:00Z")
	rule := mustParse(t, "FREQ=DAILY;COUNT=3")

	got := dates(rule.Occurrences(start, start, start.AddDate(1, 0, 0), 10))
	want := []string{"2026-08-05T09:00", "2026-08-06T09:00", "2026-08-07T09:00"}
	if !equal(got, want) {
		t.Fatalf("COUNT:\n got %v\nwant %v", got, want)
	}
}

func TestCountIsConsumedByOccurrencesBeforeTheWindow(t *testing.T) {
	// A four-week series that finished last month must produce NOTHING now.
	// Counting only what falls inside the window would restart the series
	// every time somebody opened the calendar.
	start := at(t, "2026-06-07T09:00:00Z")
	rule := mustParse(t, "FREQ=WEEKLY;COUNT=4")

	from := at(t, "2026-08-01T00:00:00Z")
	if got := rule.Occurrences(start, from, from.AddDate(1, 0, 0), 10); len(got) != 0 {
		t.Fatalf("a finished series produced %v", dates(got))
	}
}

func TestUntilBoundsTheSeries(t *testing.T) {
	start := at(t, "2026-08-05T09:00:00Z")
	rule := mustParse(t, "FREQ=DAILY;UNTIL=20260807T090000Z")

	got := dates(rule.Occurrences(start, start, start.AddDate(1, 0, 0), 10))
	want := []string{"2026-08-05T09:00", "2026-08-06T09:00", "2026-08-07T09:00"}
	if !equal(got, want) {
		t.Fatalf("UNTIL:\n got %v\nwant %v", got, want)
	}
}

func TestUnsupportedRulePartsAreRejectedRatherThanIgnored(t *testing.T) {
	// The failure mode this guards against is the quiet one: a rule that
	// parses, produces the wrong dates, and reports nothing. A church would
	// find out from an empty hall.
	for _, rule := range []string{
		"FREQ=WEEKLY;BYSETPOS=-1",
		"FREQ=MONTHLY;BYMONTHDAY=15",
		"FREQ=YEARLY",
		"FREQ=WEEKLY;BYDAY=FUNDAY",
		"FREQ=MONTHLY;BYDAY=SU", // BYDAY only makes sense weekly here
		"INTERVAL=2",            // no FREQ
		"FREQ=DAILY;INTERVAL=0",
		"FREQ=DAILY;COUNT=3;UNTIL=20260807T090000Z",
		"",
	} {
		if _, err := ParseRecurrence(rule); err == nil {
			t.Errorf("ParseRecurrence(%q) was accepted; it should be refused", rule)
		}
	}
}

func TestRulesRoundTripThroughCanonicalForm(t *testing.T) {
	// What is stored must re-parse to the same thing, or an edit that changes
	// nothing shows up as a change.
	for input, want := range map[string]string{
		"FREQ=WEEKLY":                     "FREQ=WEEKLY",
		"rrule:freq=weekly;byday=th,tu":   "FREQ=WEEKLY;BYDAY=TU,TH",
		"FREQ=DAILY;INTERVAL=1":           "FREQ=DAILY",
		"FREQ=MONTHLY;INTERVAL=3;COUNT=4": "FREQ=MONTHLY;INTERVAL=3;COUNT=4",
	} {
		got := mustParse(t, input).String()
		if got != want {
			t.Errorf("canonical form of %q = %q, want %q", input, got, want)
		}
		if again := mustParse(t, got).String(); again != want {
			t.Errorf("round trip of %q drifted to %q", got, again)
		}
	}
}

func TestOccurrencesTerminateWhenNothingMatches(t *testing.T) {
	// A monthly-on-the-31st series queried across February alone has no
	// answer. The loop looking for one has to stop.
	start := at(t, "2026-01-31T10:00:00Z")
	rule := mustParse(t, "FREQ=MONTHLY")

	done := make(chan []time.Time, 1)
	go func() {
		done <- rule.Occurrences(start,
			at(t, "2026-02-01T00:00:00Z"), at(t, "2026-03-01T00:00:00Z"), 5)
	}()
	select {
	case got := <-done:
		if len(got) != 0 {
			t.Fatalf("February produced %v", dates(got))
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Occurrences did not terminate")
	}
}
