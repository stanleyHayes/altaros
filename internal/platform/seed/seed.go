package seed

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"golang.org/x/crypto/bcrypt"

	"github.com/hayfordstanley/altar-os/internal/domain/consent"
	"github.com/hayfordstanley/altar-os/internal/domain/finance"
	"github.com/hayfordstanley/altar-os/internal/domain/member"
	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/platform/money"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// Marker is written on every seeded document.
//
// Seeding shares a database with whatever a developer has already created by
// hand, so every row this package writes is tagged. Reset then removes exactly
// what it made and nothing else — the alternative is a reset that drops
// collections and takes a colleague's afternoon of manual test data with it.
const Marker = "seeded"

// MarkerField is the field the marker is written to.
const MarkerField = "_seed"

// Options controls a seed run.
type Options struct {
	// Password is set on every seeded login, so the credentials printed at the
	// end actually work.
	Password string
	// MembersPerChurch is how large each congregation is.
	MembersPerChurch int
	// WeeksOfGiving is how far back the ledger goes. Twelve weeks is enough
	// for a "last quarter" report to have something in it.
	WeeksOfGiving int
	// Seed makes a run reproducible. Two runs with the same seed produce the
	// same congregation, which matters when a screenshot in a bug report has
	// to be reproducible.
	Seed int64
	Log  *slog.Logger
}

// Defaults fills in anything unset.
func (o Options) withDefaults() Options {
	if o.Password == "" {
		o.Password = "AltarOS2026!"
	}
	if o.MembersPerChurch == 0 {
		o.MembersPerChurch = 120
	}
	if o.WeeksOfGiving == 0 {
		o.WeeksOfGiving = 12
	}
	if o.Seed == 0 {
		o.Seed = 20260801
	}
	if o.Log == nil {
		o.Log = slog.Default()
	}
	return o
}

// Result summarises what was created.
type Result struct {
	Organizations int
	Churches      int
	Users         int
	Members       int
	Transactions  int
	Consents      int
	Logins        []Login
}

// Login is a seeded account, printed so someone can actually sign in.
type Login struct {
	Email    string
	Password string
	Role     string
	Church   string
	Slug     string
}

// Seeder writes development data.
type Seeder struct {
	db  *mongodb.DB
	raw *mongo.Database
	opt Options
	rng *rand.Rand
}

// New builds a seeder.
func New(db *mongodb.DB, opt Options) *Seeder {
	opt = opt.withDefaults()
	return &Seeder{
		db:  db,
		raw: db.Database(),
		opt: opt,
		//nolint:gosec // Not cryptographic: this is deterministic fixture data.
		rng: rand.New(rand.NewSource(opt.Seed)),
	}
}

// Reset removes everything a previous seed created, and nothing else.
func (s *Seeder) Reset(ctx context.Context) error {
	collections := []string{
		"organizations", "churches", "users", "members", "transactions",
		"consents", "notifications", "notification_preferences", "event_outbox",
	}
	for _, name := range collections {
		res, err := s.raw.Collection(name).DeleteMany(ctx, bson.M{MarkerField: Marker})
		if err != nil {
			return fmt.Errorf("seed: reset %s: %w", name, err)
		}
		if res.DeletedCount > 0 {
			s.opt.Log.Info("removed seeded documents",
				slog.String("collection", name),
				slog.Int64("count", res.DeletedCount))
		}
	}
	return nil
}

