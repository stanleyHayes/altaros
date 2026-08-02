package platformsetting

import (
	"context"
	"fmt"
	"runtime"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// The operator's read-only view across every tenant.
//
// Like Stats, everything here is cross-tenant by definition and therefore
// reads through Global() behind a SUPER_ADMIN role check. What is deliberately
// NOT here is as important as what is: no member names, no giving records, no
// message bodies. A platform operator needs to know that a church exists, is
// active, and how much commission it has generated — they do not need, and
// should not casually have, the congregation's personal data. Support access to
// that is a different conversation with a different audit trail.

// Page is a slice of a cross-tenant listing.
//
// Pagination travels INSIDE the payload rather than beside it, because the API
// envelope is unwrapped to `data` on the way out and anything sitting next to
// it is silently dropped. That mistake already cost the admin dashboard every
// number it displays.
type Page[T any] struct {
	Items      []T        `json:"items"`
	Pagination Pagination `json:"pagination"`
}

// Pagination is where a listing got to.
type Pagination struct {
	Page       int   `json:"page"`
	Limit      int   `json:"limit"`
	Total      int64 `json:"total"`
	TotalPages int   `json:"totalPages"`
}

// maxPageSize bounds one request. An operator asking for everything at once on
// a platform with ten thousand churches is a request that times out and tells
// them nothing.
const maxPageSize = 100

func paginate(page, limit int, total int64) (Pagination, int64) {
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > maxPageSize {
		limit = 20
	}
	pages := int((total + int64(limit) - 1) / int64(limit))
	return Pagination{Page: page, Limit: limit, Total: total, TotalPages: pages},
		int64((page - 1) * limit)
}

// ChurchRow is one church as an operator sees it.
type ChurchRow struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Slug     string `json:"slug"`
	City     string `json:"city"`
	Country  string `json:"country"`
	Plan     string `json:"plan"`
	IsActive bool   `json:"isActive"`
	// MemberCount and TotalRevenue are computed per row rather than stored.
	// A denormalised counter that drifts is worse than a slightly slower page:
	// an operator making a support decision on a stale number has no way to
	// tell it is stale.
	MemberCount int64 `json:"memberCount"`
	// TotalRevenue is the PLATFORM's commission from this church, not what the
	// church received. The same distinction as Stats.TotalRevenue, and the same
	// reason: under ADR-002 the platform never holds the church's funds.
	TotalRevenue int64     `json:"totalRevenue"`
	CreatedAt    time.Time `json:"createdAt"`
}

// Churches lists every church on the platform.
func (s *Service) Churches(ctx context.Context, db *mongodb.DB, page, limit int) (*Page[ChurchRow], error) {
	churches := db.Global("churches")

	total, err := churches.CountDocuments(ctx, bson.M{})
	if err != nil {
		return nil, fmt.Errorf("platformsetting: count churches: %w", err)
	}
	pagination, skip := paginate(page, limit, total)

	cursor, err := churches.Find(ctx, bson.M{},
		options.Find().
			SetSort(bson.D{{Key: "createdAt", Value: -1}, {Key: "_id", Value: -1}}).
			SetSkip(skip).
			SetLimit(int64(pagination.Limit)))
	if err != nil {
		return nil, fmt.Errorf("platformsetting: list churches: %w", err)
	}
	var rows []struct {
		ID        bson.ObjectID `bson:"_id"`
		Name      string        `bson:"name"`
		Slug      string        `bson:"slug"`
		City      string        `bson:"city"`
		Country   string        `bson:"country"`
		Plan      string        `bson:"plan"`
		IsActive  bool          `bson:"isActive"`
		CreatedAt time.Time     `bson:"createdAt"`
	}
	if err := cursor.All(ctx, &rows); err != nil {
		return nil, fmt.Errorf("platformsetting: read churches: %w", err)
	}

	out := make([]ChurchRow, 0, len(rows))
	for _, r := range rows {
		row := ChurchRow{
			ID: r.ID.Hex(), Name: r.Name, Slug: r.Slug, City: r.City,
			Country: r.Country, Plan: r.Plan, IsActive: r.IsActive,
			CreatedAt: r.CreatedAt,
		}

		// Both id forms, because Mongoose writes churchId as an ObjectId and
		// early Go documents wrote it as a string (ADR-005). Matching one form
		// silently halves the count — and a member count that is quietly wrong
		// is worse on an operator's screen than no count at all.
		owner := bson.M{"churchId": bson.M{"$in": bson.A{r.ID, r.ID.Hex()}}}

		if n, err := db.Global("members").CountDocuments(ctx, owner); err == nil {
			row.MemberCount = n
		}
		row.TotalRevenue = churchCommission(ctx, db, owner)
		out = append(out, row)
	}
	return &Page[ChurchRow]{Items: out, Pagination: pagination}, nil
}

