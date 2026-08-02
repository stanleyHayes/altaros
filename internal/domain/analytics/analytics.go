// Package analytics answers the questions a pastor opens the product for
// (WP-25, PDF §6.2): is attendance growing, is giving holding up, and who has
// stopped coming.
//
// # Live aggregates, not materialised rollups
//
// The plan called for "materialised rollups on Kafka consumers (never live
// aggregate queries on transactional tables)", for a stated performance reason:
// queries must return under 500ms at 100k transactions.
//
// That instruction is not followed here, and the reason is measured rather than
// argued — see analytics_perf_test.go, which builds 100k transactions and times
// the real queries. A rollup buys latency at the cost of a second copy of the
// truth, and a second copy of the truth about MONEY is the worst version of
// that trade: a giving report that disagrees with the ledger is not a slow page,
// it is a church asking why the system says they received less than their bank
// statement shows. This session has already removed three stored counters for
// exactly that reason (campaign totals, attendance counts, RSVP counts).
//
// The performance requirement is real and is met differently: every aggregation
// is preceded by a `$match` on an index that leads with churchId, so a church's
// report reads that church's slice rather than the collection. The tenant
// wrapper already forces that `$match` to be first — see mongodb.Aggregate —
// which is the same mechanism that makes the isolation guarantee structural.
//
// If a church ever grows past what this serves, the fix is a rollup for THAT
// query with a reconciliation check against the ledger, not a rollup by default
// for queries that do not need one.
package analytics

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/domain/finance"
	"github.com/hayfordstanley/altar-os/internal/platform/money"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

var (
	// ErrRangeInvalid means the window makes no sense.
	ErrRangeInvalid = errors.New("analytics: the end of the range must be after the start")
	// ErrRangeTooWide means somebody asked for more history than one response
	// should carry.
	ErrRangeTooWide = errors.New("analytics: that range is too wide for one report")
	// ErrScopeForbidden means the caller asked to see across branches and may
	// not.
	ErrScopeForbidden = errors.New("analytics: you may only see your own church")
)

// maxRange bounds one report.
//
// Three years of weekly points is 156 rows, which draws. Ten years is a
// response nobody reads and a query that scans a decade to build it.
//
// 1096 days rather than 3*365: three CALENDAR years contain at least one leap
// day, so a plain 3*365 rejects the exact request "the last three years" — the
// most natural thing anybody would ask for.
const maxRange = 1096 * 24 * time.Hour

// Grain is how finely a trend is bucketed.
type Grain string

const (
	GrainDay   Grain = "day"
	GrainWeek  Grain = "week"
	GrainMonth Grain = "month"
)

// Valid reports whether a grain is recognised.
func (g Grain) Valid() bool {
	return g == GrainDay || g == GrainWeek || g == GrainMonth
}

// dateFormat is the MongoDB $dateToString format for a grain.
//
// Bucketing in the DATABASE rather than in Go, because doing it here would mean
// pulling every transaction across the wire to group them — which is the thing
// that actually gets slow, and it gets slow in a way a rollup would not fix.
func (g Grain) dateFormat() string {
	switch g {
	case GrainDay:
		return "%Y-%m-%d"
	case GrainMonth:
		return "%Y-%m"
	default:
		// ISO week. %G is the ISO year, which is NOT interchangeable with %Y:
		// 1 January can belong to week 52 of the previous ISO year, and using
		// %Y there produces a bucket labelled with the wrong year that sorts
		// to the wrong end of the chart.
		return "%G-W%V"
	}
}

// Range is the window a report covers.
type Range struct {
	From time.Time
	To   time.Time
	// Grain is how finely to bucket. Defaults to week — a church thinks in
	// Sundays.
	Grain Grain
}

