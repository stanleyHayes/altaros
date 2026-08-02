package finance

import (
	"context"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/platform/money"
)

// Query filters a ledger read.
type Query struct {
	MemberID string
	// OwnerID is for the signed-in member's private history. It includes old
	// attributed rows and new anonymous rows privately linked by initiatedBy.
	OwnerID    string
	Type       Type
	Status     Status
	Direction  Direction
	CampaignID string
	From, To   time.Time
	Limit      int64
}

func (q Query) filter() bson.M {
	f := bson.M{}
	if q.OwnerID != "" {
		f["$or"] = bson.A{
			bson.M{"memberId": q.OwnerID},
			bson.M{"initiatedBy": q.OwnerID},
		}
	}
	if q.MemberID != "" {
		f["memberId"] = q.MemberID
	}
	if q.Type != "" {
		f["type"] = string(q.Type)
	}
	if q.Status != "" {
		f["status"] = string(q.Status)
	}
	if q.Direction != "" {
		f["direction"] = string(q.Direction)
	}
	if q.CampaignID != "" {
		f["campaignId"] = q.CampaignID
	}
	if !q.From.IsZero() || !q.To.IsZero() {
		window := bson.M{}
		if !q.From.IsZero() {
			window["$gte"] = q.From.UTC()
		}
		if !q.To.IsZero() {
			window["$lt"] = q.To.UTC()
		}
		f["occurredAt"] = window
	}
	return f
}

// List returns transactions newest first.
func (s *Service) List(ctx context.Context, q Query) ([]Transaction, error) {
	limit := q.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	opts := options.Find().
		SetSort(bson.D{{Key: "occurredAt", Value: -1}, {Key: "_id", Value: -1}}).
		SetLimit(limit)

	var out []Transaction
	if err := s.coll.Find(ctx, q.filter(), &out, opts); err != nil {
		return nil, fmt.Errorf("finance: list transactions: %w", err)
	}
	return out, nil
}

// Summary is an aggregate view of a church's money over a window.
type Summary struct {
	Currency string `json:"currency"`
	// Income is the sum of net amounts on successful income. Net, not gross:
	// gross is what the giver was debited, and presenting it as the church's
	// income overstates every figure by the fees.
	Income money.Amount `json:"income"`
	// Gross is what givers were debited, excluding levy.
	Gross money.Amount `json:"gross"`
	// Expenses is the sum of successful outgoings.
	Expenses money.Amount `json:"expenses"`
	// Balance is income less expenses. This is a REPORTING figure computed
	// from the ledger, not a wallet — ALTAR OS holds no funds (ADR-002), and
	// this number is a statement about money that already reached the church.
	Balance money.Amount `json:"balance"`
	// Fees is what was deducted before the church received anything.
	ProviderFees money.Amount `json:"providerFees"`
	PlatformFees money.Amount `json:"platformFees"`
	// Levy is what givers paid on top, which is never the church's income but
	// is what explains the gap between what a member says they gave and what
	// arrived (§2.3).
	Levy  money.Amount `json:"levy"`
	Count int64        `json:"count"`
	// ByType breaks income down by tithe, offering, donation, campaign.
	ByType map[Type]money.Amount `json:"byType"`
}

// Summarize aggregates a church's ledger over a window.
//
// Only successful transactions count. Including pending would let an abandoned
// checkout inflate a church's reported giving, and pending rows outnumber
// successful ones whenever a payment page is opened and closed.
func (s *Service) Summarize(ctx context.Context, from, to time.Time, currency string) (*Summary, error) {
	match := Query{From: from, To: to, Status: StatusSuccess}.filter()
	if currency != "" {
		match["currency"] = currency
	}

	pipeline := []bson.M{
		{"$match": match},
		{"$group": bson.M{
			"_id": bson.M{"direction": "$direction", "type": "$type"},
			"net": bson.M{"$sum": "$netMinor"},
			// Gross is only meaningful on income; expenses have no fee split.
			"gross":       bson.M{"$sum": "$grossMinor"},
			"levy":        bson.M{"$sum": "$levyMinor"},
			"providerFee": bson.M{"$sum": "$providerFeeMinor"},
			"platformFee": bson.M{"$sum": "$platformFeeMinor"},
			"count":       bson.M{"$sum": 1},
		}},
	}

	var rows []struct {
		ID struct {
			Direction string `bson:"direction"`
			Type      string `bson:"type"`
		} `bson:"_id"`
		Net         int64 `bson:"net"`
		Gross       int64 `bson:"gross"`
		Levy        int64 `bson:"levy"`
		ProviderFee int64 `bson:"providerFee"`
		PlatformFee int64 `bson:"platformFee"`
		Count       int64 `bson:"count"`
	}
	if err := s.coll.Aggregate(ctx, pipeline, &rows); err != nil {
		return nil, fmt.Errorf("finance: summarize: %w", err)
	}

	if currency == "" {
		currency = "GHS"
	}
	sum := &Summary{
		Currency:     currency,
		Income:       money.Zero(currency),
		Gross:        money.Zero(currency),
		Expenses:     money.Zero(currency),
		Balance:      money.Zero(currency),
		ProviderFees: money.Zero(currency),
		PlatformFees: money.Zero(currency),
		Levy:         money.Zero(currency),
		ByType:       map[Type]money.Amount{},
	}

	for _, row := range rows {
		sum.Count += row.Count
		if Direction(row.ID.Direction) == DirectionExpense {
			sum.Expenses.Minor += row.Net
			continue
		}
		sum.Income.Minor += row.Net
		sum.Gross.Minor += row.Gross
		sum.Levy.Minor += row.Levy
		sum.ProviderFees.Minor += row.ProviderFee
		sum.PlatformFees.Minor += row.PlatformFee

		t := Type(row.ID.Type)
		existing := sum.ByType[t]
		sum.ByType[t] = money.Amount{Minor: existing.Minor + row.Net, Currency: currency}
	}
	sum.Balance.Minor = sum.Income.Minor - sum.Expenses.Minor
	return sum, nil
}

