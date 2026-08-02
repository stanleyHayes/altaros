package event

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// A recurring event is stored as ONE document plus a rule, never as expanded
// rows. Sunday service has run every week since the church was founded and will
// run every week after; materialising that is unbounded, and every correction
// to the pattern ("we moved to 9am") becomes a bulk update over history rather
// than an edit to one field.
//
// The cost of that choice is this file: occurrences have to be computed on
// read. The subset below is deliberately small — the four things a church
// actually schedules — and anything outside it is REJECTED at creation rather
// than silently ignored. A rule that parses but does nothing is the worst
// outcome available: the event exists, the calendar is empty, and nothing
// reports an error.

// ErrRecurrenceInvalid means a recurrence rule could not be understood.
type ErrRecurrenceInvalid struct {
	Rule   string
	Reason string
}

func (e *ErrRecurrenceInvalid) Error() string {
	return fmt.Sprintf("event: recurrence %q: %s", e.Rule, e.Reason)
}

// Frequency is how often an event repeats.
type Frequency string

const (
	FreqDaily   Frequency = "DAILY"
	FreqWeekly  Frequency = "WEEKLY"
	FreqMonthly Frequency = "MONTHLY"
)

// Recurrence is the supported subset of an RFC 5545 RRULE.
type Recurrence struct {
	Freq     Frequency
	Interval int
	// ByDay restricts a WEEKLY rule to particular weekdays. Empty means the
	// weekday of the event's own start.
	ByDay []time.Weekday
	// Count bounds the series by number of occurrences. Zero means unbounded.
	Count int
	// Until bounds the series by date. Zero means unbounded.
	Until time.Time
}

// weekdayCodes maps the two-letter RFC 5545 codes.
var weekdayCodes = map[string]time.Weekday{
	"SU": time.Sunday, "MO": time.Monday, "TU": time.Tuesday,
	"WE": time.Wednesday, "TH": time.Thursday, "FR": time.Friday,
	"SA": time.Saturday,
}

// ParseRecurrence reads an RRULE.
//
// Accepts the "RRULE:" prefix because that is what a calendar export contains
// and what somebody will paste.
func ParseRecurrence(rule string) (*Recurrence, error) {
	raw := strings.TrimSpace(rule)
	raw = strings.TrimPrefix(strings.ToUpper(raw), "RRULE:")
	if raw == "" {
		return nil, &ErrRecurrenceInvalid{Rule: rule, Reason: "empty"}
	}

	out := &Recurrence{Interval: 1}
	for _, part := range strings.Split(raw, ";") {
		if strings.TrimSpace(part) == "" {
			continue
		}
		key, value, ok := strings.Cut(part, "=")
		if !ok {
			return nil, &ErrRecurrenceInvalid{Rule: rule, Reason: "expected NAME=VALUE in " + part}
		}
		key, value = strings.TrimSpace(key), strings.TrimSpace(value)

		switch key {
		case "FREQ":
			switch Frequency(value) {
			case FreqDaily, FreqWeekly, FreqMonthly:
				out.Freq = Frequency(value)
			default:
				return nil, &ErrRecurrenceInvalid{Rule: rule,
					Reason: "FREQ must be DAILY, WEEKLY or MONTHLY (got " + value + ")"}
			}

		case "INTERVAL":
			n, err := strconv.Atoi(value)
			if err != nil || n < 1 {
				return nil, &ErrRecurrenceInvalid{Rule: rule, Reason: "INTERVAL must be a positive number"}
			}
			out.Interval = n

		case "COUNT":
			n, err := strconv.Atoi(value)
			if err != nil || n < 1 {
				return nil, &ErrRecurrenceInvalid{Rule: rule, Reason: "COUNT must be a positive number"}
			}
			out.Count = n

		case "UNTIL":
			until, err := parseUntil(value)
			if err != nil {
				return nil, &ErrRecurrenceInvalid{Rule: rule, Reason: err.Error()}
			}
			out.Until = until

		case "BYDAY":
			for _, code := range strings.Split(value, ",") {
				day, known := weekdayCodes[strings.TrimSpace(code)]
				if !known {
					return nil, &ErrRecurrenceInvalid{Rule: rule,
						Reason: "BYDAY has an unrecognised day: " + code}
				}
				out.ByDay = append(out.ByDay, day)
			}

		default:
			// Rejected rather than skipped. BYMONTHDAY, BYSETPOS and the rest
			// change which dates a rule produces; ignoring one would give a
			// church a calendar that is confidently wrong.
			return nil, &ErrRecurrenceInvalid{Rule: rule,
				Reason: key + " is not supported yet"}
		}
	}

	if out.Freq == "" {
		return nil, &ErrRecurrenceInvalid{Rule: rule, Reason: "FREQ is required"}
	}
	if len(out.ByDay) > 0 && out.Freq != FreqWeekly {
		return nil, &ErrRecurrenceInvalid{Rule: rule,
			Reason: "BYDAY is only supported with FREQ=WEEKLY"}
	}
	if out.Count > 0 && !out.Until.IsZero() {
		return nil, &ErrRecurrenceInvalid{Rule: rule,
			Reason: "COUNT and UNTIL cannot both be set"}
	}
	return out, nil
}