// churchCommission sums the platform's commission from one church.
//
// Errors are swallowed into a zero deliberately: a listing that fails entirely
// because one church's transactions could not be summed is less useful than one
// that shows the rest. The number is a summary on a directory page, not a
// figure anybody bills from.
func churchCommission(ctx context.Context, db *mongodb.DB, owner bson.M) int64 {
	match := bson.M{"status": "completed", "direction": "income"}
	for k, v := range owner {
		match[k] = v
	}
	cursor, err := db.Global("transactions").Aggregate(ctx, []bson.M{
		{"$match": match},
		{"$group": bson.M{"_id": nil, "total": bson.M{"$sum": "$platformFeeMinor"}}},
	})
	if err != nil {
		return 0
	}
	var rows []struct {
		Total int64 `bson:"total"`
	}
	if cursor.All(ctx, &rows) != nil || len(rows) == 0 {
		return 0
	}
	return rows[0].Total
}

// SetChurchActive enables or disables a church platform-wide.
//
// The bluntest instrument an operator has, so it is worth being clear about
// what it does: an inactive church cannot be signed in to (auth checks
// isActive), and its public site stops resolving. It does not delete anything.
func (s *Service) SetChurchActive(ctx context.Context, db *mongodb.DB, churchID string, active bool) error {
	oid, err := bson.ObjectIDFromHex(strings.TrimSpace(churchID))
	if err != nil {
		return ErrChurchNotFound
	}
	res, err := db.Global("churches").UpdateOne(ctx,
		bson.M{"_id": oid},
		bson.M{"$set": bson.M{"isActive": active, "updatedAt": s.now().UTC()}})
	if err != nil {
		return fmt.Errorf("platformsetting: set church active: %w", err)
	}
	if res.MatchedCount == 0 {
		return ErrChurchNotFound
	}
	return nil
}

