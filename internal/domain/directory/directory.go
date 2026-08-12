package directory

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	churchdomain "github.com/hayfordstanley/altar-os/internal/domain/church"
	"github.com/hayfordstanley/altar-os/internal/domain/finance"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// The public directory on ALTAR OS's own marketing site.
//
// This is the ONLY place in the product that reads across churches and serves
// the result to an anonymous visitor. Everything else is tenant-scoped by a
// collection that refuses to build a query without a church id; here that
// protection is deliberately absent, because listing churches is the feature.
//
// So the safety has to come from somewhere else, and it is built into the shape
// rather than remembered at each call site:
//
//  1. Two OPT-INS, never one. A church opts into being listed at all; a
//     campaign opts into being listed separately. Being on the directory is a
//     decision about a church's public identity, and having an appeal on it is
//     a decision about that appeal. One must never imply the other.
//  2. The response types list their fields EXPLICITLY. Nothing here embeds a
//     Church or a Campaign, so a field added to either of those cannot appear
//     on a public marketing page because somebody forgot this file existed.
//  3. The opt-in is in the QUERY, not a filter applied afterwards. A query that
//     fetched everything and dropped the non-consenting rows is one refactor
//     away from forgetting the second half, and the failure is a church's
//     private appeal on a software company's homepage.

// ErrNotListed means the church has not opted into the directory.
var ErrNotListed = errors.New("directory: that church is not listed")

// Church is what an opted-in church shows the public.
//
// The fields are the ones a visitor needs to find a church and get in touch:
// what it is called, where it is, and how to reach it. There is deliberately no
// member count, no giving total, and no leadership names — a church choosing to
// be findable has not thereby agreed to be profiled.
type Church struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Slug    string `json:"slug"`
	City    string `json:"city,omitempty"`
	Country string `json:"country,omitempty"`
	// Website is the church's own public site, when it has one on this
	// platform. The point of the directory is to send people TO the church.
	Website string `json:"website,omitempty"`
}

// Campaign is an appeal a church chose to list here.
//
// Not the finance.Campaign. That carries `createdBy`, `publishedBy`, the
// church's internal id and the raised total, none of which belong on a public
// marketing page — and embedding it would put every future field there too.
type Campaign struct {
	ID            string    `json:"id"`
	Title         string    `json:"title"`
	Description   string    `json:"description,omitempty"`
	CoverImageURL string    `json:"coverImageUrl,omitempty"`
	TargetAmount  int64     `json:"targetAmount"`
	Currency      string    `json:"currency"`
	EndDate       time.Time `json:"endDate"`

	// ChurchName and ChurchSlug say whose appeal this is. A fundraising
	// appeal with no church attached is indistinguishable from a scam.
	ChurchName string `json:"churchName"`
	ChurchSlug string `json:"churchSlug,omitempty"`

	// Omitted entirely unless the church turned its thermometer on. Absent
	// rather than zero, because "GHS 0 raised" on a public page says something
	// about a church that a missing figure does not.
	CurrentAmount *int64 `json:"currentAmount,omitempty"`
	Progress      *int   `json:"progress,omitempty"`
}

// Service reads the directory.
//
// It holds GLOBAL collection handles — the visible exception to tenancy that
// this package exists to be. Nothing else in the domain layer should acquire
// one for this purpose.
type Service struct {
	churches  *mongo.Collection
	campaigns *mongo.Collection
	baseHost  string
}

// NewService builds the directory reader.
//
// baseHost is the domain church sites are served from, used to build the link
// back to a church's own site. Empty simply omits the link rather than
// producing a URL that goes nowhere.
func NewService(db *mongodb.DB, baseHost string) *Service {
	return &Service{
		churches:  db.Global(churchdomain.CollectionChurches),
		campaigns: db.Global(finance.CampaignCollection),
		baseHost:  strings.TrimSpace(baseHost),
	}
}

// maxResults bounds a public listing.
//
// A public, unauthenticated, cross-tenant query is the cheapest thing on this
// platform for a stranger to ask for repeatedly. It is bounded here as well as
// rate-limited at the edge.
const maxResults = 60

// listedChurchFilter is the church opt-in, in one place.
//
// A function rather than a copied literal so the two queries below cannot drift
// apart — and if they did, the one that drifted would be publishing churches
// that never agreed to it.
func listedChurchFilter() bson.M {
	return bson.M{
		"listedInDirectory": true,
		// A suspended or deleted church must not stay on our marketing site.
		"isActive":  bson.M{"$ne": false},
		"deletedAt": bson.M{"$exists": false},
	}
}

// Churches lists the churches that opted in.
func (s *Service) Churches(ctx context.Context) ([]Church, error) {
	cursor, err := s.churches.Find(ctx, listedChurchFilter(),
		options.Find().SetSort(bson.D{{Key: "name", Value: 1}}).SetLimit(maxResults))
	if err != nil {
		return nil, fmt.Errorf("directory: list churches: %w", err)
	}
	var found []churchdomain.Church
	if err := cursor.All(ctx, &found); err != nil {
		return nil, fmt.Errorf("directory: read churches: %w", err)
	}

	out := make([]Church, 0, len(found))
	for i := range found {
		out = append(out, s.viewChurch(&found[i]))
	}
	return out, nil
}

