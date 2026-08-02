package spiritual

import (
	"context"
	"errors"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

type Service struct {
	devotionals *mongodb.TenantCollection
	sermons     *mongodb.TenantCollection
	prayers     *mongodb.TenantCollection
	now         func() time.Time
}

func NewService(db *mongodb.DB) *Service {
	return &Service{db.Tenant(DevotionalCollection), db.Tenant(SermonCollection), db.Tenant(PrayerCollection), time.Now}
}

func (s *Service) EnsureIndexes(ctx context.Context) error {
	if err := s.devotionals.EnsureIndexes(ctx, []mongo.IndexModel{{
		Keys: bson.D{{Key: mongodb.TenantField, Value: 1}, {Key: "date", Value: -1}},
		Options: options.Index().SetName("church_devotional_date"),
	}}); err != nil { return err }
	if err := s.sermons.EnsureIndexes(ctx, []mongo.IndexModel{{
		Keys: bson.D{{Key: mongodb.TenantField, Value: 1}, {Key: "date", Value: -1}},
		Options: options.Index().SetName("church_sermon_date"),
	}}); err != nil { return err }
	return s.prayers.EnsureIndexes(ctx, []mongo.IndexModel{{
		Keys: bson.D{{Key: mongodb.TenantField, Value: 1}, {Key: "createdAt", Value: -1}},
		Options: options.Index().SetName("church_prayer_created"),
	}})
}

func page(page, limit int) (int64, int64) {
	if page < 1 { page = 1 }
	if limit < 1 { limit = 20 }
	if limit > 50 { limit = 50 }
	return int64((page - 1) * limit), int64(limit)
}

func (s *Service) Today(ctx context.Context) (*Devotional, error) {
	start := s.now().UTC().Truncate(24 * time.Hour)
	var out Devotional
	err := s.devotionals.FindOne(ctx, bson.M{"date": bson.M{"$gte": start, "$lt": start.Add(24 * time.Hour)}}, &out)
	if errors.Is(err, mongo.ErrNoDocuments) { return nil, ErrNotFound }
	if err != nil { return nil, err }
	return &out, nil
}

func (s *Service) Devotionals(ctx context.Context, p, l int) ([]Devotional, int64, error) {
	skip, limit := page(p, l)
	var out []Devotional
	if err := s.devotionals.Find(ctx, nil, &out, options.Find().SetSort(bson.D{{Key: "date", Value: -1}}).SetSkip(skip).SetLimit(limit)); err != nil { return nil, 0, err }
	total, err := s.devotionals.CountDocuments(ctx, nil)
	return out, total, err
}

func (s *Service) Sermons(ctx context.Context, p, l int, series string) ([]Sermon, int64, error) {
	skip, limit := page(p, l)
	filter := bson.M{}
	if strings.TrimSpace(series) != "" { filter["series"] = strings.TrimSpace(series) }
	var out []Sermon
	if err := s.sermons.Find(ctx, filter, &out, options.Find().SetSort(bson.D{{Key: "date", Value: -1}}).SetSkip(skip).SetLimit(limit)); err != nil { return nil, 0, err }
	total, err := s.sermons.CountDocuments(ctx, filter)
	return out, total, err
}

func (s *Service) Sermon(ctx context.Context, id string) (*Sermon, error) {
	oid, err := bson.ObjectIDFromHex(id); if err != nil { return nil, ErrNotFound }
	var out Sermon
	err = s.sermons.FindOne(ctx, bson.M{"_id": oid}, &out)
	if errors.Is(err, mongo.ErrNoDocuments) { return nil, ErrNotFound }
	return &out, err
}

func (s *Service) Prayers(ctx context.Context, p, l int) ([]PrayerRequest, int64, error) {
	skip, limit := page(p, l)
	var out []PrayerRequest
	if err := s.prayers.Find(ctx, nil, &out, options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetSkip(skip).SetLimit(limit)); err != nil { return nil, 0, err }
	total, err := s.prayers.CountDocuments(ctx, nil)
	return out, total, err
}

func (s *Service) CreatePrayer(ctx context.Context, in PrayerInput) (*PrayerRequest, error) {
	in.Title, in.Description = strings.TrimSpace(in.Title), strings.TrimSpace(in.Description)
	if in.Title == "" || len(in.Title) > 160 || in.Description == "" || len(in.Description) > 4000 { return nil, ErrInvalidInput }
	if strings.TrimSpace(in.MemberID) == "" { return nil, ErrMemberRequired }
	doc := bson.M{"title": in.Title, "description": in.Description, "isAnonymous": in.IsAnonymous, "memberId": mongodb.ID(in.MemberID), "prayerCount": int64(0), "createdAt": s.now().UTC()}
	if !in.IsAnonymous && strings.TrimSpace(in.AuthorName) != "" { doc["authorName"] = strings.TrimSpace(in.AuthorName) }
	res, err := s.prayers.InsertOne(ctx, doc); if err != nil { return nil, err }
	var out PrayerRequest
	if err := s.prayers.FindOne(ctx, bson.M{"_id": res.InsertedID}, &out); err != nil { return nil, err }
	return &out, nil
}

func (s *Service) Pray(ctx context.Context, id string) (*PrayerRequest, error) {
	oid, err := bson.ObjectIDFromHex(id); if err != nil { return nil, ErrNotFound }
	res, err := s.prayers.UpdateOne(ctx, bson.M{"_id": oid}, bson.M{"$inc": bson.M{"prayerCount": 1}})
	if err != nil { return nil, err }
	if res.MatchedCount == 0 { return nil, ErrNotFound }
	var out PrayerRequest
	if err := s.prayers.FindOne(ctx, bson.M{"_id": oid}, &out); err != nil { return nil, err }
	return &out, nil
}