// UserRow is one account as an operator sees it.
type UserRow struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
	// Phone is deliberately MASKED. An operator listing every account on the
	// platform has no need for a readable directory of members' phone numbers,
	// and a screen full of them is one screenshot away from being a leak.
	// Enough is shown to confirm a number with somebody on a support call.
	Phone     string    `json:"phone,omitempty"`
	Role      string    `json:"role"`
	ChurchID  string    `json:"churchId,omitempty"`
	IsActive  bool      `json:"isActive"`
	AvatarURL string    `json:"avatarUrl,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	// SelfRegistered marks an account somebody made for themselves (R-17).
	SelfRegistered bool `json:"selfRegistered,omitempty"`
}

// maskPhone keeps the country code and the last two digits.
//
// "+233…89" is enough to confirm a number a caller reads out, and not enough to
// dial or to build a list from.
func maskPhone(phone string) string {
	p := strings.TrimSpace(phone)
	if len(p) < 6 {
		return ""
	}
	return p[:4] + "…" + p[len(p)-2:]
}

// Users lists accounts across every church.
func (s *Service) Users(ctx context.Context, db *mongodb.DB,
	page, limit int, role, search string) (*Page[UserRow], error) {

	filter := bson.M{}
	if role = strings.TrimSpace(role); role != "" {
		filter["role"] = role
	}
	if search = strings.TrimSpace(search); search != "" {
		// Anchored and escaped. An unescaped user-supplied regex is a denial of
		// service against the whole platform — ".*.*.*.*x" over every account —
		// and an unanchored one cannot use the index.
		safe := regexEscape(search)
		filter["$or"] = bson.A{
			bson.M{"email": bson.M{"$regex": "^" + safe, "$options": "i"}},
			bson.M{"name": bson.M{"$regex": "^" + safe, "$options": "i"}},
		}
	}

	users := db.Global("users")
	total, err := users.CountDocuments(ctx, filter)
	if err != nil {
		return nil, fmt.Errorf("platformsetting: count users: %w", err)
	}
	pagination, skip := paginate(page, limit, total)

	cursor, err := users.Find(ctx, filter,
		options.Find().
			SetSort(bson.D{{Key: "createdAt", Value: -1}, {Key: "_id", Value: -1}}).
			SetSkip(skip).
			SetLimit(int64(pagination.Limit)).
			// Never the password hash. Projecting it out here rather than
			// relying on a `json:"-"` tag means it does not reach this process
			// at all.
			SetProjection(bson.M{"passwordHash": 0}))
	if err != nil {
		return nil, fmt.Errorf("platformsetting: list users: %w", err)
	}

	var rows []struct {
		ID             bson.ObjectID `bson:"_id"`
		Name           string        `bson:"name"`
		Email          string        `bson:"email"`
		Phone          string        `bson:"phone"`
		Role           string        `bson:"role"`
		ChurchID       mongodb.ID    `bson:"churchId"`
		IsActive       bool          `bson:"isActive"`
		AvatarURL      string        `bson:"avatarUrl"`
		SelfRegistered bool          `bson:"selfRegistered"`
		CreatedAt      time.Time     `bson:"createdAt"`
	}
	if err := cursor.All(ctx, &rows); err != nil {
		return nil, fmt.Errorf("platformsetting: read users: %w", err)
	}

	out := make([]UserRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, UserRow{
			ID: r.ID.Hex(), Name: r.Name, Email: r.Email,
			Phone: maskPhone(r.Phone), Role: r.Role,
			ChurchID: r.ChurchID.String(), IsActive: r.IsActive,
			AvatarURL: r.AvatarURL, SelfRegistered: r.SelfRegistered,
			CreatedAt: r.CreatedAt,
		})
	}
	return &Page[UserRow]{Items: out, Pagination: pagination}, nil
}

// regexEscape neutralises every metacharacter.
func regexEscape(s string) string {
	var b strings.Builder
	for _, r := range s {
		if strings.ContainsRune(`\.+*?()|[]{}^$`, r) {
			b.WriteByte('\\')
		}
		b.WriteRune(r)
	}
	return b.String()
}

// Health is what the operator's System Health page shows.
//
// The field names match what the admin app already reads, including
// `nodeVersion` — which is answered with the GO version, because the service
// this reports on is written in Go. Reporting a Node version would be a lie
// that looks like a fact, and renaming the field is the frontend's to do.
type Health struct {
	Status      string    `json:"status"`
	Uptime      float64   `json:"uptime"`
	Timestamp   time.Time `json:"timestamp"`
	Database    string    `json:"database"`
	Memory      Memory    `json:"memory"`
	NodeVersion string    `json:"nodeVersion"`
	// Runtime says what this actually is, since nodeVersion cannot.
	Runtime string `json:"runtime"`
}

// Memory mirrors the shape the admin app expects. Go's allocator does not have
// a heap/rss split in the same sense as V8, so these are the nearest honest
// equivalents rather than invented numbers.
type Memory struct {
	HeapUsed  uint64 `json:"heapUsed"`
	HeapTotal uint64 `json:"heapTotal"`
	RSS       uint64 `json:"rss"`
}

// Pinger is the database health check.
type Pinger interface {
	Ping(ctx context.Context) error
}

// HealthOf reports the service's own state.
func (s *Service) HealthOf(ctx context.Context, db Pinger, startedAt time.Time) *Health {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)

	database := "connected"
	status := "ok"
	if err := db.Ping(ctx); err != nil {
		// Named rather than reported as a generic degradation: "database" is
		// the answer to the only question this page is opened to ask.
		database, status = "unreachable", "degraded"
	}

	return &Health{
		Status:    status,
		Uptime:    s.now().Sub(startedAt).Seconds(),
		Timestamp: s.now().UTC(),
		Database:  database,
		Memory: Memory{
			HeapUsed:  mem.HeapAlloc,
			HeapTotal: mem.HeapSys,
			RSS:       mem.Sys,
		},
		NodeVersion: runtime.Version(),
		Runtime:     "go",
	}
}