// parseUntil reads the two UNTIL forms RFC 5545 allows.
func parseUntil(value string) (time.Time, error) {
	for _, layout := range []string{"20060102T150405Z", "20060102T150405", "20060102"} {
		if t, err := time.Parse(layout, value); err == nil {
			return t.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("UNTIL must look like 20260315T090000Z (got %s)", value)
}

// String renders the rule back to RRULE form, so what is stored round-trips.
func (r *Recurrence) String() string {
	parts := []string{"FREQ=" + string(r.Freq)}
	if r.Interval > 1 {
		parts = append(parts, "INTERVAL="+strconv.Itoa(r.Interval))
	}
	if len(r.ByDay) > 0 {
		// Rendered in weekday order rather than map order, so what is stored is
		// stable — an unstable one shows up as a spurious diff on every save.
		parts = append(parts, "BYDAY="+strings.Join(sortByWeekday(r.ByDay), ","))
	}
	if r.Count > 0 {
		parts = append(parts, "COUNT="+strconv.Itoa(r.Count))
	}
	if !r.Until.IsZero() {
		parts = append(parts, "UNTIL="+r.Until.UTC().Format("20060102T150405Z"))
	}
	return strings.Join(parts, ";")
}

// sortByWeekday renders weekdays as codes in Sunday-first order.
func sortByWeekday(days []time.Weekday) []string {
	seen := map[time.Weekday]bool{}
	for _, day := range days {
		seen[day] = true
	}
	order := []struct {
		day  time.Weekday
		code string
	}{
		{time.Sunday, "SU"}, {time.Monday, "MO"}, {time.Tuesday, "TU"},
		{time.Wednesday, "WE"}, {time.Thursday, "TH"}, {time.Friday, "FR"},
		{time.Saturday, "SA"},
	}
	out := make([]string, 0, len(seen))
	for _, entry := range order {
		if seen[entry.day] {
			out = append(out, entry.code)
		}
	}
	return out
}

// maxOccurrenceScan bounds the search for occurrences inside a window.
//
// A rule can produce nothing inside the window asked for (a monthly event on
// the 31st, queried across February; a COUNT that ran out years ago), and
// without a ceiling the loop looking for the next one does not end.
const maxOccurrenceScan = 5000

// Occurrences expands a rule into the concrete start times falling in
// [from, to), at most limit of them.
//
// The event's own StartDate is occurrence one — RFC 5545 calls it DTSTART, and
// a rule never moves it. That is why "every Sunday" needs no BYDAY: the start
// already says which day.
func (r *Recurrence) Occurrences(start, from, to time.Time, limit int) []time.Time {
	if limit <= 0 || r == nil || r.Freq == "" {
		return nil
	}

	out := make([]time.Time, 0, limit)
	emitted := 0

	for cursor, scans := start, 0; scans < maxOccurrenceScan; scans++ {
		if !r.Until.IsZero() && cursor.After(r.Until) {
			break
		}
		if r.Count > 0 && emitted >= r.Count {
			break
		}
		if !cursor.Before(to) {
			// Past the requested window, and every later occurrence is later
			// still. Nothing after this can qualify.
			break
		}

		emitted++
		if !cursor.Before(from) {
			out = append(out, cursor)
			if len(out) >= limit {
				break
			}
		}
		cursor = r.next(cursor, start)
	}
	return out
}

// next advances one step. anchor is the series start, which MONTHLY needs: a
// series starting on the 31st must return to the 31st after a month that has
// no 31st, rather than drifting to the 28th forever.
func (r *Recurrence) next(cursor, anchor time.Time) time.Time {
	switch r.Freq {
	case FreqDaily:
		return cursor.AddDate(0, 0, r.Interval)

	case FreqWeekly:
		if len(r.ByDay) == 0 {
			return cursor.AddDate(0, 0, 7*r.Interval)
		}
		return r.nextByDay(cursor)

	case FreqMonthly:
		return nextMonthly(cursor, anchor, r.Interval)
	}
	return cursor.AddDate(0, 0, 1)
}

// nextByDay finds the next selected weekday, skipping INTERVAL-1 whole weeks
// after the last selected day of a week.
func (r *Recurrence) nextByDay(cursor time.Time) time.Time {
	selected := map[time.Weekday]bool{}
	for _, day := range r.ByDay {
		selected[day] = true
	}

	// Walk forward within the current week first.
	for offset := 1; offset <= 6; offset++ {
		candidate := cursor.AddDate(0, 0, offset)
		if candidate.Weekday() < cursor.Weekday() {
			// Crossed into the next week; interval handling takes over.
			break
		}
		if selected[candidate.Weekday()] {
			return candidate
		}
	}

	// Jump to the start of the week INTERVAL weeks ahead, then to its first
	// selected day.
	weekStart := cursor.AddDate(0, 0, -int(cursor.Weekday()))
	next := weekStart.AddDate(0, 0, 7*r.Interval)
	for offset := 0; offset <= 6; offset++ {
		candidate := next.AddDate(0, 0, offset)
		if selected[candidate.Weekday()] {
			return candidate
		}
	}
	return next
}

// nextMonthly advances whole months, keeping the anchor's day-of-month and
// SKIPPING months that do not contain it.
//
// Go's AddDate normalises overflow — 31 January plus one month is 3 March —
// which would turn "the 31st of every month" into a series that lands on the
// 3rd, the 31st, the 1st. RFC 5545 says such a month simply has no occurrence,
// which is also what a person means.
func nextMonthly(cursor, anchor time.Time, interval int) time.Time {
	day := anchor.Day()
	year, month := cursor.Year(), cursor.Month()

	for step := 0; step < 48; step++ {
		month += time.Month(interval)
		for month > time.December {
			month -= 12
			year++
		}
		if day <= daysIn(year, month) {
			return time.Date(year, month, day,
				anchor.Hour(), anchor.Minute(), anchor.Second(), anchor.Nanosecond(),
				anchor.Location())
		}
	}
	// Unreachable for any day 1..31, since every 31-day month occurs yearly.
	return cursor.AddDate(0, interval, 0)
}

// daysIn returns the length of a month.
func daysIn(year int, month time.Month) int {
	return time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
}