// Run seeds the platform.
func (s *Seeder) Run(ctx context.Context) (*Result, error) {
	result := &Result{}

	orgID, err := s.organization(ctx, "Redemption Assemblies", "redemption-assemblies")
	if err != nil {
		return nil, err
	}
	result.Organizations++

	// A denomination with branches, because WP-11's whole point is that an org
	// admin sees across branches and a branch admin does not. One church would
	// never exercise that.
	branches := []struct {
		name, slug, city string
		members          int
	}{
		{"Grace Chapel International", "grace-chapel", "Accra", s.opt.MembersPerChurch},
		{"Living Word Assembly", "living-word-assembly", "Kumasi", s.opt.MembersPerChurch * 2 / 3},
		{"Calvary Temple", "calvary-temple", "Takoradi", s.opt.MembersPerChurch / 2},
	}

	for _, b := range branches {
		churchID, err := s.church(ctx, orgID, b.name, b.slug, b.city)
		if err != nil {
			return nil, err
		}
		result.Churches++

		// Every church needs its three system roles before anyone holds one.
		// Provisioned per church rather than at boot, because roles are
		// tenant-scoped and a church that does not exist yet cannot have them.
		if err := rbac.NewService(s.db).EnsureSystemRoles(s.scope(churchID)); err != nil {
			return nil, fmt.Errorf("seed: system roles: %w", err)
		}

		logins, err := s.staff(ctx, churchID, b.name, b.slug)
		if err != nil {
			return nil, err
		}
		result.Users += len(logins)
		result.Logins = append(result.Logins, logins...)

		created, err := s.members(ctx, churchID, b.members)
		if err != nil {
			return nil, err
		}
		result.Members += len(created)

		consents, err := s.consents(ctx, churchID, created)
		if err != nil {
			return nil, err
		}
		result.Consents += consents

		txs, err := s.giving(ctx, churchID, created)
		if err != nil {
			return nil, err
		}
		result.Transactions += txs

		s.opt.Log.Info("seeded church",
			slog.String("church", b.name),
			slog.Int("members", len(created)),
			slog.Int("transactions", txs))
	}

	// One org-level admin, so cross-branch visibility can actually be seen.
	orgLogin, err := s.orgAdmin(ctx, orgID, branches[0].slug)
	if err != nil {
		return nil, err
	}
	result.Users++
	result.Logins = append(result.Logins, orgLogin)

	return result, nil
}

func (s *Seeder) organization(ctx context.Context, name, slug string) (bson.ObjectID, error) {
	var existing struct {
		ID bson.ObjectID `bson:"_id"`
	}
	err := s.raw.Collection("organizations").FindOne(ctx, bson.M{"slug": slug}).Decode(&existing)
	if err == nil {
		return existing.ID, nil
	}
	if !errors.Is(err, mongo.ErrNoDocuments) {
		return bson.ObjectID{}, fmt.Errorf("seed: look up organization: %w", err)
	}

	now := time.Now().UTC()
	id := bson.NewObjectID()

	_, err = s.raw.Collection("organizations").InsertOne(ctx, bson.M{
		"_id":        id,
		"name":       name,
		"slug":       slug,
		"country":    "GH",
		"dataRegion": "gh",
		MarkerField:  Marker,
		"createdAt":  now,
		"updatedAt":  now,
	})
	if err != nil {
		return bson.ObjectID{}, fmt.Errorf("seed: organization: %w", err)
	}
	return id, nil
}

// church creates a branch, or ADOPTS one that already exists under that slug.
//
// Adopting rather than colliding is the useful behaviour: a developer who has
// already created "Grace Chapel" by hand wants members and giving seeded INTO
// it, not a duplicate under a different name. An adopted church is deliberately
// NOT marked as seeded — Reset must not delete a church someone made — but the
// members and transactions written into it are, so they can still be cleared.
func (s *Seeder) church(ctx context.Context, orgID bson.ObjectID, name, slug, city string) (bson.ObjectID, error) {
	var existing struct {
		ID                   bson.ObjectID `bson:"_id"`
		Name                 string        `bson:"name"`
		PayoutSubaccountCode string        `bson:"payoutSubaccountCode"`
	}
	err := s.raw.Collection("churches").FindOne(ctx, bson.M{"slug": slug}).Decode(&existing)
	if err == nil {
		s.opt.Log.Info("adopting an existing church rather than creating a duplicate",
			slog.String("slug", slug), slog.String("name", existing.Name))

		// Give it what giving needs, without overwriting anything it already
		// has. Without a payout subaccount, StartGiving refuses under ADR-002.
		set := bson.M{"organizationId": orgID, "updatedAt": time.Now().UTC()}
		if existing.PayoutSubaccountCode == "" {
			set["payoutSubaccountCode"] = "ACCT_seed_" + strings.ReplaceAll(slug, "-", "_")
		}
		if _, err := s.raw.Collection("churches").
			UpdateByID(ctx, existing.ID, bson.M{"$set": set}); err != nil {
			return bson.ObjectID{}, fmt.Errorf("seed: adopt church %s: %w", slug, err)
		}
		return existing.ID, nil
	}
	if !errors.Is(err, mongo.ErrNoDocuments) {
		return bson.ObjectID{}, fmt.Errorf("seed: look up church %s: %w", slug, err)
	}

	now := time.Now().UTC()
	id := bson.NewObjectID()

	_, err = s.raw.Collection("churches").InsertOne(ctx, bson.M{
		"_id":            id,
		"organizationId": orgID,
		"name":           name,
		"slug":           slug,
		"address":        fmt.Sprintf("%d %s", 1+s.rng.Intn(200), s.pick(streets)),
		"city":           city,
		"country":        "GH",
		"phone":          s.phoneE164(),
		"email":          "info@" + slug + ".org",
		"timezone":       "Africa/Accra",
		"currency":       "GHS",
		"plan":           "growth",
		// A test-mode subaccount, so the giving path has somewhere to settle.
		// ADR-002: money settles to the CHURCH, never to ALTAR OS.
		"payoutSubaccountCode": "ACCT_seed_" + strings.ReplaceAll(slug, "-", "_"),
		"isActive":             true,
		MarkerField:            Marker,
		"createdAt":            now,
		"updatedAt":            now,
	})
	if err != nil {
		return bson.ObjectID{}, fmt.Errorf("seed: church %s: %w", slug, err)
	}
	return id, nil
}