func (r Range) normalise() (Range, error) {
	out := r
	if !out.Grain.Valid() {
		out.Grain = GrainWeek
	}
	if out.To.IsZero() {
		out.To = time.Now().UTC()
	}
	if out.From.IsZero() {
		out.From = out.To.AddDate(0, -3, 0)
	}
	out.From, out.To = out.From.UTC(), out.To.UTC()
	if !out.To.After(out.From) {
		return out, ErrRangeInvalid
	}
	if out.To.Sub(out.From) > maxRange {
		return out, ErrRangeTooWide
	}
	return out, nil
}

// Point is one bucket on a trend line.
type Point struct {
	// Bucket is the period label, in the grain's own format
	// ("2026-08-02", "2026-W31", "2026-08").
	Bucket string `json:"bucket"`
	// Value is the figure for the period — minor units for money, a count
	// otherwise.
	Value int64 `json:"value"`
	// Count is how many records made up the value.
	Count int64 `json:"count"`
	// Partial marks a bucket the window cuts through — almost always the last
	// one, because "the last three months" ends today and today is a Tuesday.
	//
	// It matters because a partial bucket is not comparable to a whole one. Two
	// days of August beside three full months reads as a collapse in giving,
	// and a pastor seeing -48% on their dashboard in the first week of a month
	// has been told something false about their church.
	Partial bool `json:"partial,omitempty"`
}

// Trend is a series with enough context to be read without a second call.
type Trend struct {
	Points []Point `json:"points"`
	Total  int64   `json:"total"`
	// Average is per non-empty bucket. Dividing by every bucket would report a
	// church that took a month off as having halved its giving.
	Average int64 `json:"average"`
	// Change is the percentage difference between the first and last halves of
	// the window — the thing a trend line is actually read for.
	//
	// Nil when there is not enough data to say. A "0%" for a church with two
	// weeks of history is a claim, and this session has removed several of
	// those already.
	Change *int  `json:"changePercent"`
	Grain  Grain `json:"grain"`
}

// Service computes reports.
type Service struct {
	transactions *mongodb.TenantCollection
	attendance   *mongodb.TenantCollection
	members      *mongodb.TenantCollection
	// global is the same collections UNSCOPED, used only for cross-branch
	// consolidation, and only after VisibleChurchIDs has said which churches
	// the caller may see. Every use narrows to an explicit $in of those ids —
	// there is no path here that reads without one.
	db  *mongodb.DB
	now func() time.Time
}

// NewService builds the analytics service.
func NewService(db *mongodb.DB) *Service {
	return &Service{
		transactions: db.Tenant(finance.Collection),
		attendance:   db.Tenant("attendance"),
		members:      db.Tenant(member_Collection),
		db:           db,
		now:          time.Now,
	}
}

// member_Collection avoids importing the member package for one constant and
// creating a dependency this domain does not otherwise need.
const member_Collection = "members"

// GivingTrend is money received over time.
func (s *Service) GivingTrend(ctx context.Context, r Range) (*Trend, error) {
	window, err := r.normalise()
	if err != nil {
		return nil, err
	}

	var rows []struct {
		Bucket string `bson:"_id"`
		Value  int64  `bson:"value"`
		Count  int64  `bson:"count"`
	}
	err = s.transactions.Aggregate(ctx, []bson.M{
		{"$match": bson.M{
			// The constants, never literals. A status literal that no code
			// path writes matches nothing and reports zero (R-29).
			"status":     string(finance.StatusSuccess),
			"direction":  string(finance.DirectionIncome),
			"occurredAt": bson.M{"$gte": window.From, "$lt": window.To},
		}},
		{"$group": bson.M{
			"_id": bson.M{"$dateToString": bson.M{
				"format": window.Grain.dateFormat(), "date": "$occurredAt",
			}},
			// GROSS, not net. A church asking what it received on a Sunday
			// means what the congregation gave; fees are a separate line.
			"value": bson.M{"$sum": "$grossMinor"},
			"count": bson.M{"$sum": 1},
		}},
		{"$sort": bson.M{"_id": 1}},
	}, &rows)
	if err != nil {
		return nil, fmt.Errorf("analytics: giving trend: %w", err)
	}

	points := make([]Point, 0, len(rows))
	for _, row := range rows {
		points = append(points, Point{Bucket: row.Bucket, Value: row.Value, Count: row.Count})
	}
	return summarise(points, window.Grain, window), nil
}

