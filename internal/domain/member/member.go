// Package member is the church CRM (WP-12).
//
// Two things here go beyond the original spec, both because the spec's model
// would not survive contact with a real congregation:
//
//   - Phone numbers are normalised to E.164 on every write. The same Ghanaian
//     number is written half a dozen ways, and stored verbatim those are half
//     a dozen members.
//   - Status is a journey, not a boolean. The spec has active/inactive;
//     churches think in visitor -> new convert -> member -> leader, and
//     "AI member insights" is only actionable against a real pipeline (§8.8).
package member

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/phone"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// Collection holding member records.
const Collection = "members"

// Status is where someone is in their journey with the church.
type Status string

const (
	StatusVisitor     Status = "visitor"
	StatusNewConvert  Status = "new_convert"
	StatusActive      Status = "active"
	StatusInactive    Status = "inactive"
	StatusTransferred Status = "transferred"
	StatusDeceased    Status = "deceased"
)

// AllStatuses is the full pipeline, in journey order.
var AllStatuses = []Status{
	StatusVisitor, StatusNewConvert, StatusActive,
	StatusInactive, StatusTransferred, StatusDeceased,
}

// Valid reports whether a status is recognised.
func (s Status) Valid() bool {
	for _, known := range AllStatuses {
		if s == known {
			return true
		}
	}
	return false
}

var (
	// ErrNotFound is returned when no member matches.
	ErrNotFound = errors.New("member: not found")
	// ErrNameRequired means a record had no usable name.
	ErrNameRequired = errors.New("member: a first or last name is required")
	// ErrInvalidStatus means an unrecognised status was supplied.
	ErrInvalidStatus = errors.New("member: unrecognised status")
	// ErrDuplicate means a member with that phone already exists in the
	// church.
	ErrDuplicate = errors.New("member: a member with that phone number already exists")
)

