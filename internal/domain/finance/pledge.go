package finance

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/platform/money"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// Pledges (WP-26, §8.2): a promise to give an amount over time, and the
// tracking of whether it happened.
//
// # A pledge is not a debt
//
// That distinction shapes everything here. A church member who promised GHS
// 1,000 over ten months and has paid four is not a debtor, and a system that
// treats them as one — dunning notices, red arrears figures beside their name —
// turns a spiritual commitment into a collections process. Churches that do
// this lose people.
//
// So: arrears are computed and shown to the CHURCH for pastoral follow-up, the
// language is "behind" rather than "overdue", and nothing here sends anybody a
// demand. What the church does with the information is a pastoral decision, and
// the product's job is to make it accurate rather than to act on it.
//
// # Fulfilment is derived, never stored
//
// The same rule as campaign totals and attendance counts. A stored "paid so
// far" drifts the moment a gift is refunded or a webhook replays, and a member
// told they are behind when they are not is the version of this bug that
// actually costs something.

// PledgeCollection holds pledges.
const PledgeCollection = "pledges"

var (
	// ErrPledgeNotFound means no such pledge in this church.
	ErrPledgeNotFound = errors.New("finance: pledge not found")
	// ErrPledgeAmount means the promised amount is not usable.
	ErrPledgeAmount = errors.New("finance: a pledge needs an amount above zero")
	// ErrPledgeSchedule means the instalment plan makes no sense.
	ErrPledgeSchedule = errors.New("finance: a pledge needs at least one instalment")
	// ErrPledgeMember means the pledge named nobody.
	ErrPledgeMember = errors.New("finance: which member made this pledge?")
)

// Frequency is how often an instalment falls due.
type Frequency string

const (
	FrequencyWeekly    Frequency = "weekly"
	FrequencyFortnight Frequency = "fortnightly"
	FrequencyMonthly   Frequency = "monthly"
	FrequencyOneOff    Frequency = "one_off"
)

// Valid reports whether a frequency is recognised.
func (f Frequency) Valid() bool {
	switch f {
	case FrequencyWeekly, FrequencyFortnight, FrequencyMonthly, FrequencyOneOff:
		return true
	}
	return false
}

// step advances a date by one period.
//
// The monthly case does NOT use AddDate directly, because AddDate normalises
// rather than clamps: 31 January plus one month is 31 February, which Go turns
// into 3 March. February is then skipped entirely, the member is not counted
// due for it, and the schedule drifts a day further forward every short month.
//
// That matters more than it looks. People pledge on the last Sunday of the
// month, so month-end start dates are common rather than exotic — and the
// visible symptom is a member who missed February still reading as up to date
// on the 1st of March. Clamping to the last day of the target month keeps
// "monthly" meaning what a person means by it.
func (f Frequency) step(from time.Time, n int) time.Time {
	switch f {
	case FrequencyWeekly:
		return from.AddDate(0, 0, 7*n)
	case FrequencyFortnight:
		return from.AddDate(0, 0, 14*n)
	case FrequencyMonthly:
		return addMonthsClamped(from, n)
	default:
		return from
	}
}

// addMonthsClamped advances by whole months, holding the day of the month where
// the target month is long enough and falling back to its last day where it is
// not.
func addMonthsClamped(from time.Time, n int) time.Time {
	year, month, day := from.Date()
	target := time.Date(year, month+time.Month(n), 1, from.Hour(), from.Minute(),
		from.Second(), from.Nanosecond(), from.Location())

	// The 0th day of the following month is the last day of this one, which
	// avoids a leap-year table.
	last := time.Date(target.Year(), target.Month()+1, 0, 0, 0, 0, 0, target.Location()).Day()
	if day > last {
		day = last
	}
	return time.Date(target.Year(), target.Month(), day, from.Hour(), from.Minute(),
		from.Second(), from.Nanosecond(), from.Location())
}