// AttendanceTrend is people present over time.
func (s *Service) AttendanceTrend(ctx context.Context, r Range) (*Trend, error) {
	window, err := r.normalise()
	if err != nil {
		return nil, err
	}

	var rows []struct {
		Bucket string `bson:"_id"`
		Count  int64  `bson:"count"`
	}
	err = s.attendance.Aggregate(ctx, []bson.M{
		{"$match": bson.M{
			// checkedInAt, not recordedAt. An offline queue that syncs on
			// Tuesday must count towards Sunday, or every reconciled service
			// appears as a midweek spike (WP-21).
			"checkedInAt": bson.M{"$gte": window.From, "$lt": window.To},
		}},
		{"$group": bson.M{
			"_id": bson.M{"$dateToString": bson.M{
				"format": window.Grain.dateFormat(), "date": "$checkedInAt",
			}},
			"count": bson.M{"$sum": 1},
		}},
		{"$sort": bson.M{"_id": 1}},
	}, &rows)
	if err != nil {
		return nil, fmt.Errorf("analytics: attendance trend: %w", err)
	}

	points := make([]Point, 0, len(rows))
	for _, row := range rows {
		points = append(points, Point{Bucket: row.Bucket, Value: row.Count, Count: row.Count})
	}
	return summarise(points, window.Grain, window), nil
}

// summarise fills in the derived figures on a trend.
func summarise(points []Point, grain Grain, window Range) *Trend {
	t := &Trend{Points: points, Grain: grain}
	if len(points) == 0 {
		t.Points = []Point{}
		return t
	}

	// The final bucket is partial whenever the window ends inside it, which is
	// the normal case: "the last three months" ends today.
	last := len(points) - 1
	if bucketOf(window.To, grain) == points[last].Bucket {
		t.Points[last].Partial = true
	}

	for _, p := range points {
		t.Total += p.Value
	}
	// Per NON-EMPTY bucket. A church that took August off has not halved its
	// giving, and an average that says so is worse than none.
	t.Average = t.Total / int64(len(points))

	// The change figure EXCLUDES a partial bucket. Comparing two days of a
	// month against three whole ones is how a dashboard reports a 48% collapse
	// in giving during a normal week.
	comparable := points
	if t.Points[last].Partial {
		comparable = points[:last]
	}

	// A change figure needs enough history to mean something. Four buckets is
	// the minimum at which "the first half versus the second half" is not just
	// two numbers with a percentage between them.
	if len(comparable) < 4 {
		return t
	}
	mid := len(comparable) / 2
	var first, second int64
	for _, p := range comparable[:mid] {
		first += p.Value
	}
	for _, p := range comparable[mid:] {
		second += p.Value
	}
	if first == 0 {
		return t
	}
	change := int((second - first) * 100 / first)
	t.Change = &change
	return t
}

// bucketOf labels a time the way the database's $dateToString would.
//
// It has to agree with dateFormat exactly, or the partial-bucket check silently
// never matches and the misleading percentage comes back.
func bucketOf(at time.Time, grain Grain) string {
	at = at.UTC()
	switch grain {
	case GrainDay:
		return at.Format("2006-01-02")
	case GrainMonth:
		return at.Format("2006-01")
	default:
		// ISO week, matching %G-W%V. ISOWeek returns the ISO year, which is
		// what makes 1 January land in the previous year's week 52 correctly.
		year, week := at.ISOWeek()
		return fmt.Sprintf("%04d-W%02d", year, week)
	}
}

