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

// Giving campaigns — a building fund, a missions drive, a roof appeal (PDF
// §5.4). Ported from the legacy TypeScript API as part of WP-20.
//
// The field names here are the ones already in MongoDB and in
// `@altar-os/shared-types` — `title`, `targetAmount`, `isActive`. The dashboard
// currently asks for `name`, `goalAmount` and `status`, which nothing has ever
// served; that mismatch is why the page showed nothing even when the legacy API
// was running. Serving the stored contract rather than inventing a third one is
// the only option that leaves a single truth.

// CampaignCollection holds giving campaigns. Singular and capitalised in the
// legacy Mongoose model's own pluralisation ("Campaign" -> "campaigns").
const CampaignCollection = "campaigns"

var (
	// ErrCampaignNotFound means no such campaign in this church.
	ErrCampaignNotFound = errors.New("finance: campaign not found")
	// ErrCampaignTitle means a campaign was submitted without a title.
	ErrCampaignTitle = errors.New("finance: a campaign needs a title")
	// ErrCampaignTarget means the target is not a usable amount.
	ErrCampaignTarget = errors.New("finance: a campaign needs a target above zero")
	// ErrCampaignDates means the campaign ends before it starts.
	ErrCampaignDates = errors.New("finance: a campaign must end after it starts")
)