// MemberGiving is one member's giving over a window, for statements and for
// the giving history a member sees in the app.
type MemberGiving struct {
	MemberID string       `json:"memberId"`
	Total    money.Amount `json:"total"`
	// Debited is what the member actually paid, gift plus levy. This is the
	// figure that matches their own bank or MoMo statement, and the one to
	// lead with — a receipt that disagrees with what left their wallet reads
	// as a mistake even when the church's books are right.
	Debited money.Amount          `json:"debited"`
	Count   int64                 `json:"count"`
	ByType  map[Type]money.Amount `json:"byType"`
	Last    *time.Time            `json:"lastGivenAt,omitempty"`
}

// GivingFor summarises one member's giving.
func (s *Service) GivingFor(ctx context.Context, memberID string, from, to time.Time) (*MemberGiving, error) {
	if memberID == "" {
		return nil, fmt.Errorf("finance: member id is required")
	}

	txs, err := s.List(ctx, Query{
		MemberID:  memberID,
		Status:    StatusSuccess,
		Direction: DirectionIncome,
		From:      from,
		To:        to,
		Limit:     500,
	})
	if err != nil {
		return nil, err
	}

	out := &MemberGiving{MemberID: memberID, ByType: map[Type]money.Amount{}}
	for i := range txs {
		tx := &txs[i]
		if out.Total.Currency == "" {
			out.Total = money.Zero(tx.Currency)
			out.Debited = money.Zero(tx.Currency)
		}
		if tx.Currency != out.Total.Currency {
			// A member who gave in two currencies cannot be summed into one
			// figure; report the primary currency rather than inventing a
			// conversion nobody asked for.
			continue
		}
		out.Total.Minor += tx.GrossMinor
		out.Debited.Minor += tx.GrossMinor + tx.LevyMinor
		out.Count++

		existing := out.ByType[tx.Type]
		out.ByType[tx.Type] = money.Amount{
			Minor:    existing.Minor + tx.GrossMinor,
			Currency: tx.Currency,
		}
		if out.Last == nil || tx.OccurredAt.After(*out.Last) {
			occurred := tx.OccurredAt
			out.Last = &occurred
		}
	}
	return out, nil
}

// GivenTodayMinor is how much a member has transferred today, for quoting the
// E-Levy against its cumulative daily threshold.
//
// Cash is excluded because cash is not an electronic transfer and does not
// consume the allowance.
func (s *Service) GivenTodayMinor(ctx context.Context, memberID string, now time.Time) (int64, error) {
	if memberID == "" {
		return 0, nil
	}
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	var rows []struct {
		Total int64 `bson:"total"`
	}
	err := s.coll.Aggregate(ctx, []bson.M{
		{"$match": bson.M{
			"$or": bson.A{
				bson.M{"memberId": memberID},
				bson.M{"initiatedBy": memberID},
			},
			"status":     string(StatusSuccess),
			"direction":  string(DirectionIncome),
			"channel":    bson.M{"$in": []string{money.ChannelMobileMoney, money.ChannelBankTransfer, money.ChannelUSSD}},
			"occurredAt": bson.M{"$gte": startOfDay.UTC()},
		}},
		{"$group": bson.M{"_id": nil, "total": bson.M{"$sum": "$grossMinor"}}},
	}, &rows)
	if err != nil {
		return 0, fmt.Errorf("finance: daily total: %w", err)
	}
	if len(rows) == 0 {
		return 0, nil
	}
	return rows[0].Total, nil
}

// Count returns how many transactions match a query.
func (s *Service) Count(ctx context.Context, q Query) (int64, error) {
	n, err := s.coll.CountDocuments(ctx, q.filter())
	if err != nil {
		return 0, fmt.Errorf("finance: count transactions: %w", err)
	}
	return n, nil
}