func (s *Service) viewChurch(c *churchdomain.Church) Church {
	view := Church{
		ID: c.ID.Hex(), Name: c.Name, Slug: c.Slug,
		City: c.City, Country: c.Country,
	}
	if s.baseHost != "" && c.Slug != "" {
		view.Website = fmt.Sprintf("https://%s.%s", c.Slug, s.baseHost)
	}
	return view
}

// Campaigns lists the appeals churches chose to show here.
//
// BOTH conditions are required and both are in the query. `listedInDirectory`
// is the church's choice to put this appeal on our site; `visibility: public`
// is its choice to publish the appeal at all. An appeal that is listed but not
// public was never announced anywhere, and one that is public but not listed
// belongs on the church's own site and nowhere else.
func (s *Service) Campaigns(ctx context.Context, now time.Time) ([]Campaign, error) {
	cursor, err := s.campaigns.Find(ctx, bson.M{
		"listedInDirectory": true,
		"visibility":        string(finance.VisibilityPublic),
		"isActive":          true,
		// A finished appeal on a marketing page collects gifts toward
		// something that closed.
		"endDate": bson.M{"$gte": now},
	}, options.Find().SetSort(bson.D{{Key: "publishedAt", Value: -1}}).SetLimit(maxResults))
	if err != nil {
		return nil, fmt.Errorf("directory: list campaigns: %w", err)
	}
	var found []finance.Campaign
	if err := cursor.All(ctx, &found); err != nil {
		return nil, fmt.Errorf("directory: read campaigns: %w", err)
	}
	if len(found) == 0 {
		return []Campaign{}, nil
	}

	// The CHURCH opt-in is checked again here, against the churches that
	// actually consented. A campaign carrying listedInDirectory from a church
	// that has since left the directory would otherwise stay on our homepage
	// — the appeal's flag says nothing about the church's current choice.
	listed, err := s.listedChurchesByID(ctx)
	if err != nil {
		return nil, err
	}

	out := make([]Campaign, 0, len(found))
	for i := range found {
		c := &found[i]
		owner, ok := listed[c.ChurchID.String()]
		if !ok {
			continue
		}
		view := Campaign{
			ID: c.ID.Hex(), Title: c.Title, Description: c.Description,
			CoverImageURL: c.CoverImageURL, TargetAmount: c.TargetAmount,
			Currency: c.Currency, EndDate: c.EndDate,
			ChurchName: owner.Name, ChurchSlug: owner.Slug,
		}
		if view.Currency == "" {
			view.Currency = "GHS"
		}
		if c.ShowProgress {
			raised, progress := c.CurrentAmount, c.Progress()
			view.CurrentAmount, view.Progress = &raised, &progress
		}
		out = append(out, view)
	}
	return out, nil
}

// listedChurchesByID is the set of churches currently in the directory.
func (s *Service) listedChurchesByID(ctx context.Context) (map[string]Church, error) {
	cursor, err := s.churches.Find(ctx, listedChurchFilter())
	if err != nil {
		return nil, fmt.Errorf("directory: list churches: %w", err)
	}
	var found []churchdomain.Church
	if err := cursor.All(ctx, &found); err != nil {
		return nil, fmt.Errorf("directory: read churches: %w", err)
	}
	out := make(map[string]Church, len(found))
	for i := range found {
		out[found[i].ID.Hex()] = s.viewChurch(&found[i])
	}
	return out, nil
}

// SetListed records a church's decision about being in the directory.
//
// Takes the church id explicitly rather than reading a scope, because it is
// called from a tenant-scoped handler that has already established WHICH church
// is speaking — and because a cross-tenant collection with an implicit subject
// is how one church ends up editing another's listing.
func (s *Service) SetListed(ctx context.Context, churchID string, listed bool) error {
	oid, err := bson.ObjectIDFromHex(strings.TrimSpace(churchID))
	if err != nil {
		return ErrNotListed
	}
	set := bson.M{"listedInDirectory": listed, "updatedAt": time.Now().UTC()}
	res, err := s.churches.UpdateOne(ctx, bson.M{"_id": oid}, bson.M{"$set": set})
	if err != nil {
		return fmt.Errorf("directory: set listing: %w", err)
	}
	if res.MatchedCount == 0 {
		return ErrNotListed
	}
	return nil
}

// Listed reports whether a church is in the directory.
func (s *Service) Listed(ctx context.Context, churchID string) (bool, error) {
	oid, err := bson.ObjectIDFromHex(strings.TrimSpace(churchID))
	if err != nil {
		return false, ErrNotListed
	}
	var found churchdomain.Church
	if err := s.churches.FindOne(ctx, bson.M{"_id": oid}).Decode(&found); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return false, ErrNotListed
		}
		return false, fmt.Errorf("directory: read listing: %w", err)
	}
	return found.ListedInDirectory, nil
}