// Campaign is a fundraising appeal.
type Campaign struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`

	Title       string `bson:"title"                 json:"title"`
	Description string `bson:"description,omitempty" json:"description,omitempty"`

	// TargetAmount is in MINOR units, like every other amount in this domain.
	//
	// The legacy Mongoose schema declares it as a bare Number with no stated
	// unit, which is the ambiguity that produces a campaign showing GHS 50,000
	// as GHS 500. Minor units everywhere is the rule the rest of finance
	// already follows, and `currency` is stored beside it so the figure is
	// never a naked number.
	TargetAmount int64  `bson:"targetAmount" json:"targetAmount"`
	Currency     string `bson:"currency,omitempty" json:"currency"`

	StartDate time.Time `bson:"startDate" json:"startDate"`
	EndDate   time.Time `bson:"endDate"   json:"endDate"`
	IsActive  bool      `bson:"isActive"  json:"isActive"`

	// CurrentAmount is NOT stored. It is summed from completed giving on every
	// read, and the json tag is here so it appears in responses.
	//
	// A stored running total is the field that drifts: a refunded gift, a
	// webhook replayed after a crash, or a transaction edited by hand all leave
	// it wrong with nothing to reconcile against — and a fundraising thermometer
	// that overstates a total is a thing a congregation notices.
	CurrentAmount int64 `bson:"-" json:"currentAmount"`

	CreatedBy mongodb.ID `bson:"createdBy,omitempty" json:"createdBy,omitempty"`
	CreatedAt time.Time  `bson:"createdAt" json:"createdAt"`
	UpdatedAt time.Time  `bson:"updatedAt" json:"updatedAt"`
}

// Progress is how far along the campaign is, as a percentage, capped at 100.
//
// Capped because a campaign that raises more than its target is a good day, not
// a 137%-full progress bar — and uncapped values break every UI that assumes a
// fraction.
func (c *Campaign) Progress() int {
	if c == nil || c.TargetAmount <= 0 {
		return 0
	}
	pct := int(c.CurrentAmount * 100 / c.TargetAmount)
	if pct > 100 {
		return 100
	}
	return pct
}

// CampaignInput is a campaign as submitted.
type CampaignInput struct {
	Title        string
	Description  string
	TargetAmount int64
	Currency     string
	StartDate    time.Time
	EndDate      time.Time
	IsActive     *bool
}

func (in CampaignInput) normalise() (CampaignInput, error) {
	out := in
	out.Title = strings.TrimSpace(in.Title)
	out.Description = strings.TrimSpace(in.Description)
	if out.Title == "" {
		return out, ErrCampaignTitle
	}
	if out.TargetAmount <= 0 {
		return out, ErrCampaignTarget
	}
	if out.Currency == "" {
		out.Currency = "GHS"
	}
	if out.StartDate.IsZero() {
		out.StartDate = time.Now().UTC()
	}
	if out.EndDate.IsZero() {
		// A campaign with no stated end runs for a quarter. Zero would render
		// as 1 January year 1 and sort every campaign to the top.
		out.EndDate = out.StartDate.AddDate(0, 3, 0)
	}
	if !out.EndDate.After(out.StartDate) {
		return out, ErrCampaignDates
	}
	out.StartDate, out.EndDate = out.StartDate.UTC(), out.EndDate.UTC()
	return out, nil
}

// EnsureCampaignIndexes creates what campaigns are read by.
func (s *Service) EnsureCampaignIndexes(ctx context.Context) error {
	err := s.campaigns.EnsureIndexes(ctx, []mongo.IndexModel{
		{
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "isActive", Value: 1},
				{Key: "endDate", Value: -1},
			},
			Options: options.Index().SetName("church_campaign_active"),
		},
	})
	if err != nil {
		return fmt.Errorf("finance: create campaign indexes: %w", err)
	}
	return nil
}

// CreateCampaign starts a fundraising appeal.
func (s *Service) CreateCampaign(ctx context.Context, in CampaignInput) (*Campaign, error) {
	clean, err := in.normalise()
	if err != nil {
		return nil, err
	}
	scope, _ := tenancy.FromContext(ctx)

	active := true
	if clean.IsActive != nil {
		active = *clean.IsActive
	}
	doc := bson.M{
		"title":        clean.Title,
		"targetAmount": clean.TargetAmount,
		"currency":     clean.Currency,
		"startDate":    clean.StartDate,
		"endDate":      clean.EndDate,
		"isActive":     active,
		// Written so the legacy Mongoose schema, which declares it with a
		// default of 0, still reads a valid document during the migration.
		// Nothing in Go reads it — CurrentAmount is always summed.
		"currentAmount": int64(0),
	}
	if clean.Description != "" {
		doc["description"] = clean.Description
	}
	if scope.UserID != "" {
		doc["createdBy"] = mongodb.ID(scope.UserID)
	}

	res, err := s.campaigns.InsertOne(ctx, doc)
	if err != nil {
		return nil, fmt.Errorf("finance: create campaign: %w", err)
	}
	return s.campaignByID(ctx, res.InsertedID.(bson.ObjectID))
}

// Campaigns lists a church's appeals, newest first.
func (s *Service) Campaigns(ctx context.Context, activeOnly bool) ([]Campaign, error) {
	filter := bson.M{}
	if activeOnly {
		filter["isActive"] = true
	}

	out := []Campaign{}
	err := s.campaigns.Find(ctx, filter, &out,
		options.Find().SetSort(bson.D{{Key: "startDate", Value: -1}}).SetLimit(200))
	if err != nil {
		return nil, fmt.Errorf("finance: list campaigns: %w", err)
	}
	if len(out) == 0 {
		return out, nil
	}

	// One aggregation for every campaign rather than one per campaign. A
	// church with thirty appeals should not cost thirty round trips to draw a
	// list of progress bars.
	ids := make([]bson.ObjectID, 0, len(out))
	for i := range out {
		ids = append(ids, out[i].ID)
	}
	raised, err := s.raisedByCampaign(ctx, ids)
	if err != nil {
		return nil, err
	}
	for i := range out {
		out[i].CurrentAmount = raised[out[i].ID.Hex()]
	}
	return out, nil
}

// CampaignByID returns one appeal within the caller's church.
func (s *Service) CampaignByID(ctx context.Context, id string) (*Campaign, error) {
	oid, err := bson.ObjectIDFromHex(strings.TrimSpace(id))
	if err != nil {
		return nil, ErrCampaignNotFound
	}
	return s.campaignByID(ctx, oid)
}

func (s *Service) campaignByID(ctx context.Context, oid bson.ObjectID) (*Campaign, error) {
	var found Campaign
	err := s.campaigns.FindOne(ctx, bson.M{"_id": oid}, &found)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrCampaignNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("finance: read campaign: %w", err)
	}

	raised, err := s.raisedByCampaign(ctx, []bson.ObjectID{oid})
	if err != nil {
		return nil, err
	}
	found.CurrentAmount = raised[oid.Hex()]
	return &found, nil
}

// UpdateCampaign edits an appeal.
func (s *Service) UpdateCampaign(ctx context.Context, id string, in CampaignInput) (*Campaign, error) {
	existing, err := s.CampaignByID(ctx, id)
	if err != nil {
		return nil, err
	}
	clean, err := in.normalise()
	if err != nil {
		return nil, err
	}

	set := bson.M{
		"title":        clean.Title,
		"targetAmount": clean.TargetAmount,
		"currency":     clean.Currency,
		"startDate":    clean.StartDate,
		"endDate":      clean.EndDate,
	}
	if clean.IsActive != nil {
		set["isActive"] = *clean.IsActive
	}
	update := bson.M{"$set": set}
	if clean.Description != "" {
		set["description"] = clean.Description
	} else {
		update["$unset"] = bson.M{"description": ""}
	}

	if _, err := s.campaigns.UpdateOne(ctx, bson.M{"_id": existing.ID}, update); err != nil {
		return nil, fmt.Errorf("finance: update campaign: %w", err)
	}
	return s.campaignByID(ctx, existing.ID)
}

// CloseCampaign marks an appeal finished.
//
// Closed rather than deleted, and there is no delete at all. A campaign has
// giving attached to it: removing the campaign would leave those transactions
// pointing at nothing, and a church's ledger would show income against a fund
// that no longer exists. Closing keeps the history readable.
func (s *Service) CloseCampaign(ctx context.Context, id string) (*Campaign, error) {
	existing, err := s.CampaignByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if _, err := s.campaigns.UpdateOne(ctx, bson.M{"_id": existing.ID},
		bson.M{"$set": bson.M{"isActive": false}}); err != nil {
		return nil, fmt.Errorf("finance: close campaign: %w", err)
	}
	return s.campaignByID(ctx, existing.ID)
}

// raisedByCampaign sums COMPLETED giving against each campaign.
//
// Completed only. Counting pending transactions would let somebody move a
// fundraising thermometer by starting a payment and abandoning it, which is
// both wrong and trivially abusable on a public page.
func (s *Service) raisedByCampaign(ctx context.Context, ids []bson.ObjectID) (map[string]int64, error) {
	out := make(map[string]int64, len(ids))
	if len(ids) == 0 {
		return out, nil
	}

	// Both id forms, because Mongoose writes campaignId as an ObjectId and a
	// Go-written document may carry a string (ADR-005). Matching one form
	// silently halves a campaign's total.
	any := make(bson.A, 0, len(ids)*2)
	for _, id := range ids {
		any = append(any, id, id.Hex())
	}

	var rows []struct {
		CampaignID mongodb.ID `bson:"_id"`
		Total      int64      `bson:"total"`
	}
	err := s.coll.Aggregate(ctx, []bson.M{
		{"$match": bson.M{
			"campaignId": bson.M{"$in": any},
			"status":     string(StatusSuccess),
			"direction":  string(DirectionIncome),
		}},
		// The GROSS gift, not the net. A giver who gave GHS 100 to the building
		// fund gave GHS 100 to it; the platform's commission and the provider's
		// fee are costs of collection, and netting them off would show a
		// congregation a smaller number than the sum of what they each gave.
		{"$group": bson.M{"_id": "$campaignId", "total": bson.M{"$sum": "$grossMinor"}}},
	}, &rows)
	if err != nil {
		return nil, fmt.Errorf("finance: sum campaign giving: %w", err)
	}

	for _, r := range rows {
		out[r.CampaignID.String()] = r.Total
	}
	return out, nil
}

// TotalRaised is the money value of a campaign's giving, for display.
func (c *Campaign) TotalRaised() money.Amount {
	currency := c.Currency
	if currency == "" {
		currency = "GHS"
	}
	return money.Amount{Minor: c.CurrentAmount, Currency: currency}
}