// Pledge is a promise to give.
type Pledge struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`

	MemberID string `bson:"memberId" json:"memberId"`
	// CampaignID ties the pledge to an appeal. Optional: a church also takes
	// standing pledges against general giving.
	CampaignID mongodb.ID `bson:"campaignId,omitempty" json:"campaignId,omitempty"`

	// TotalMinor is the whole promise, in minor units.
	TotalMinor int64  `bson:"totalMinor" json:"totalMinor"`
	Currency   string `bson:"currency"   json:"currency"`

	Frequency    Frequency `bson:"frequency"    json:"frequency"`
	Instalments  int       `bson:"instalments"  json:"instalments"`
	StartDate    time.Time `bson:"startDate"    json:"startDate"`
	Cancelled    bool      `bson:"cancelled,omitempty"   json:"cancelled,omitempty"`
	CancelReason string    `bson:"cancelReason,omitempty" json:"cancelReason,omitempty"`

	Note       string     `bson:"note,omitempty"      json:"note,omitempty"`
	RecordedBy mongodb.ID `bson:"recordedBy,omitempty" json:"recordedBy,omitempty"`
	CreatedAt  time.Time  `bson:"createdAt" json:"createdAt"`
	UpdatedAt  time.Time  `bson:"updatedAt" json:"updatedAt"`
}

// InstalmentMinor is what each payment should be.
//
// The remainder goes on the FINAL instalment rather than being spread or
// dropped. GHS 1,000 over 3 is 333.33 three times, which is 999.99 — and a
// pledge that can never be completed because of a rounding rule is a pledge
// that shows as one pesewa behind forever.
func (p *Pledge) InstalmentMinor() int64 {
	if p == nil || p.Instalments <= 0 {
		return 0
	}
	return p.TotalMinor / int64(p.Instalments)
}

// DueBy returns how much should have been given by a moment.
//
// Instalments due, capped at the total. A pledge that has run its course is due
// in full and no more, however long ago it finished.
func (p *Pledge) DueBy(at time.Time) int64 {
	if p == nil || p.Cancelled || p.Instalments <= 0 {
		return 0
	}
	if at.Before(p.StartDate) {
		return 0
	}
	if p.Frequency == FrequencyOneOff {
		return p.TotalMinor
	}

	due := 0
	for i := 0; i < p.Instalments; i++ {
		if p.Frequency.step(p.StartDate, i).After(at) {
			break
		}
		due++
	}
	if due >= p.Instalments {
		return p.TotalMinor
	}
	return int64(due) * p.InstalmentMinor()
}

// EndDate is when the final instalment falls due.
func (p *Pledge) EndDate() time.Time {
	if p == nil || p.Instalments <= 0 {
		return time.Time{}
	}
	return p.Frequency.step(p.StartDate, p.Instalments-1)
}

// PledgeProgress is a pledge with what has actually happened against it.
type PledgeProgress struct {
	Pledge *Pledge `json:"pledge"`
	// PaidMinor is what has actually been given, summed from completed
	// transactions. Never stored.
	PaidMinor int64 `json:"paidMinor"`
	// DueMinor is what should have been given by now.
	DueMinor int64 `json:"dueMinor"`
	// ArrearsMinor is how far behind, never below zero. Somebody who has paid
	// ahead is not in negative arrears — they are ahead, which is Ahead.
	ArrearsMinor int64 `json:"arrearsMinor"`
	// AheadMinor is how far ahead of schedule, which a church wants to see and
	// which a single signed "balance" would hide inside the same number.
	AheadMinor int64 `json:"aheadMinor"`
	// RemainingMinor is what is still to come on the whole promise.
	RemainingMinor int64 `json:"remainingMinor"`
	// Percent is fulfilment of the WHOLE pledge, capped at 100.
	Percent int `json:"percent"`
	// Behind is the flag a church acts on. Deliberately not called "overdue":
	// a pledge is a promise, not a debt, and the word a product uses shapes
	// how a church treats the person.
	Behind bool `json:"behind"`
	// Complete is true when the whole promise has been met.
	Complete bool `json:"complete"`
	// NextDueAt is when the next instalment falls, zero when none remain.
	NextDueAt *time.Time `json:"nextDueAt,omitempty"`
	Currency  string     `json:"currency"`
}

// progressOf computes a pledge's position at a moment.
func progressOf(p *Pledge, paid int64, at time.Time) PledgeProgress {
	out := PledgeProgress{
		Pledge: p, PaidMinor: paid,
		DueMinor: p.DueBy(at), Currency: p.Currency,
	}
	if out.DueMinor > paid {
		out.ArrearsMinor = out.DueMinor - paid
		out.Behind = true
	} else {
		out.AheadMinor = paid - out.DueMinor
	}

	out.RemainingMinor = p.TotalMinor - paid
	if out.RemainingMinor < 0 {
		out.RemainingMinor = 0
	}
	out.Complete = paid >= p.TotalMinor
	if out.Complete {
		// A completed pledge is never behind, whatever the schedule says. A
		// member who paid the whole thing early and then sees "behind" beside
		// their name has been told something false.
		out.Behind, out.ArrearsMinor = false, 0
	}

	if p.TotalMinor > 0 {
		pct := int(paid * 100 / p.TotalMinor)
		if pct > 100 {
			pct = 100
		}
		out.Percent = pct
	}

	if !out.Complete && !p.Cancelled && p.Frequency != FrequencyOneOff {
		for i := 0; i < p.Instalments; i++ {
			if due := p.Frequency.step(p.StartDate, i); due.After(at) {
				next := due
				out.NextDueAt = &next
				break
			}
		}
	}
	return out
}

// Total renders the promise as money.
func (p *Pledge) Total() money.Amount {
	currency := p.Currency
	if currency == "" {
		currency = "GHS"
	}
	return money.Amount{Minor: p.TotalMinor, Currency: currency}
}

// PledgeInput is a pledge as submitted.
type PledgeInput struct {
	MemberID    string
	CampaignID  string
	TotalMinor  int64
	Currency    string
	Frequency   Frequency
	Instalments int
	StartDate   time.Time
	Note        string
}

func (in PledgeInput) normalise() (PledgeInput, error) {
	out := in
	out.MemberID = strings.TrimSpace(in.MemberID)
	out.Note = strings.TrimSpace(in.Note)

	if out.MemberID == "" {
		return out, ErrPledgeMember
	}
	if out.TotalMinor <= 0 {
		return out, ErrPledgeAmount
	}
	if out.Currency == "" {
		out.Currency = "GHS"
	}
	if out.Frequency == "" {
		out.Frequency = FrequencyMonthly
	}
	if !out.Frequency.Valid() {
		return out, fmt.Errorf("finance: %q is not a recognised frequency", out.Frequency)
	}
	if out.Frequency == FrequencyOneOff {
		out.Instalments = 1
	}
	if out.Instalments <= 0 {
		return out, ErrPledgeSchedule
	}
	// A ceiling, because the instalment loop walks them. Weekly for five years
	// is 260; a thousand is somebody typing into the wrong box.
	if out.Instalments > 520 {
		return out, fmt.Errorf("%w: %d instalments is more than ten years of weekly giving",
			ErrPledgeSchedule, out.Instalments)
	}
	if out.StartDate.IsZero() {
		out.StartDate = time.Now().UTC()
	}
	out.StartDate = out.StartDate.UTC()
	return out, nil
}

// EnsurePledgeIndexes creates what pledges are read by.
func (s *Service) EnsurePledgeIndexes(ctx context.Context) error {
	err := s.pledges.EnsureIndexes(ctx, []mongo.IndexModel{
		{
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "memberId", Value: 1},
				{Key: "createdAt", Value: -1},
			},
			Options: options.Index().SetName("church_pledge_member"),
		},
		{
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "campaignId", Value: 1},
			},
			Options: options.Index().
				SetName("church_pledge_campaign").
				SetPartialFilterExpression(bson.M{"campaignId": bson.M{"$exists": true}}),
		},
	})
	if err != nil {
		return fmt.Errorf("finance: create pledge indexes: %w", err)
	}
	return nil
}

// MakePledge records a promise to give.
func (s *Service) MakePledge(ctx context.Context, in PledgeInput) (*PledgeProgress, error) {
	clean, err := in.normalise()
	if err != nil {
		return nil, err
	}
	scope, _ := tenancy.FromContext(ctx)

	now := s.now().UTC()
	doc := bson.M{
		"memberId":    clean.MemberID,
		"totalMinor":  clean.TotalMinor,
		"currency":    clean.Currency,
		"frequency":   string(clean.Frequency),
		"instalments": clean.Instalments,
		"startDate":   clean.StartDate,
		"createdAt":   now,
		"updatedAt":   now,
	}
	if clean.Note != "" {
		doc["note"] = clean.Note
	}
	if id := strings.TrimSpace(clean.CampaignID); id != "" {
		oid, err := bson.ObjectIDFromHex(id)
		if err != nil {
			return nil, ErrCampaignNotFound
		}
		// The campaign has to exist IN THIS CHURCH. Without the check a pledge
		// could name another church's appeal and quietly inflate it.
		if _, err := s.campaignByID(ctx, oid); err != nil {
			return nil, err
		}
		doc["campaignId"] = mongodb.ID(id)
	}
	if scope.UserID != "" {
		doc["recordedBy"] = mongodb.ID(scope.UserID)
	}

	res, err := s.pledges.InsertOne(ctx, doc)
	if err != nil {
		return nil, fmt.Errorf("finance: record pledge: %w", err)
	}
	return s.pledgeProgress(ctx, res.InsertedID.(bson.ObjectID))
}

// PledgeByID returns one pledge with its progress.
func (s *Service) PledgeByID(ctx context.Context, id string) (*PledgeProgress, error) {
	oid, err := bson.ObjectIDFromHex(strings.TrimSpace(id))
	if err != nil {
		return nil, ErrPledgeNotFound
	}
	return s.pledgeProgress(ctx, oid)
}

func (s *Service) pledgeProgress(ctx context.Context, oid bson.ObjectID) (*PledgeProgress, error) {
	var p Pledge
	err := s.pledges.FindOne(ctx, bson.M{"_id": oid}, &p)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrPledgeNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("finance: read pledge: %w", err)
	}

	paid, err := s.paidTowards(ctx, []Pledge{p})
	if err != nil {
		return nil, err
	}
	out := progressOf(&p, paid[p.ID.Hex()], s.now().UTC())
	return &out, nil
}

// Pledges lists a church's promises with their progress.
func (s *Service) Pledges(ctx context.Context, memberID string, behindOnly bool) ([]PledgeProgress, error) {
	filter := bson.M{}
	if memberID = strings.TrimSpace(memberID); memberID != "" {
		filter["memberId"] = memberID
	}

	var pledges []Pledge
	err := s.pledges.Find(ctx, filter, &pledges,
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetLimit(500))
	if err != nil {
		return nil, fmt.Errorf("finance: list pledges: %w", err)
	}
	if len(pledges) == 0 {
		return []PledgeProgress{}, nil
	}

	// One aggregation for every pledge rather than one per pledge. A church
	// with three hundred pledges should not cost three hundred round trips to
	// draw an arrears report.
	paid, err := s.paidTowards(ctx, pledges)
	if err != nil {
		return nil, err
	}

	now := s.now().UTC()
	out := make([]PledgeProgress, 0, len(pledges))
	for i := range pledges {
		progress := progressOf(&pledges[i], paid[pledges[i].ID.Hex()], now)
		if behindOnly && !progress.Behind {
			continue
		}
		out = append(out, progress)
	}
	return out, nil
}

// paidTowards sums completed giving attributed to each pledge.
//
// Matched on the MEMBER and the pledge's campaign, not on a pledge reference,
// because a member giving by mobile money does not tag their gift with a pledge
// id — they just give. Attributing by member and campaign is what makes the
// tracking work against how people actually pay, and it is the reason a pledge
// carries a campaign at all.
//
// The consequence, stated rather than hidden: a member with TWO pledges against
// the same campaign has their giving counted towards both. That is a real
// limitation. It is preferable to the alternative, which is a tracker that
// shows every faithful giver as being in arrears because their gifts carried no
// reference.
func (s *Service) paidTowards(ctx context.Context, pledges []Pledge) (map[string]int64, error) {
	out := make(map[string]int64, len(pledges))
	if len(pledges) == 0 {
		return out, nil
	}

	members := map[string]bool{}
	for i := range pledges {
		members[pledges[i].MemberID] = true
	}
	any := make(bson.A, 0, len(members)*2)
	for id := range members {
		any = append(any, id)
		if oid, err := bson.ObjectIDFromHex(id); err == nil {
			// Both storage forms (ADR-005). Matching one silently halves a
			// member's giving and reports them as behind when they are not.
			any = append(any, oid)
		}
	}

	var rows []struct {
		Key struct {
			MemberID   mongodb.ID `bson:"memberId"`
			CampaignID mongodb.ID `bson:"campaignId"`
		} `bson:"_id"`
		Total int64 `bson:"total"`
	}
	err := s.coll.Aggregate(ctx, []bson.M{
		{"$match": bson.M{
			"memberId":  bson.M{"$in": any},
			"status":    string(StatusSuccess),
			"direction": string(DirectionIncome),
		}},
		{"$group": bson.M{
			"_id": bson.M{"memberId": "$memberId", "campaignId": "$campaignId"},
			// GROSS. A member who gave GHS 100 towards their pledge gave GHS
			// 100; the platform's commission is not their shortfall.
			"total": bson.M{"$sum": "$grossMinor"},
		}},
	}, &rows)
	if err != nil {
		return nil, fmt.Errorf("finance: sum pledge giving: %w", err)
	}

	for i := range pledges {
		p := &pledges[i]
		for _, row := range rows {
			if row.Key.MemberID.String() != p.MemberID {
				continue
			}
			// A pledge against a campaign counts only giving to that campaign.
			// A general pledge counts giving that carries no campaign at all,
			// so a member's building-fund gifts do not silently satisfy their
			// general promise as well.
			if p.CampaignID.String() != row.Key.CampaignID.String() {
				continue
			}
			out[p.ID.Hex()] += row.Total
		}
	}
	return out, nil
}

// CancelPledge marks a promise ended.
//
// Cancelled rather than deleted: a church that agreed to release somebody from
// a pledge should still be able to see that it happened, and deleting the row
// makes the giving already made against it look unattributed.
func (s *Service) CancelPledge(ctx context.Context, id, reason string) (*PledgeProgress, error) {
	oid, err := bson.ObjectIDFromHex(strings.TrimSpace(id))
	if err != nil {
		return nil, ErrPledgeNotFound
	}
	set := bson.M{"cancelled": true}
	if reason = strings.TrimSpace(reason); reason != "" {
		set["cancelReason"] = reason
	}
	res, err := s.pledges.UpdateOne(ctx, bson.M{"_id": oid}, bson.M{"$set": set})
	if err != nil {
		return nil, fmt.Errorf("finance: cancel pledge: %w", err)
	}
	if res.MatchedCount == 0 {
		return nil, ErrPledgeNotFound
	}
	return s.pledgeProgress(ctx, oid)
}