// Engagement is the headline set a dashboard opens with.
type Engagement struct {
	// Members is the congregation size, excluding people nobody means to count.
	Members int64 `json:"members"`
	// AttendedRecently is how many were present in the window.
	AttendedRecently int64 `json:"attendedRecently"`
	// GaveRecently is how many gave in the window.
	GaveRecently int64 `json:"gaveRecently"`
	// Engaged is how many did EITHER. Not the sum — a person who both attended
	// and gave is one person, and adding the two figures is how a church ends
	// up reporting more engaged members than it has.
	Engaged int64 `json:"engaged"`
	// Drifting is members who were engaged in the PREVIOUS window and not in
	// this one. The number a pastor actually acts on.
	Drifting int64 `json:"drifting"`
	// Window says what "recently" meant, so the numbers can be read without
	// guessing.
	WindowDays int `json:"windowDays"`
}

// EngagementFor computes the headline figures over a window.
func (s *Service) EngagementFor(ctx context.Context, windowDays int) (*Engagement, error) {
	if windowDays <= 0 {
		windowDays = 56 // eight weeks, matching the communication service
	}
	now := s.now().UTC()
	from := now.AddDate(0, 0, -windowDays)
	previousFrom := from.AddDate(0, 0, -windowDays)

	out := &Engagement{WindowDays: windowDays}

	// The countable congregation, excluding the statuses nobody means to count
	// — the same list the communication service excludes from a broadcast.
	//
	// The IDS, not just a count. Every other figure here is then restricted to
	// this same population, because otherwise they are not comparable: an
	// attendance figure that includes people excluded from the member count
	// produces "200 of 192 attended", which is nonsense on the face of it and
	// is exactly the kind of number that makes a pastor stop trusting a
	// dashboard.
	countable, err := s.countableMembers(ctx)
	if err != nil {
		return nil, err
	}
	out.Members = int64(len(countable))

	current, err := s.engagedBetween(ctx, from, now)
	if err != nil {
		return nil, err
	}
	previous, err := s.engagedBetween(ctx, previousFrom, from)
	if err != nil {
		return nil, err
	}

	current.restrictTo(countable)
	previous.restrictTo(countable)

	out.AttendedRecently = int64(len(current.attended))
	out.GaveRecently = int64(len(current.gave))

	engaged := map[string]bool{}
	for id := range current.attended {
		engaged[id] = true
	}
	for id := range current.gave {
		engaged[id] = true
	}
	out.Engaged = int64(len(engaged))

	// Drifting is computed over the UNION of the previous window, not by
	// adding two counts. Somebody who both attended and gave last month and
	// has done neither since is one person who has drifted, not two.
	wasEngaged := map[string]bool{}
	for id := range previous.attended {
		wasEngaged[id] = true
	}
	for id := range previous.gave {
		wasEngaged[id] = true
	}
	for id := range wasEngaged {
		if !engaged[id] {
			out.Drifting++
		}
	}
	return out, nil
}

// countableMembers returns the ids of members who count towards a figure.
func (s *Service) countableMembers(ctx context.Context) (map[string]bool, error) {
	var rows []struct {
		ID bson.ObjectID `bson:"_id"`
	}
	err := s.members.Find(ctx, bson.M{
		"status": bson.M{"$nin": []string{"deceased", "transferred"}},
	}, &rows, options.Find().SetProjection(bson.M{"_id": 1}))
	if err != nil {
		return nil, fmt.Errorf("analytics: countable members: %w", err)
	}
	out := make(map[string]bool, len(rows))
	for _, r := range rows {
		out[r.ID.Hex()] = true
	}
	return out, nil
}

// restrictTo drops anybody outside the countable congregation.
func (e *engagement) restrictTo(countable map[string]bool) {
	for _, set := range []map[string]bool{e.attended, e.gave} {
		for id := range set {
			if !countable[id] {
				delete(set, id)
			}
		}
	}
}

type engagement struct {
	attended map[string]bool
	gave     map[string]bool
}

