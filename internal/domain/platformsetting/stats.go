package platformsetting

import (
	"context"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// Stats is the platform-wide view an operator sees.
//
// Every count here crosses tenants by definition, which makes this the one
// place in the product that deliberately reads OUTSIDE the tenant wrapper. That
// is why it lives behind a SUPER_ADMIN role check rather than a permission: no
// church-grantable permission should ever return a number that includes another
// church's data, and a permission is exactly the thing a church can grant
// itself under ADR-008.
type Stats struct {
	TotalChurches  int64 `json:"totalChurches"`
	ActiveChurches int64 `json:"activeChurches"`
	TotalUsers     int64 `json:"totalUsers"`
	ActiveUsers    int64 `json:"activeUsers"`
	TotalMembers   int64 `json:"totalMembers"`
	// TotalRevenue is the platform's own earnings — the sum of the commission
	// retained on completed gifts, in minor units.
	//
	// NOT the sum of what churches received. Under ADR-002 the platform never
	// holds those funds and they are not its revenue; reporting them here would
	// put a number on an operator's dashboard that is roughly fifty times the
	// real one and that nobody could reconcile against a bank statement.
	TotalRevenue int64 `json:"totalRevenue"`
	// RevenueCurrency names what TotalRevenue is denominated in, and is empty
	// when churches settle in more than one. A single figure summed across
	// currencies is meaningless, so it is reported as zero with no currency
	// rather than as a plausible wrong number.
	RevenueCurrency string `json:"revenueCurrency,omitempty"`
	// GeneratedAt is when this was computed. These are live counts over the
	// whole platform, so an operator refreshing twice and seeing different
	// numbers should be able to tell that from a bug.
	GeneratedAt time.Time `json:"generatedAt"`
}

// activeUserWindow is how recently a user must have signed in to count as
// active.
//
// Thirty days rather than "isActive", because those answer different questions.
// `isActive` is whether an account has been disabled — an administrative flag
// that stays true forever for somebody who signed up once and never returned.
// An operator asking "how many active users" means engagement, and counting
// the flag would report every account ever created as active.
const activeUserWindow = 30 * 24 * time.Hour

// StatsFor computes the platform-wide counts.
//
// Deliberately several small counts rather than one aggregation pipeline: the
// counts are over different collections, they are each index-backed, and a
// pipeline that joined them would need $lookup — which the tenant wrapper
// forbids for good reason and which this would have to bypass.
func (s *Service) StatsFor(ctx context.Context, db *mongodb.DB) (*Stats, error) {
	out := &Stats{GeneratedAt: s.now().UTC()}

	counts := []struct {
		name       string
		collection string
		filter     bson.M
		into       *int64
	}{
		{"churches", "churches", bson.M{}, &out.TotalChurches},
		{"active churches", "churches", bson.M{"isActive": true}, &out.ActiveChurches},
		{"users", "users", bson.M{}, &out.TotalUsers},
		{"members", "members", bson.M{}, &out.TotalMembers},
		{"active users", "users", bson.M{
			"lastLoginAt": bson.M{"$gte": out.GeneratedAt.Add(-activeUserWindow)},
		}, &out.ActiveUsers},
	}

	for _, c := range counts {
		// Global(), not Tenant(): these are cross-tenant by definition, and the
		// wrapper would refuse them for exactly the reason it exists. Making
		// the exception explicit here is the point — it is visible in review
		// rather than hidden behind a helper.
		n, err := db.Global(c.collection).CountDocuments(ctx, c.filter)
		if err != nil {
			return nil, fmt.Errorf("platformsetting: count %s: %w", c.name, err)
		}
		*c.into = n
	}

	revenue, currency, err := platformRevenue(ctx, db.Global("transactions"))
	if err != nil {
		return nil, err
	}
	out.TotalRevenue, out.RevenueCurrency = revenue, currency
	return out, nil
}

// platformRevenue sums the commission retained on completed gifts.
//
// Grouped BY CURRENCY rather than summed across them. A platform operating in
// Ghana and Nigeria would otherwise see cedis and naira added together into a
// number that is not money in any currency — and it would look plausible, which
// is the failure mode worth avoiding. When more than one currency is present
// the total is reported as zero with no currency, so the dashboard says "we
// cannot express this as one figure" rather than showing a wrong one.
func platformRevenue(ctx context.Context, transactions *mongo.Collection) (int64, string, error) {
	cursor, err := transactions.Aggregate(ctx, []bson.M{
		{"$match": bson.M{
			"status":    "completed",
			"direction": "income",
		}},
		{"$group": bson.M{
			"_id":   "$currency",
			"total": bson.M{"$sum": "$platformFeeMinor"},
		}},
	})
	if err != nil {
		return 0, "", fmt.Errorf("platformsetting: sum revenue: %w", err)
	}

	var rows []struct {
		Currency string `bson:"_id"`
		Total    int64  `bson:"total"`
	}
	if err := cursor.All(ctx, &rows); err != nil {
		return 0, "", fmt.Errorf("platformsetting: read revenue: %w", err)
	}

	switch len(rows) {
	case 0:
		return 0, "", nil
	case 1:
		return rows[0].Total, rows[0].Currency, nil
	default:
		return 0, "", nil
	}
}