// staff creates the logins for one church.
func (s *Seeder) staff(ctx context.Context, churchID bson.ObjectID, churchName, slug string) ([]Login, error) {
	people := []struct{ role, first, last string }{
		{"CHURCH_ADMIN", "Emmanuel", "Owusu"},
		{"DEPARTMENT_LEADER", "Grace", "Mensah"},
		{"MEMBER", "Kwame", "Boateng"},
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(s.opt.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("seed: hash password: %w", err)
	}

	now := time.Now().UTC()
	logins := make([]Login, 0, len(people))

	for _, p := range people {
		email := fmt.Sprintf("%s@%s.org", strings.ToLower(roleLabel(p.role)), slug)

		// Upsert: `email` is globally unique today (ADR-006 changes that), so a
		// second seed run would otherwise collide rather than refresh.
		_, err := s.raw.Collection("users").UpdateOne(ctx,
			bson.M{"email": email},
			bson.M{"$set": bson.M{
				"email":        email,
				"phone":        s.phoneE164(),
				"passwordHash": string(hash),
				"name":         p.first + " " + p.last,
				"role":         p.role,
				"roleId":       s.roleIDFor(ctx, churchID, p.role),
				"churchId":     churchID,
				"isActive":     true,
				MarkerField:    Marker,
				"updatedAt":    now,
			}, "$setOnInsert": bson.M{"createdAt": now}},
			options.UpdateOne().SetUpsert(true))
		if err != nil {
			return nil, fmt.Errorf("seed: user %s: %w", email, err)
		}
		logins = append(logins, Login{
			Email:    email,
			Password: s.opt.Password,
			Role:     p.role,
			Church:   churchName,
			Slug:     slug,
		})
	}
	return logins, nil
}

func (s *Seeder) orgAdmin(ctx context.Context, orgID bson.ObjectID, homeSlug string) (Login, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(s.opt.Password), bcrypt.DefaultCost)
	if err != nil {
		return Login{}, fmt.Errorf("seed: hash password: %w", err)
	}

	// The org admin belongs to a branch but reads across the denomination —
	// that is exactly what VisibleChurchIDs decides (WP-11).
	var home struct {
		ID bson.ObjectID `bson:"_id"`
	}
	if err := s.raw.Collection("churches").
		FindOne(ctx, bson.M{"slug": homeSlug}).Decode(&home); err != nil {
		return Login{}, fmt.Errorf("seed: find home church: %w", err)
	}

	now := time.Now().UTC()
	email := "bishop@redemption-assemblies.org"

	// Upsert, like the branch staff: `email` is globally unique today (ADR-006
	// changes that), so a second seed run would otherwise collide rather than
	// refresh. This was an InsertOne and broke every re-run.
	_, err = s.raw.Collection("users").UpdateOne(ctx,
		bson.M{"email": email},
		bson.M{
			"$set": bson.M{
				"email":          email,
				"phone":          s.phoneE164(),
				"passwordHash":   string(hash),
				"name":           "Bishop Samuel Adjei",
				"role":           "ORG_ADMIN",
				"churchId":       home.ID,
				"organizationId": orgID,
				"isActive":       true,
				MarkerField:      Marker,
				"updatedAt":      now,
			},
			"$setOnInsert": bson.M{"createdAt": now},
		},
		options.UpdateOne().SetUpsert(true))
	if err != nil {
		return Login{}, fmt.Errorf("seed: org admin: %w", err)
	}

	return Login{
		Email:    email,
		Password: s.opt.Password,
		Role:     "ORG_ADMIN",
		Church:   "Redemption Assemblies (all branches)",
		Slug:     homeSlug,
	}, nil
}