// Member is one person known to a church.
type Member struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`
	// UserID links to a login account. Empty for a pastoral record of someone
	// who has never signed in — most of a congregation, initially.
	UserID    mongodb.ID `bson:"userId,omitempty" json:"userId,omitempty"`
	FirstName string     `bson:"firstName"     json:"firstName"`
	LastName  string     `bson:"lastName"      json:"lastName"`
	// PhoneE164 is the deduplication key. Always normalised, never as typed.
	PhoneE164   string     `bson:"phoneE164,omitempty" json:"phone,omitempty"`
	Email       string     `bson:"email,omitempty"     json:"email,omitempty"`
	Gender      string     `bson:"gender,omitempty"    json:"gender,omitempty"`
	DateOfBirth *time.Time `bson:"dateOfBirth,omitempty" json:"dateOfBirth,omitempty"`
	// HouseholdID links family members, which the spec calls family linking.
	HouseholdID mongodb.ID `bson:"householdId,omitempty" json:"householdId,omitempty"`
	Status      Status     `bson:"status"        json:"status"`
	JoinedAt    *time.Time `bson:"joinedAt,omitempty" json:"joinedAt,omitempty"`
	CreatedAt   time.Time  `bson:"createdAt"     json:"createdAt"`
	UpdatedAt   time.Time  `bson:"updatedAt"     json:"updatedAt"`
}

// FullName is the display name.
func (m *Member) FullName() string {
	return strings.TrimSpace(m.FirstName + " " + m.LastName)
}

// Publisher emits domain events.
type Publisher interface {
	Publish(ctx context.Context, topic, key string, payload any) error
}

// Event topics.
const (
	TopicMemberCreated       = "altar.member.created.v1"
	TopicMemberStatusChanged = "altar.member.status_changed.v1"
)

// Service is the member CRM.
type Service struct {
	coll *mongodb.TenantCollection
	pub  Publisher
	// defaultCountry resolves domestically-written phone numbers. Taken from
	// the church rather than assumed globally.
	defaultCountry string
}

// NewService builds the member service.
func NewService(db *mongodb.DB, pub Publisher, defaultCountry string) *Service {
	if defaultCountry == "" {
		defaultCountry = "GH"
	}
	return &Service{
		coll:           db.Tenant(Collection),
		pub:            pub,
		defaultCountry: defaultCountry,
	}
}

// EnsureIndexes creates the indexes the CRM depends on.
//
// Per ADR-005 every tenant-scoped compound index leads with churchId. The
// phone index is unique per church — the same person may legitimately belong
// to two churches, but not twice to one.
//
// The optional-field indexes are partial, not sparse. A compound sparse index
// only skips a document when EVERY indexed field is missing, and churchId is
// never missing — so under sparse, every phone-less pastoral record would be
// indexed as null and the second one would collide with the first. Most of a
// congregation has no phone on file initially, so that would break the common
// case rather than an edge case.
func (s *Service) EnsureIndexes(ctx context.Context) error {
	err := s.coll.EnsureIndexes(ctx, []mongo.IndexModel{
		{
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "phoneE164", Value: 1},
			},
			Options: options.Index().
				SetName("church_phone_unique").
				SetUnique(true).
				SetPartialFilterExpression(bson.M{
					"phoneE164": bson.M{"$exists": true},
				}),
		},
		{
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "status", Value: 1},
				{Key: "lastName", Value: 1},
			},
			Options: options.Index().SetName("church_status_name"),
		},
		{
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "householdId", Value: 1},
			},
			Options: options.Index().
				SetName("church_household").
				SetPartialFilterExpression(bson.M{
					"householdId": bson.M{"$exists": true},
				}),
		},
		{
			// The login-account link, read on every request that asks "who am
			// I as a member" — RSVP, my giving, my attendance.
			//
			// UNIQUE, and PARTIAL rather than sparse. Partial because the
			// condition is on one field of a compound key and a sparse index
			// only skips a document when EVERY key field is missing — churchId
			// is always present, so a sparse index here would index every
			// member and make the second login-less record in a church collide
			// with the first.
			//
			// The filter is $type rather than $exists for the same family of
			// reason: `userId: null` EXISTS, so an $exists filter would index
			// every unlinked member as the value null and let exactly one of
			// them be stored.
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "userId", Value: 1},
			},
			Options: options.Index().
				SetName("uq_church_user").
				SetUnique(true).
				SetPartialFilterExpression(bson.M{
					"userId": bson.M{"$type": "objectId"},
				}),
		},
	})
	if err != nil {
		return fmt.Errorf("member: create indexes: %w", err)
	}
	return nil
}

// Input is the data needed to create or update a member.
type Input struct {
	FirstName   string
	LastName    string
	Phone       string // any format; normalised on write
	Email       string
	Gender      string
	Status      Status
	HouseholdID string
}

// Create adds a member.
func (s *Service) Create(ctx context.Context, in Input) (*Member, error) {
	doc, err := s.buildDoc(in)
	if err != nil {
		return nil, err
	}

	res, err := s.coll.InsertOne(ctx, doc)
	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			return nil, ErrDuplicate
		}
		return nil, fmt.Errorf("member: create: %w", err)
	}

	created, err := s.ByID(ctx, res.InsertedID.(bson.ObjectID).Hex())
	if err != nil {
		return nil, err
	}

	if s.pub != nil {
		_ = s.pub.Publish(ctx, TopicMemberCreated, created.ID.Hex(), map[string]any{
			"memberId": created.ID.Hex(),
			"churchId": created.ChurchID.String(),
			"status":   string(created.Status),
		})
	}
	return created, nil
}

func (s *Service) buildDoc(in Input) (bson.M, error) {
	first := strings.TrimSpace(in.FirstName)
	last := strings.TrimSpace(in.LastName)
	if first == "" && last == "" {
		return nil, ErrNameRequired
	}

	status := in.Status
	if status == "" {
		// Someone whose journey has not been recorded is a visitor, not an
		// active member — assuming otherwise inflates every engagement metric.
		status = StatusVisitor
	}
	if !status.Valid() {
		return nil, fmt.Errorf("%w: %q", ErrInvalidStatus, status)
	}

	doc := bson.M{
		"firstName": first,
		"lastName":  last,
		"status":    string(status),
	}

	if raw := strings.TrimSpace(in.Phone); raw != "" {
		normalized, err := phone.Normalize(raw, s.defaultCountry)
		if err != nil {
			return nil, fmt.Errorf("member: phone %q: %w", raw, err)
		}
		doc["phoneE164"] = normalized
	}
	if e := strings.ToLower(strings.TrimSpace(in.Email)); e != "" {
		doc["email"] = e
	}
	if g := strings.TrimSpace(in.Gender); g != "" {
		doc["gender"] = g
	}
	if h := strings.TrimSpace(in.HouseholdID); h != "" {
		doc["householdId"] = h
	}
	return doc, nil
}

// ByID returns one member within the caller's church.
func (s *Service) ByID(ctx context.Context, id string) (*Member, error) {
	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return nil, ErrNotFound
	}
	var m Member
	if err := s.coll.FindOne(ctx, bson.M{"_id": oid}, &m); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("member: lookup: %w", err)
	}
	return &m, nil
}

// ByUserID finds the member record belonging to a login account.
//
// The two ids are genuinely different things and conflating them is a bug
// waiting to happen: most of a congregation has a member record and no login,
// and a handful of staff have a login and no member record. A caller that
// wants "the person signed in" has to cross that gap explicitly, here.
func (s *Service) ByUserID(ctx context.Context, userID string) (*Member, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, ErrNotFound
	}
	var m Member
	if err := s.coll.FindOne(ctx, bson.M{"userId": mongodb.ID(userID)}, &m); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("member: lookup by user: %w", err)
	}
	return &m, nil
}

// Exist reports which of the given ids are members of the caller's church.
//
// One query for a whole list, because the caller is an offline check-in queue
// landing two hundred rows at once and a lookup per row is two hundred round
// trips at the moment the church's wifi has just come back.
//
// An id belonging to another church is simply absent from the answer — the
// collection is tenant-scoped, so this is the check that attendance cannot be
// recorded across a tenant boundary, and it costs nothing extra.
func (s *Service) Exist(ctx context.Context, ids []string) (map[string]bool, error) {
	out := make(map[string]bool, len(ids))
	oids := make([]bson.ObjectID, 0, len(ids))
	for _, id := range ids {
		oid, err := bson.ObjectIDFromHex(id)
		if err != nil {
			// Not an id this database could hold. Absent rather than an error:
			// the caller reports it per row alongside the ids that were simply
			// unknown, which is the same thing from the usher's side.
			continue
		}
		oids = append(oids, oid)
	}
	if len(oids) == 0 {
		return out, nil
	}

	var found []struct {
		ID bson.ObjectID `bson:"_id"`
	}
	err := s.coll.Find(ctx, bson.M{"_id": bson.M{"$in": oids}}, &found,
		// Ids only. The caller is asking an existence question and has no
		// business receiving phone numbers to answer it.
		options.Find().SetProjection(bson.M{"_id": 1}))
	if err != nil {
		return nil, fmt.Errorf("member: existence check: %w", err)
	}
	for _, row := range found {
		out[row.ID.Hex()] = true
	}
	return out, nil
}

// ByPhone finds a member by any spelling of their number.
func (s *Service) ByPhone(ctx context.Context, raw string) (*Member, error) {
	normalized, err := phone.Normalize(raw, s.defaultCountry)
	if err != nil {
		return nil, fmt.Errorf("member: phone %q: %w", raw, err)
	}
	var m Member
	if err := s.coll.FindOne(ctx, bson.M{"phoneE164": normalized}, &m); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("member: lookup by phone: %w", err)
	}
	return &m, nil
}

// List returns members, optionally filtered by status.
func (s *Service) List(ctx context.Context, status Status, limit int64) ([]Member, error) {
	filter := bson.M{}
	if status != "" {
		if !status.Valid() {
			return nil, fmt.Errorf("%w: %q", ErrInvalidStatus, status)
		}
		filter["status"] = string(status)
	}
	if limit <= 0 || limit > 1000 {
		limit = 100
	}

	var out []Member
	err := s.coll.Find(ctx, filter, &out,
		options.Find().SetSort(bson.D{{Key: "lastName", Value: 1}}).SetLimit(limit))
	if err != nil {
		return nil, fmt.Errorf("member: list: %w", err)
	}
	return out, nil
}

// SetStatus moves a member along the journey and emits the transition, which
// is what makes follow-up automation possible (§8.8).
func (s *Service) SetStatus(ctx context.Context, id string, to Status) error {
	if !to.Valid() {
		return fmt.Errorf("%w: %q", ErrInvalidStatus, to)
	}

	current, err := s.ByID(ctx, id)
	if err != nil {
		return err
	}
	if current.Status == to {
		return nil // No transition, no event.
	}

	oid, _ := bson.ObjectIDFromHex(id)
	if _, err := s.coll.UpdateOne(ctx,
		bson.M{"_id": oid},
		bson.M{"$set": bson.M{"status": string(to)}},
	); err != nil {
		return fmt.Errorf("member: set status: %w", err)
	}

	if s.pub != nil {
		// See the note in consent: without churchId the bus keys by member,
		// which loses per-church ordering and puts a member id in the envelope
		// subject where consumers read a church id.
		churchID, err := tenancy.MustChurchID(ctx)
		if err != nil {
			return err
		}
		_ = s.pub.Publish(ctx, TopicMemberStatusChanged, churchID, map[string]any{
			"memberId": id,
			"churchId": churchID,
			"from":     string(current.Status),
			"to":       string(to),
		})
	}
	return nil
}

// --- bulk import ---

// ImportRow is one row of an uploaded file.
type ImportRow struct {
	FirstName string
	LastName  string
	Phone     string
	Email     string
	Gender    string
	Status    string
}

// ImportResult reports what an import did.
type ImportResult struct {
	Created  int           `json:"created"`
	Updated  int           `json:"updated"`
	Skipped  int           `json:"skipped"`
	Failures []ImportError `json:"failures,omitempty"`
}

// ImportError names the row that failed and why, so a church can fix the file
// rather than guess. Row numbers are 1-based to match a spreadsheet.
type ImportError struct {
	Row    int    `json:"row"`
	Reason string `json:"reason"`
}

// Import loads members in bulk, deduplicating on the normalised phone number.
//
// Deduplication happens twice on purpose: within the file (the same person
// listed under two spellings) and against what is already stored. A church
// importing its records for the second time must not double its congregation.
//
// One bad row never fails the import — a 900-row file with 3 typos should load
// 897 members and report 3 problems, not reject everything.
func (s *Service) Import(ctx context.Context, rows []ImportRow) (*ImportResult, error) {
	if _, err := tenancy.MustChurchID(ctx); err != nil {
		return nil, err
	}

	result := &ImportResult{}
	seenInFile := make(map[string]int, len(rows))

	for i, row := range rows {
		rowNum := i + 1

		in := Input{
			FirstName: row.FirstName,
			LastName:  row.LastName,
			Phone:     row.Phone,
			Email:     row.Email,
			Gender:    row.Gender,
			Status:    Status(strings.TrimSpace(row.Status)),
		}

		doc, err := s.buildDoc(in)
		if err != nil {
			result.Failures = append(result.Failures, ImportError{Row: rowNum, Reason: err.Error()})
			continue
		}

		// Within-file duplicate: two spellings of one number.
		if normalized, ok := doc["phoneE164"].(string); ok {
			if firstRow, dup := seenInFile[normalized]; dup {
				result.Skipped++
				result.Failures = append(result.Failures, ImportError{
					Row:    rowNum,
					Reason: fmt.Sprintf("duplicate of row %d (same number, different formatting)", firstRow),
				})
				continue
			}
			seenInFile[normalized] = rowNum

			// Already stored: update rather than create a second record.
			existing, err := s.ByPhone(ctx, normalized)
			if err == nil {
				if _, uerr := s.coll.UpdateOne(ctx,
					bson.M{"_id": existing.ID},
					bson.M{"$set": doc},
				); uerr != nil {
					result.Failures = append(result.Failures, ImportError{Row: rowNum, Reason: uerr.Error()})
					continue
				}
				result.Updated++
				continue
			}
			if !errors.Is(err, ErrNotFound) {
				result.Failures = append(result.Failures, ImportError{Row: rowNum, Reason: err.Error()})
				continue
			}
		}

		if _, err := s.coll.InsertOne(ctx, doc); err != nil {
			if mongo.IsDuplicateKeyError(err) {
				// Lost a race against a concurrent import of the same file.
				result.Skipped++
				continue
			}
			result.Failures = append(result.Failures, ImportError{Row: rowNum, Reason: err.Error()})
			continue
		}
		result.Created++
	}

	return result, nil
}

// Count returns how many members match a status.
func (s *Service) Count(ctx context.Context, status Status) (int64, error) {
	filter := bson.M{}
	if status != "" {
		filter["status"] = string(status)
	}
	n, err := s.coll.CountDocuments(ctx, filter)
	if err != nil {
		return 0, fmt.Errorf("member: count: %w", err)
	}
	return n, nil
}
