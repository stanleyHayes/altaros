package finance

import (
	"testing"
	"time"
)

// WP-26 acceptance: "a pledge of GHS 1,000 over 10 months tracks partial
// fulfilment and flags arrears." The arithmetic is worth testing directly,
// because every one of these numbers appears beside a member's name.

func on(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		t.Fatalf("bad date %q: %v", value, err)
	}
	return parsed.UTC()
}

// theCriterion is the pledge WP-26 names: GHS 1,000 over 10 months.
func theCriterion(t *testing.T) *Pledge {
	t.Helper()
	return &Pledge{
		TotalMinor: 100_000, Currency: "GHS",
		Frequency: FrequencyMonthly, Instalments: 10,
		StartDate: on(t, "2026-01-01"),
	}
}

func TestAPledgeOfAThousandOverTenMonthsTracksFulfilment(t *testing.T) {
	p := theCriterion(t)
	if p.InstalmentMinor() != 10_000 {
		t.Fatalf("instalment = %d, want GHS 100.00", p.InstalmentMinor())
	}

	cases := []struct {
		at      string
		paid    int64
		due     int64
		arrears int64
		behind  bool
		percent int
	}{
		// Four months in, four paid: on schedule.
		{"2026-04-15", 40_000, 40_000, 0, false, 40},
		// Four months in, two paid: two behind. The criterion's own example.
		{"2026-04-15", 20_000, 40_000, 20_000, true, 20},
		// Four months in, six paid: ahead, and NOT flagged.
		{"2026-04-15", 60_000, 40_000, 0, false, 60},
		// Before it starts, nothing is due however little has been paid.
		{"2025-12-01", 0, 0, 0, false, 0},
		// Long after it ends, the whole thing is due and no more.
		{"2030-01-01", 100_000, 100_000, 0, false, 100},
		{"2030-01-01", 70_000, 100_000, 30_000, true, 70},
	}

	for _, c := range cases {
		got := progressOf(p, c.paid, on(t, c.at))
		if got.DueMinor != c.due {
			t.Errorf("at %s: due = %d, want %d", c.at, got.DueMinor, c.due)
		}
		if got.ArrearsMinor != c.arrears {
			t.Errorf("at %s paid %d: arrears = %d, want %d",
				c.at, c.paid, got.ArrearsMinor, c.arrears)
		}
		if got.Behind != c.behind {
			t.Errorf("at %s paid %d: behind = %v, want %v",
				c.at, c.paid, got.Behind, c.behind)
		}
		if got.Percent != c.percent {
			t.Errorf("at %s paid %d: percent = %d, want %d",
				c.at, c.paid, got.Percent, c.percent)
		}
	}
}

func TestSomebodyWhoPaidEarlyIsNeverShownAsBehind(t *testing.T) {
	// A member who paid the whole thing in month one and then sees "behind"
	// beside their name has been told something false about themselves.
	p := theCriterion(t)
	got := progressOf(p, 100_000, on(t, "2026-02-01"))

	if got.Behind || got.ArrearsMinor != 0 {
		t.Fatalf("a fully-paid pledge shows behind=%v arrears=%d",
			got.Behind, got.ArrearsMinor)
	}
	if !got.Complete {
		t.Error("a fully-paid pledge is not marked complete")
	}
	if got.RemainingMinor != 0 {
		t.Errorf("remaining = %d on a completed pledge", got.RemainingMinor)
	}
	if got.NextDueAt != nil {
		t.Error("a completed pledge still has a next instalment date")
	}
}

func TestAheadAndBehindAreSeparateNumbers(t *testing.T) {
	// A single signed "balance" would hide which one it is inside the same
	// figure, and a church reading a list needs to see at a glance.
	p := theCriterion(t)

	ahead := progressOf(p, 60_000, on(t, "2026-04-15"))
	if ahead.AheadMinor != 20_000 || ahead.ArrearsMinor != 0 {
		t.Errorf("ahead: ahead=%d arrears=%d, want 20000/0",
			ahead.AheadMinor, ahead.ArrearsMinor)
	}

	behind := progressOf(p, 20_000, on(t, "2026-04-15"))
	if behind.ArrearsMinor != 20_000 || behind.AheadMinor != 0 {
		t.Errorf("behind: ahead=%d arrears=%d, want 0/20000",
			behind.AheadMinor, behind.ArrearsMinor)
	}
}

func TestARoundingRemainderNeverStrandsAPledgeOnePesewaShort(t *testing.T) {
	// GHS 1,000 over 3 is 333.33 three times, which is 999.99. A pledge that
	// can never complete because of a rounding rule shows as behind forever.
	p := &Pledge{
		TotalMinor: 100_000, Currency: "GHS",
		Frequency: FrequencyMonthly, Instalments: 3,
		StartDate: on(t, "2026-01-01"),
	}
	// After the final instalment, the whole total is due — not 3 x 33333.
	if due := p.DueBy(on(t, "2026-03-02")); due != 100_000 {
		t.Fatalf("after the last instalment, due = %d, want the full 100000", due)
	}
	// And paying the full amount completes it.
	got := progressOf(p, 100_000, on(t, "2026-03-02"))
	if !got.Complete || got.Behind {
		t.Fatalf("a fully-paid pledge reads complete=%v behind=%v",
			got.Complete, got.Behind)
	}
}