// members seeds a congregation through the real member service.
//
// Import rather than raw inserts, deliberately: it runs the same E.164
// normalisation and deduplication the CSV upload does, so seeded data proves
// that path works instead of quietly bypassing it.
func (s *Seeder) members(ctx context.Context, churchID bson.ObjectID, count int) ([]member.Member, error) {
	scoped := s.scope(churchID)
	svc := member.NewService(s.db, nil, "GH")
	if err := svc.EnsureIndexes(scoped); err != nil {
		return nil, err
	}

	rows := make([]member.ImportRow, 0, count)
	for i := 0; i < count; i++ {
		first := s.pick(firstNames)
		last := s.pick(lastNames)
		rows = append(rows, member.ImportRow{
			FirstName: first,
			LastName:  last,
			// Written the way a church secretary types it, so the import
			// exercises normalisation rather than receiving clean input.
			Phone:  s.phoneAsTyped(),
			Email:  s.maybeEmail(first, last),
			Gender: s.pickGender(),
		})
	}

	result, err := svc.Import(scoped, rows)
	if err != nil {
		return nil, fmt.Errorf("seed: import members: %w", err)
	}
	if len(result.Failures) > 0 {
		s.opt.Log.Warn("some seeded members were skipped",
			slog.Int("failures", len(result.Failures)),
			slog.String("first", result.Failures[0].Reason))
	}

	created, err := svc.List(scoped, "", int64(count+50))
	if err != nil {
		return nil, err
	}

	// A congregation is a pipeline, not a flat list: mostly active, with
	// visitors and new converts at the front and a tail who have drifted. A
	// seed where everyone is "active" makes every engagement metric look
	// perfect and hides whether the funnel view works at all.
	for i := range created {
		status := s.pickStatus()
		if status == member.StatusVisitor {
			// Already the default from Import; skipping saves a write.
			continue
		}
		if err := svc.SetStatus(scoped, created[i].ID.Hex(), status); err != nil {
			return nil, fmt.Errorf("seed: set status: %w", err)
		}
	}

	// Tag them so Reset can find them again.
	if _, err := s.raw.Collection("members").UpdateMany(ctx,
		bson.M{"churchId": churchID},
		bson.M{"$set": bson.M{MarkerField: Marker}}); err != nil {
		return nil, fmt.Errorf("seed: mark members: %w", err)
	}

	return svc.List(scoped, "", int64(count+50))
}

// consents records per-purpose consent, the way WP-06 models it.
//
// Not everyone consents to communications — that is the entire point of the
// consent system, and a seed where all 120 members opted in never exercises
// the suppression path a broadcast has to respect.
func (s *Seeder) consents(ctx context.Context, churchID bson.ObjectID, members []member.Member) (int, error) {
	scoped := s.scope(churchID)
	svc := consent.NewService(s.db, nil)
	if err := svc.EnsureIndexes(scoped); err != nil {
		return 0, err
	}

	recorded := 0
	for i := range members {
		id := members[i].ID.Hex()

		// About four in five agree to be contacted. The rest are the reason
		// the notification service has a suppression path.
		if s.rng.Intn(100) < 80 {
			if err := svc.Grant(scoped, id, consent.PurposeCommunications,
				consent.SourceImport, "v1", "system:seed"); err != nil {
				return recorded, fmt.Errorf("seed: grant consent: %w", err)
			}
			recorded++
		}

		// A smaller share agree to AI processing, which also fails closed.
		if s.rng.Intn(100) < 45 {
			if err := svc.Grant(scoped, id, consent.PurposeAIProcessing,
				consent.SourceImport, "v1", "system:seed"); err != nil {
				return recorded, fmt.Errorf("seed: grant AI consent: %w", err)
			}
			recorded++
		}
	}

	if _, err := s.raw.Collection("consents").UpdateMany(ctx,
		bson.M{"churchId": churchID},
		bson.M{"$set": bson.M{MarkerField: Marker}}); err != nil {
		return recorded, fmt.Errorf("seed: mark consents: %w", err)
	}
	return recorded, nil
}

