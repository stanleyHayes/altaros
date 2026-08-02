package analytics

import (
	"testing"
	"time"
)

// The two numbers a dashboard gets wrong, both caught by looking at real
// seeded output rather than by a test written in advance:
//
//   - a partial final bucket compared against whole ones, which reported a 48%
//     collapse in giving during a normal first week of the month;
//   - attendance counted over a different population than members, which
//     reported "200 of 192 attended".

func at(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatalf("bad timestamp %q: %v", value, err)
	}
	return parsed.UTC()
}

func TestTheFinalBucketIsMarkedPartialWhenTheWindowCutsThroughIt(t *testing.T) {
	points := []Point{
		{Bucket: "2026-05", Value: 5_000_000},
		{Bucket: "2026-06", Value: 5_000_000},
		{Bucket: "2026-07", Value: 5_000_000},
		{Bucket: "2026-08", Value: 340_000}, // two days in
	}
	window := Range{
		From:  at(t, "2026-05-01T00:00:00Z"),
		To:    at(t, "2026-08-02T00:00:00Z"),
		Grain: GrainMonth,
	}

	trend := summarise(points, GrainMonth, window)
	if !trend.Points[3].Partial {
		t.Fatal("the month the window ends inside was not marked partial")
	}
	for i := 0; i < 3; i++ {
		if trend.Points[i].Partial {
			t.Errorf("bucket %s is whole but was marked partial", points[i].Bucket)
		}
	}
}

func TestAPartialBucketDoesNotDriveTheChangeFigure(t *testing.T) {
	// The regression. Three steady months plus two days of a fourth is not a
	// collapse in giving, and a dashboard that says so in the first week of
	// every month is one a pastor learns to ignore.
	whole := []Point{
		{Bucket: "2026-04", Value: 5_000_000},
		{Bucket: "2026-05", Value: 5_000_000},
		{Bucket: "2026-06", Value: 5_200_000},
		{Bucket: "2026-07", Value: 5_100_000},
	}
	window := Range{
		From:  at(t, "2026-04-01T00:00:00Z"),
		To:    at(t, "2026-08-02T00:00:00Z"),
		Grain: GrainMonth,
	}

	// Without the partial month, the trend is roughly flat.
	steady := summarise(append([]Point{}, whole...), GrainMonth,
		Range{From: window.From, To: at(t, "2026-08-01T00:00:00Z"), Grain: GrainMonth})
	if steady.Change == nil {
		t.Fatal("four whole buckets should produce a change figure")
	}
	if *steady.Change < -10 || *steady.Change > 10 {
		t.Fatalf("steady giving reported a change of %d%%", *steady.Change)
	}

	// Adding two days of a fifth month must not move it.
	withPartial := summarise(
		append(append([]Point{}, whole...), Point{Bucket: "2026-08", Value: 340_000}),
		GrainMonth, window)
	if withPartial.Change == nil {
		t.Fatal("a partial bucket should be excluded, not suppress the figure entirely")
	}
	if *withPartial.Change != *steady.Change {
		t.Fatalf("the partial month changed the trend from %d%% to %d%%",
			*steady.Change, *withPartial.Change)
	}
}

func TestNoChangeIsClaimedWithoutEnoughHistory(t *testing.T) {
	// A church with three weeks of data has no trend. Reporting 0% — or any
	// number — is a claim, and this codebase has removed several of those.
	window := Range{
		From:  at(t, "2026-07-01T00:00:00Z"),
		To:    at(t, "2026-07-21T00:00:00Z"),
		Grain: GrainWeek,
	}
	trend := summarise([]Point{
		{Bucket: "2026-W27", Value: 100},
		{Bucket: "2026-W28", Value: 120},
		{Bucket: "2026-W29", Value: 90},
	}, GrainWeek, window)

	if trend.Change != nil {
		t.Fatalf("a change of %d%% was claimed from three weeks of data", *trend.Change)
	}
}

func TestTheAverageIsPerBucketWithData(t *testing.T) {
	// A church that took a month off has not halved its giving.
	window := Range{
		From: at(t, "2026-05-01T00:00:00Z"), To: at(t, "2026-08-01T00:00:00Z"),
		Grain: GrainMonth,
	}
	trend := summarise([]Point{
		{Bucket: "2026-05", Value: 300},
		{Bucket: "2026-07", Value: 300},
	}, GrainMonth, window)

	if trend.Average != 300 {
		t.Fatalf("average = %d, want 300 — dividing by empty months would say 200",
			trend.Average)
	}
}

func TestBucketLabelsAgreeWithTheDatabaseFormat(t *testing.T) {
	// bucketOf has to produce exactly what MongoDB's $dateToString produces,
	// or the partial-bucket check never matches and the misleading percentage
	// comes back silently.
	cases := []struct {
		grain Grain
		at    string
		want  string
	}{
		{GrainDay, "2026-08-02T13:00:00Z", "2026-08-02"},
		{GrainMonth, "2026-08-02T13:00:00Z", "2026-08"},
		// 1 January 2027 is a Friday, which ISO puts in week 53 of 2026.
		// Formatting the ISO week with the calendar year (%Y rather than %G)
		// would label it 2027-W53 and sort it to the wrong end of the chart.
		{GrainWeek, "2027-01-01T00:00:00Z", "2026-W53"},
		{GrainWeek, "2026-08-02T00:00:00Z", "2026-W31"},
	}
	for _, c := range cases {
		if got := bucketOf(at(t, c.at), c.grain); got != c.want {
			t.Errorf("bucketOf(%s, %s) = %q, want %q", c.at, c.grain, got, c.want)
		}
	}
}

func TestARangeMustBeUsable(t *testing.T) {
	if _, err := (Range{
		From: at(t, "2026-08-01T00:00:00Z"),
		To:   at(t, "2026-07-01T00:00:00Z"),
	}).normalise(); err != ErrRangeInvalid {
		t.Errorf("a backwards range returned %v", err)
	}

	if _, err := (Range{
		From: at(t, "2016-01-01T00:00:00Z"),
		To:   at(t, "2026-01-01T00:00:00Z"),
	}).normalise(); err != ErrRangeTooWide {
		t.Errorf("a decade returned %v", err)
	}

	// Three CALENDAR years is the most natural thing anybody asks for, and it
	// contains a leap day — so a 3*365 ceiling would reject it.
	to := at(t, "2026-08-02T00:00:00Z")
	if _, err := (Range{From: to.AddDate(-3, 0, 0), To: to}).normalise(); err != nil {
		t.Errorf("exactly three years was refused: %v", err)
	}
}