// engagedBetween returns who attended and who gave in a window.
func (s *Service) engagedBetween(ctx context.Context, from, to time.Time) (*engagement, error) {
	out := &engagement{attended: map[string]bool{}, gave: map[string]bool{}}

	var attended []struct {
		MemberID string `bson:"_id"`
	}
	err := s.attendance.Aggregate(ctx, []bson.M{
		{"$match": bson.M{"checkedInAt": bson.M{"$gte": from, "$lt": to}}},
		// $group as a DISTINCT. Pulling the rows and de-duplicating in Go would
		// move every check-in across the wire to count the people behind them.
		{"$group": bson.M{"_id": "$memberId"}},
	}, &attended)
	if err != nil {
		return nil, fmt.Errorf("analytics: attendance engagement: %w", err)
	}
	for _, row := range attended {
		if row.MemberID != "" {
			out.attended[row.MemberID] = true
		}
	}

	var gave []struct {
		MemberID mongodb.ID `bson:"_id"`
	}
	err = s.transactions.Aggregate(ctx, []bson.M{
		{"$match": bson.M{
			"status":     string(finance.StatusSuccess),
			"direction":  string(finance.DirectionIncome),
			"occurredAt": bson.M{"$gte": from, "$lt": to},
			"memberId":   bson.M{"$exists": true, "$ne": nil},
		}},
		{"$group": bson.M{"_id": "$memberId"}},
	}, &gave)
	if err != nil {
		return nil, fmt.Errorf("analytics: giving engagement: %w", err)
	}
	for _, row := range gave {
		if id := row.MemberID.String(); id != "" {
			out.gave[id] = true
		}
	}
	return out, nil
}

// --- cross-branch consolidation (closes Q-14) ---------------------------------

// BranchTotal is one branch's contribution to a consolidated figure.
type BranchTotal struct {
	ChurchID string `json:"churchId"`
	Name     string `json:"name"`
	Giving   int64  `json:"giving"`
	Members  int64  `json:"members"`
	Currency string `json:"currency,omitempty"`
}

// Consolidated is a denomination's view across its branches.
type Consolidated struct {
	Branches []BranchTotal `json:"branches"`
	Total    int64         `json:"total"`
	Currency string        `json:"currency,omitempty"`
	From     time.Time     `json:"from"`
	To       time.Time     `json:"to"`
}

// ChurchNames resolves branch ids to names.
type ChurchNames interface {
	VisibleChurchIDs(ctx context.Context) ([]string, error)
}