// giving seeds a ledger with the shape a church's actually has.
func (s *Seeder) giving(ctx context.Context, churchID bson.ObjectID, members []member.Member) (int, error) {
	scoped := s.scope(churchID)

	// A nil publisher: this is historical data, and emitting giving.completed
	// for twelve weeks of back-dated gifts would ask the notification service
	// to send hundreds of receipts for tithes given months ago.
	svc := finance.NewService(s.db, nil, nil, nil)
	if err := svc.EnsureIndexes(scoped); err != nil {
		return 0, err
	}

	count := 0
	now := time.Now().UTC()

	for week := s.opt.WeeksOfGiving; week >= 0; week-- {
		sunday := now.AddDate(0, 0, -7*week)
		sunday = time.Date(sunday.Year(), sunday.Month(), sunday.Day(), 10, 0, 0, 0, time.UTC)

		// Two collections most Sundays.
		for _, service := range []int{0, 2} {
			at := sunday.Add(time.Duration(service) * time.Hour)
			amount := s.offeringAmount()
			if _, err := svc.RecordCash(scoped, finance.CashRequest{
				Type:       finance.TypeOffering,
				Amount:     amount,
				Note:       s.pick(offeringNotes),
				OccurredAt: at,
			}); err != nil {
				return count, fmt.Errorf("seed: offering: %w", err)
			}
			count++
		}

		// Tithes from a slice of the congregation. Not everyone tithes every
		// week, which is what makes a giving-frequency report meaningful.
		tithers := len(members) / 4
		for i := 0; i < tithers; i++ {
			m := members[s.rng.Intn(len(members))]
			if _, err := svc.RecordCash(scoped, finance.CashRequest{
				MemberID:   m.ID.Hex(),
				Type:       finance.TypeTithe,
				Amount:     s.titheAmount(),
				OccurredAt: sunday.Add(time.Duration(s.rng.Intn(180)) * time.Minute),
			}); err != nil {
				return count, fmt.Errorf("seed: tithe: %w", err)
			}
			count++
		}

		// A church spends as well as receives; a ledger with only income makes
		// the balance meaningless.
		if s.rng.Intn(100) < 60 {
			if _, err := svc.RecordCash(scoped, finance.CashRequest{
				Type:       finance.TypeExpense,
				Direction:  finance.DirectionExpense,
				Amount:     s.expenseAmount(),
				Note:       s.pick(expenseNotes),
				OccurredAt: sunday.AddDate(0, 0, 2),
			}); err != nil {
				return count, fmt.Errorf("seed: expense: %w", err)
			}
			count++
		}
	}

	if _, err := s.raw.Collection("transactions").UpdateMany(ctx,
		bson.M{"churchId": churchID},
		bson.M{"$set": bson.M{MarkerField: Marker}}); err != nil {
		return count, fmt.Errorf("seed: mark transactions: %w", err)
	}
	return count, nil
}

// --- helpers ---------------------------------------------------------------

func (s *Seeder) scope(churchID bson.ObjectID) context.Context {
	return tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: churchID.Hex(),
		UserID:   "system:seed",
		Role:     "CHURCH_ADMIN",
	})
}

func (s *Seeder) pick(from []string) string { return from[s.rng.Intn(len(from))] }

func (s *Seeder) pickGender() string {
	if s.rng.Intn(2) == 0 {
		return "male"
	}
	return "female"
}

// pickStatus gives the congregation a realistic shape.
func (s *Seeder) pickStatus() member.Status {
	switch n := s.rng.Intn(100); {
	case n < 62:
		return member.StatusActive
	case n < 76:
		return member.StatusVisitor
	case n < 86:
		return member.StatusNewConvert
	case n < 96:
		return member.StatusInactive
	case n < 99:
		return member.StatusTransferred
	default:
		return member.StatusDeceased
	}
}