func TestACancelledPledgeIsNeverInArrears(t *testing.T) {
	// A church that agreed to release somebody must not keep showing them as
	// behind. Cancelled rather than deleted, so the giving already made
	// against it does not look unattributed.
	p := theCriterion(t)
	p.Cancelled = true

	got := progressOf(p, 10_000, on(t, "2026-08-01"))
	if got.Behind || got.ArrearsMinor != 0 {
		t.Fatalf("a cancelled pledge shows behind=%v arrears=%d",
			got.Behind, got.ArrearsMinor)
	}
	if got.DueMinor != 0 {
		t.Errorf("a cancelled pledge still has %d due", got.DueMinor)
	}
}

func TestTheNextInstalmentDateIsTheNextOneNotThePast(t *testing.T) {
	p := theCriterion(t)
	got := progressOf(p, 30_000, on(t, "2026-03-15"))
	if got.NextDueAt == nil {
		t.Fatal("no next instalment on a live pledge")
	}
	if want := on(t, "2026-04-01"); !got.NextDueAt.Equal(want) {
		t.Fatalf("next due %s, want %s", got.NextDueAt, want)
	}
}

func TestAOneOffPledgeIsDueInFullFromTheStart(t *testing.T) {
	p := &Pledge{
		TotalMinor: 50_000, Currency: "GHS",
		Frequency: FrequencyOneOff, Instalments: 1,
		StartDate: on(t, "2026-01-01"),
	}
	if due := p.DueBy(on(t, "2026-01-02")); due != 50_000 {
		t.Fatalf("a one-off pledge has %d due, want the whole 50000", due)
	}
	if due := p.DueBy(on(t, "2025-12-31")); due != 0 {
		t.Fatalf("a one-off pledge has %d due before it starts", due)
	}
}

func TestWeeklyAndFortnightlySchedulesStepCorrectly(t *testing.T) {
	start := on(t, "2026-01-01")
	for _, c := range []struct {
		freq Frequency
		at   string
		want int
	}{
		{FrequencyWeekly, "2026-01-01", 1},
		{FrequencyWeekly, "2026-01-08", 2},
		// The fourth weekly instalment falls on the 22nd, so the 21st is
		// still three — a schedule that rounded up here would show somebody
		// behind a day before they were due.
		{FrequencyWeekly, "2026-01-21", 3},
		{FrequencyWeekly, "2026-01-22", 4},
		{FrequencyFortnight, "2026-01-15", 2},
		{FrequencyFortnight, "2026-02-12", 4},
	} {
		p := &Pledge{
			TotalMinor: 100_000, Frequency: c.freq,
			Instalments: 10, StartDate: start,
		}
		want := int64(c.want) * p.InstalmentMinor()
		if got := p.DueBy(on(t, c.at)); got != want {
			t.Errorf("%s at %s: due = %d, want %d instalments (%d)",
				c.freq, c.at, got, c.want, want)
		}
	}
}

func TestAnUnusableScheduleIsRefused(t *testing.T) {
	for _, in := range []PledgeInput{
		{MemberID: "", TotalMinor: 100},
		{MemberID: "m", TotalMinor: 0},
		{MemberID: "m", TotalMinor: 100, Instalments: 0, Frequency: FrequencyMonthly},
		{MemberID: "m", TotalMinor: 100, Instalments: 5000, Frequency: FrequencyWeekly},
		{MemberID: "m", TotalMinor: 100, Instalments: 3, Frequency: "yearly"},
	} {
		if _, err := in.normalise(); err == nil {
			t.Errorf("%+v was accepted", in)
		}
	}
}

// A pledge started at the end of a month falls due at the end of every month.
//
// Go's AddDate normalises rather than clamps — 31 January plus a month is 3
// March — which skips February outright. People pledge on the last Sunday of
// the month, so this is the common case, not an exotic one, and the symptom is
// a member who missed February reading as up to date on the 1st of March.
func TestAMonthEndPledgeFallsDueAtEachMonthEnd(t *testing.T) {
	p := &Pledge{
		TotalMinor: 100_000, Currency: "GHS",
		Frequency: FrequencyMonthly, Instalments: 10,
		StartDate: on(t, "2026-01-31"),
	}

	want := []string{
		"2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31",
	}
	for i, w := range want {
		got := p.Frequency.step(p.StartDate, i)
		if !got.Equal(on(t, w)) {
			t.Errorf("instalment %d falls %s, want %s",
				i+1, got.Format("2006-01-02"), w)
		}
	}

	// The consequence the church actually sees: on 1 March, somebody who has
	// paid one instalment has missed February and must read as behind.
	got := progressOf(p, 10_000, on(t, "2026-03-01"))
	if !got.Behind || got.ArrearsMinor != 10_000 {
		t.Fatalf("on 1 March, a member who missed February reads behind=%v arrears=%d",
			got.Behind, got.ArrearsMinor)
	}
}

// February 29th exists only in a leap year, so a pledge started on one has to
// clamp back to the 28th in every other.
func TestALeapDayPledgeClampsInOrdinaryYears(t *testing.T) {
	start := on(t, "2028-02-29") // 2028 is a leap year
	for _, c := range []struct {
		months int
		want   string
	}{
		{12, "2029-02-28"},
		{48, "2032-02-29"},
	} {
		if got := addMonthsClamped(start, c.months); !got.Equal(on(t, c.want)) {
			t.Errorf("+%d months = %s, want %s",
				c.months, got.Format("2006-01-02"), c.want)
		}
	}
}