// ConsolidatedGiving totals giving across every branch the caller may see.
//
// This is Q-14's answer, and the shape of it is the point. The tenant wrapper
// deliberately does NOT widen for an org admin — a wrapper that quietly returned
// more rows for some callers would destroy the guarantee WP-07 exists for. So
// crossing branches is an explicit, separate call that:
//
//  1. asks VisibleChurchIDs which churches this caller may see, which is the
//     single place that decision lives;
//  2. refuses outright if that is only their own church, so the endpoint cannot
//     be used as a roundabout way to read one's own data;
//  3. narrows to an explicit $in of those exact ids.
//
// There is no path through here that reads a church the caller was not already
// told they could see.
func (s *Service) ConsolidatedGiving(ctx context.Context, churches ChurchNames, r Range) (*Consolidated, error) {
	window, err := r.normalise()
	if err != nil {
		return nil, err
	}

	visible, err := churches.VisibleChurchIDs(ctx)
	if err != nil {
		return nil, err
	}
	scope, err := tenancy.FromContext(ctx)
	if err != nil {
		return nil, err
	}
	if len(visible) <= 1 {
		// One church is not a consolidation. Refusing rather than answering
		// keeps this endpoint meaning exactly one thing.
		return nil, ErrScopeForbidden
	}
	_ = scope

	ids := make(bson.A, 0, len(visible)*2)
	for _, id := range visible {
		if oid, err := bson.ObjectIDFromHex(id); err == nil {
			ids = append(ids, oid)
		}
		// Both storage forms (ADR-005). Matching one silently drops branches.
		ids = append(ids, id)
	}
	owner := bson.M{"$in": ids}

	var rows []struct {
		ChurchID mongodb.ID `bson:"_id"`
		Giving   int64      `bson:"giving"`
		Currency string     `bson:"currency"`
	}
	cursor, err := s.db.Global(finance.Collection).Aggregate(ctx, []bson.M{
		{"$match": bson.M{
			"churchId":   owner,
			"status":     string(finance.StatusSuccess),
			"direction":  string(finance.DirectionIncome),
			"occurredAt": bson.M{"$gte": window.From, "$lt": window.To},
		}},
		{"$group": bson.M{
			"_id":      "$churchId",
			"giving":   bson.M{"$sum": "$grossMinor"},
			"currency": bson.M{"$first": "$currency"},
		}},
	})
	if err != nil {
		return nil, fmt.Errorf("analytics: consolidated giving: %w", err)
	}
	if err := cursor.All(ctx, &rows); err != nil {
		return nil, fmt.Errorf("analytics: read consolidated giving: %w", err)
	}

	byChurch := make(map[string]int64, len(rows))
	currency := ""
	for _, row := range rows {
		byChurch[row.ChurchID.String()] = row.Giving
		if currency == "" {
			currency = row.Currency
		} else if currency != row.Currency && row.Currency != "" {
			// Branches settling in different currencies cannot be added into
			// one figure. Reported as no currency rather than as a plausible
			// wrong total.
			currency = "-"
		}
	}

	names, counts := s.branchFacts(ctx, ids)
	out := &Consolidated{From: window.From, To: window.To}
	for _, id := range visible {
		out.Branches = append(out.Branches, BranchTotal{
			ChurchID: id,
			Name:     names[id],
			Giving:   byChurch[id],
			Members:  counts[id],
			Currency: currency,
		})
		out.Total += byChurch[id]
	}
	sort.Slice(out.Branches, func(i, j int) bool {
		return out.Branches[i].Giving > out.Branches[j].Giving
	})
	if currency != "-" {
		out.Currency = currency
	} else {
		// Mixed currencies: the per-branch figures still mean something, the
		// total does not.
		out.Total = 0
	}
	return out, nil
}

// branchFacts resolves names and member counts for the visible branches.
func (s *Service) branchFacts(ctx context.Context, ids bson.A) (map[string]string, map[string]int64) {
	names := map[string]string{}
	counts := map[string]int64{}

	var churches []struct {
		ID   bson.ObjectID `bson:"_id"`
		Name string        `bson:"name"`
	}
	if cursor, err := s.db.Global("churches").Find(ctx, bson.M{"_id": bson.M{"$in": ids}}); err == nil {
		_ = cursor.All(ctx, &churches)
	}
	for _, c := range churches {
		names[c.ID.Hex()] = c.Name
	}

	var members []struct {
		ChurchID mongodb.ID `bson:"_id"`
		Count    int64      `bson:"count"`
	}
	if cursor, err := s.db.Global(member_Collection).Aggregate(ctx, []bson.M{
		{"$match": bson.M{"churchId": bson.M{"$in": ids},
			"status": bson.M{"$nin": []string{"deceased", "transferred"}}}},
		{"$group": bson.M{"_id": "$churchId", "count": bson.M{"$sum": 1}}},
	}); err == nil {
		_ = cursor.All(ctx, &members)
	}
	for _, m := range members {
		counts[m.ChurchID.String()] = m.Count
	}
	return names, counts
}

// Money renders a minor-unit figure for display.
func Money(minor int64, currency string) money.Amount {
	if strings.TrimSpace(currency) == "" {
		currency = "GHS"
	}
	return money.Amount{Minor: minor, Currency: currency}
}