// phoneAsTyped returns a number written the way a person writes it.
func (s *Seeder) phoneAsTyped() string {
	prefix := s.networkPrefix()
	subscriber := fmt.Sprintf("%07d", s.rng.Intn(10000000))

	format := s.pick(phoneFormats)
	bare := strings.TrimPrefix(prefix, "0")

	switch {
	case strings.HasPrefix(format, "+233"), strings.HasPrefix(format, "233"):
		return fmt.Sprintf(format, bare, subscriber)
	default:
		return fmt.Sprintf(format, bare, subscriber)
	}
}

// phoneE164 returns an already-normalised number, for records that do not go
// through the import path.
func (s *Seeder) phoneE164() string {
	prefix := strings.TrimPrefix(s.networkPrefix(), "0")
	return fmt.Sprintf("+233%s%07d", prefix, s.rng.Intn(10000000))
}

// networkPrefix weights MTN heavily, which matches the market.
func (s *Seeder) networkPrefix() string {
	switch n := s.rng.Intn(100); {
	case n < 62:
		return s.pick(mtnPrefixes)
	case n < 85:
		return s.pick(telecelPrefixes)
	default:
		return s.pick(airteltigoPrefixes)
	}
}

// maybeEmail returns an address for some members and nothing for the rest.
//
// Most of a Ghanaian congregation is reachable by phone and not by email, and
// a seed where everyone has an address hides every "no address for channel"
// suppression the notification service produces.
func (s *Seeder) maybeEmail(first, last string) string {
	if s.rng.Intn(100) >= 35 {
		return ""
	}
	return fmt.Sprintf("%s.%s%d@example.com",
		strings.ToLower(first), strings.ToLower(last), s.rng.Intn(90)+10)
}

// titheAmount returns a plausible tithe in minor units.
//
// Clustered on round numbers, because people give round numbers, with a long
// tail. Amounts straddle the GHS 100 E-Levy threshold on purpose so the levy
// logic is visible in seeded data rather than only in tests.
func (s *Seeder) titheAmount() money.Amount {
	round := []int64{
		2000, 5000, 10000, 15000, 20000, 25000, 30000, 5000, 10000,
		10000, 20000, 50000, 8000, 12000, 100000,
	}
	base := round[s.rng.Intn(len(round))]
	// A few give an odd amount — a tenth of an actual salary.
	if s.rng.Intn(100) < 18 {
		base += int64(s.rng.Intn(900)) * 10
	}
	return money.Amount{Minor: base, Currency: "GHS"}
}

func (s *Seeder) offeringAmount() money.Amount {
	// A congregational collection: hundreds to low thousands of cedis.
	return money.Amount{
		Minor:    int64(30000 + s.rng.Intn(220000)),
		Currency: "GHS",
	}
}

func (s *Seeder) expenseAmount() money.Amount {
	return money.Amount{
		Minor:    int64(5000 + s.rng.Intn(150000)),
		Currency: "GHS",
	}
}

func roleLabel(role string) string {
	switch role {
	case "CHURCH_ADMIN":
		return "pastor"
	case "DEPARTMENT_LEADER":
		return "leader"
	case "ORG_ADMIN":
		return "bishop"
	default:
		return "member"
	}
}

// roleIDFor resolves the system role matching a legacy role name.
//
// Seeded users get a real roleId rather than relying on the legacy-enum
// fallback, so the seed exercises the path production will use once accounts
// are created through RBAC rather than through the TypeScript API.
func (s *Seeder) roleIDFor(ctx context.Context, churchID bson.ObjectID, legacyRole string) string {
	var slug string
	switch legacyRole {
	case "CHURCH_ADMIN", "ORG_ADMIN", "SUPER_ADMIN":
		slug = rbac.SystemAdmin
	case "DEPARTMENT_LEADER":
		slug = rbac.SystemStaff
	default:
		slug = rbac.SystemMember
	}

	role, err := rbac.NewService(s.db).RoleBySlug(s.scope(churchID), slug)
	if err != nil {
		// Not fatal: the legacy enum still resolves, so the account works
		// either way. Losing the seed over it would be disproportionate.
		s.opt.Log.Warn("could not resolve a system role for a seeded user",
			slog.String("slug", slug), slog.String("error", err.Error()))
		return ""
	}
	return role.ID.Hex()
}
