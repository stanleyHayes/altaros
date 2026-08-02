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

	"github.com/hayfordstanley/altar-os/internal/domain/church"
	"github.com/hayfordstanley/altar-os/internal/domain/consent"
	"github.com/hayfordstanley/altar-os/internal/domain/event"
	"github.com/hayfordstanley/altar-os/internal/domain/finance"
	"github.com/hayfordstanley/altar-os/internal/domain/member"
	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/domain/site"
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
	Events        int
	Attendance    int
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

// branch is one church the seeder maintains.
type branch struct {
	name, slug, city string
	members          int
}

// branches is the single list of churches this seeder owns.
//
// Reset reads it too, and that is the point of it being one list: the seeder
// ADOPTS a church that already has one of these slugs rather than creating a
// duplicate, so an adopted church carries no seed marker and a marker-based
// reset never touches it — or anything written into it. Identifying those
// churches by slug is the only accurate answer to "which churches does this
// seeder write to".
func (s *Seeder) branches() []branch {
	return []branch{
		{"Grace Chapel International", "grace-chapel", "Accra", s.opt.MembersPerChurch},
		{"Living Word Assembly", "living-word-assembly", "Kumasi", s.opt.MembersPerChurch * 2 / 3},
		{"Calvary Temple", "calvary-temple", "Takoradi", s.opt.MembersPerChurch / 2},
	}
}

// Reset removes everything a previous seed created, and nothing else.
func (s *Seeder) Reset(ctx context.Context) error {
	// Website content first, and by CHURCH rather than by marker.
	//
	// The site service writes through TenantCollection, which stamps churchId
	// and not the seed marker — so a marker-based delete would find nothing and
	// silently leave every seeded page behind, to be re-created on the next run
	// and collide on the unique page-slug index. Removing them by the churches
	// that are about to be deleted is the accurate way to say "what this
	// seeder made", and it has to happen BEFORE those churches go, because
	// afterwards there is nothing left to identify them by.
	if err := s.resetWebsites(ctx); err != nil {
		return err
	}

	collections := []string{
		"organizations", "churches", "users", "members", "transactions",
		"consents", "notifications", "notification_preferences", "event_outbox",
		// Events, attendance and RSVPs are written through the tenant wrapper,
		// which stamps churchId and not the marker — so the events seeder
		// stamps them afterwards specifically so this list can find them.
		"events", "attendance", "rsvps", "departments", "groups",
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

// resetWebsites removes CMS content belonging to seeded churches.
//
// Also removes the roles the seeder provisions, for the same reason: they are
// written through the tenant wrapper and carry no marker, so a second seed run
// would otherwise find the old church's roles gone with the church and leave
// orphans behind.
func (s *Seeder) resetWebsites(ctx context.Context) error {
	slugs := make([]string, 0, 3)
	for _, b := range s.branches() {
		slugs = append(slugs, b.slug)
	}

	// Marker OR slug. The marker alone misses every church the seeder ADOPTED
	// rather than created — and those are exactly the churches whose roles and
	// website it has been writing into, so a marker-only reset leaves them
	// accumulating across runs. That is not hypothetical: it left eleven
	// leftover roles on one church before this was fixed.
	cursor, err := s.raw.Collection("churches").Find(ctx,
		bson.M{"$or": bson.A{
			bson.M{MarkerField: Marker},
			bson.M{"slug": bson.M{"$in": slugs}},
		}},
		options.Find().SetProjection(bson.M{"_id": 1}))
	if err != nil {
		return fmt.Errorf("seed: find seeded churches: %w", err)
	}
	var churches []struct {
		ID bson.ObjectID `bson:"_id"`
	}
	if err := cursor.All(ctx, &churches); err != nil {
		return fmt.Errorf("seed: read seeded churches: %w", err)
	}
	if len(churches) == 0 {
		return nil
	}

	ids := make(bson.A, 0, len(churches))
	for _, c := range churches {
		// Both storage forms, because Mongoose writes an ObjectId and early Go
		// documents wrote a string (ADR-005).
		ids = append(ids, c.ID, c.ID.Hex())
	}
	filter := bson.M{"churchId": bson.M{"$in": ids}}

	for _, name := range []string{
		site.PageCollection, site.VersionCollection,
		site.BlockCollection, site.ThemeCollection,
		"roles",
	} {
		res, err := s.raw.Collection(name).DeleteMany(ctx, filter)
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
	branches := s.branches()

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

		// Before anything that reads "the member behind this login".
		if err := s.linkLogins(ctx, churchID, created); err != nil {
			return nil, err
		}

		if _, err := s.ministries(ctx, churchID, created); err != nil {
			return nil, err
		}

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

		events, attendance, err := s.events(ctx, churchID, created)
		if err != nil {
			return nil, err
		}
		result.Events += events
		result.Attendance += attendance

		if err := s.website(ctx, churchID, b.name, b.city); err != nil {
			return nil, err
		}

		s.opt.Log.Info("seeded church",
			slog.String("church", b.name),
			slog.Int("members", len(created)),
			slog.Int("transactions", txs),
			slog.Int("events", events),
			slog.Int("attendance", attendance))
	}

	// One org-level admin, so cross-branch visibility can actually be seen.
	orgLogin, err := s.orgAdmin(ctx, orgID, branches[0].slug)
	if err != nil {
		return nil, err
	}
	result.Users++
	result.Logins = append(result.Logins, orgLogin)

	// The platform operator, so the admin app and the settings behind Q-7's
	// role check are reachable through the product rather than only by hand.
	opsLogin, err := s.platformAdmin(ctx, branches[0].slug)
	if err != nil {
		return nil, err
	}
	result.Users++
	result.Logins = append(result.Logins, opsLogin)

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
		City                 string        `bson:"city"`
		Country              string        `bson:"country"`
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
		// Fill in what is MISSING, still without overwriting anything set.
		//
		// An adopted church carries no seed marker, so Reset never removes it —
		// which means anything the adopt path fails to fill stays empty across
		// every future run. Two of the three seeded churches had no city for
		// exactly this reason, and it showed up as ", Ghana" in the operator's
		// church directory.
		if existing.City == "" {
			set["city"] = city
		}
		if existing.Country == "" {
			set["country"] = "Ghana"
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
		// A valid ChurchPlan. "growth" was written here and is not one of
		// free/basic/pro/enterprise — it never surfaced because the seeder
		// ADOPTS the churches that already exist rather than creating them, so
		// the invalid value only lands on a genuinely fresh database. An
		// unrecognised plan normalises to FREE, so a church seeded that way
		// would silently lose the paid features WP-41 gates on.
		"plan": string(church.PlanPro),
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
	// The fourth account is the one WP-27 needs. Welfare is withheld from
	// every blanket grant — the Administrator role holds AllExceptPastoral()
	// — so without somebody in the pastoral role a seeded church has NOBODY
	// who can open a welfare case, and the acceptance criterion ("a church
	// admin cannot read welfare") reads as broken rather than enforced.
	//
	// It also stops the demonstration requiring an admin to be demoted, which
	// is what happened when this account did not exist.
	people := []struct{ role, slugRole, first, last string }{
		{"CHURCH_ADMIN", "", "Emmanuel", "Owusu"},
		{"DEPARTMENT_LEADER", "", "Grace", "Mensah"},
		{"MEMBER", "", "Kwame", "Boateng"},
		{"MEMBER", rbac.SystemPastoral, "Abena", "Asante"},
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(s.opt.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("seed: hash password: %w", err)
	}

	now := time.Now().UTC()
	logins := make([]Login, 0, len(people))

	for _, p := range people {
		label := roleLabel(p.role)
		roleID := s.roleIDFor(ctx, churchID, p.role)
		// An explicit slug overrides the legacy-enum mapping. The pastoral
		// worker's legacy role stays MEMBER on purpose: the enum has no
		// pastoral value, and inventing one would mean touching the legacy
		// TypeScript API, which ADR-005 says we do not do.
		if p.slugRole != "" {
			label = "care"
			if role, err := rbac.NewService(s.db).RoleBySlug(s.scope(churchID), p.slugRole); err == nil {
				roleID = role.ID.Hex()
			} else {
				s.opt.Log.Warn("could not resolve the pastoral role for a seeded user",
					slog.String("slug", p.slugRole), slog.String("error", err.Error()))
			}
		}
		email := fmt.Sprintf("%s@%s.org", strings.ToLower(label), slug)

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
				"roleId":       roleID,
				"churchId":     churchID,
				"isActive":     true,
				MarkerField:    Marker,
				"updatedAt":    now,
			}, "$setOnInsert": bson.M{"createdAt": now}},
			options.UpdateOne().SetUpsert(true))
		if err != nil {
			return nil, fmt.Errorf("seed: user %s: %w", email, err)
		}
		reported := p.role
		if p.slugRole != "" {
			reported = "PASTORAL"
		}
		logins = append(logins, Login{
			Email:    email,
			Password: s.opt.Password,
			Role:     reported,
			Church:   churchName,
			Slug:     slug,
		})
	}
	return logins, nil
}

// platformAdmin creates the ALTAR OS operator account.
//
// Without one the admin app cannot be signed into at all, and neither can the
// platform settings that Q-7 put behind a SUPER_ADMIN role check — so the
// commission rate and the provider rate card were unreachable through the
// product and could only be set by writing to Mongo by hand.
//
// It carries a CHURCH, which looks wrong for a platform operator and is
// deliberate: isPlatformAdmin is scoped exactly as requireRole scopes it, so
// the SUPER_ADMIN bypass only applies to an operator whose token names a church
// — one who has picked a church to act in. A churchless platform admin is
// refused by both guards, which is the existing behaviour and not something
// seeding should quietly widen.
func (s *Seeder) platformAdmin(ctx context.Context, homeSlug string) (Login, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(s.opt.Password), bcrypt.DefaultCost)
	if err != nil {
		return Login{}, fmt.Errorf("seed: hash password: %w", err)
	}

	var home struct {
		ID   bson.ObjectID `bson:"_id"`
		Name string        `bson:"name"`
	}
	if err := s.raw.Collection("churches").
		FindOne(ctx, bson.M{"slug": homeSlug}).Decode(&home); err != nil {
		return Login{}, fmt.Errorf("seed: find home church: %w", err)
	}

	now := time.Now().UTC()
	email := "ops@altaros.com"

	_, err = s.raw.Collection("users").UpdateOne(ctx,
		bson.M{"email": email},
		bson.M{
			"$set": bson.M{
				"email":        email,
				"phone":        s.phoneE164(),
				"passwordHash": string(hash),
				"name":         "Altar OS Operations",
				"role":         church.RoleSuperAdmin,
				"churchId":     home.ID,
				"isActive":     true,
				MarkerField:    Marker,
				"updatedAt":    now,
			},
			"$setOnInsert": bson.M{"createdAt": now},
		},
		options.UpdateOne().SetUpsert(true))
	if err != nil {
		return Login{}, fmt.Errorf("seed: platform admin: %w", err)
	}

	return Login{
		Email:    email,
		Password: s.opt.Password,
		Role:     church.RoleSuperAdmin,
		Church:   "ALTAR OS (platform operator)",
		Slug:     homeSlug,
	}, nil
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

// ministries seeds the departments and cells a church runs, and puts people in
// them.
//
// Needed for WP-22 rather than decorative: the acceptance criterion is a
// broadcast to "inactive members in the youth department", and without a
// department nobody is in, that filter resolves to nobody and the feature looks
// like it works.
func (s *Seeder) ministries(ctx context.Context, churchID bson.ObjectID, members []member.Member) (int, error) {
	names := []string{"Youth", "Choir", "Ushers", "Media", "Children", "Prayer"}
	cells := []string{"East Legon Cell", "Adenta Cell", "Spintex Cell"}

	now := time.Now().UTC()
	departmentIDs := make([]bson.ObjectID, 0, len(names))
	for _, name := range names {
		id := bson.NewObjectID()
		if _, err := s.raw.Collection("departments").InsertOne(ctx, bson.M{
			"_id": id, "churchId": churchID, "name": name,
			MarkerField: Marker, "createdAt": now, "updatedAt": now,
		}); err != nil {
			return 0, fmt.Errorf("seed: department %s: %w", name, err)
		}
		departmentIDs = append(departmentIDs, id)
	}

	groupIDs := make([]bson.ObjectID, 0, len(cells))
	for _, name := range cells {
		id := bson.NewObjectID()
		if _, err := s.raw.Collection("groups").InsertOne(ctx, bson.M{
			"_id": id, "churchId": churchID, "name": name,
			MarkerField: Marker, "createdAt": now, "updatedAt": now,
		}); err != nil {
			return 0, fmt.Errorf("seed: group %s: %w", name, err)
		}
		groupIDs = append(groupIDs, id)
	}

	// Roughly half a congregation serves in something, and a few serve in two.
	// A uniform assignment would make every department the same size, and the
	// targeting feature is only interesting when they are not.
	assigned := 0
	for i := range members {
		if s.rng.Intn(100) < 45 {
			continue
		}
		departments := []bson.ObjectID{departmentIDs[s.rng.Intn(len(departmentIDs))]}
		if s.rng.Intn(100) < 20 {
			second := departmentIDs[s.rng.Intn(len(departmentIDs))]
			if second != departments[0] {
				departments = append(departments, second)
			}
		}
		update := bson.M{"departmentIds": departments}
		if s.rng.Intn(100) < 60 {
			update["groupIds"] = []bson.ObjectID{groupIDs[s.rng.Intn(len(groupIDs))]}
		}
		if _, err := s.raw.Collection("members").UpdateOne(ctx,
			bson.M{"_id": members[i].ID}, bson.M{"$set": update}); err != nil {
			return assigned, fmt.Errorf("seed: assign ministries: %w", err)
		}
		assigned++
	}
	return assigned, nil
}

// linkLogins attaches a member record to each seeded login.
//
// Without this every seeded account is a login with no person behind it, and
// every "my …" path in the product — my RSVP, my giving, my attendance —
// answers "your account is not linked to a member record". That is a real
// state a church can be in, but it is a bad default for the data a developer
// works against every day, because it makes the whole self-service half of the
// app untestable by hand.
//
// The pastor and the department leader are linked too, not only the member:
// leadership attends its own church, and a giving report that excludes the
// people running the church is a report nobody recognises.
func (s *Seeder) linkLogins(ctx context.Context, churchID bson.ObjectID, members []member.Member) error {
	if len(members) == 0 {
		return nil
	}

	cursor, err := s.raw.Collection("users").Find(ctx, bson.M{"churchId": churchID},
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: 1}}))
	if err != nil {
		return fmt.Errorf("seed: find church users: %w", err)
	}
	var users []struct {
		ID   bson.ObjectID `bson:"_id"`
		Name string        `bson:"name"`
	}
	if err := cursor.All(ctx, &users); err != nil {
		return fmt.Errorf("seed: read church users: %w", err)
	}

	// Which users already have a member record here. A re-run without -reset
	// creates a FRESH batch of members and would otherwise try to link the same
	// user to a second one — which the unique (churchId, userId) index refuses,
	// correctly. The index is right; linking blindly was wrong.
	linked := map[string]bool{}
	if cursor, err := s.raw.Collection("members").Find(ctx,
		bson.M{"churchId": churchID, "userId": bson.M{"$type": "objectId"}},
		options.Find().SetProjection(bson.M{"userId": 1})); err == nil {
		var rows []struct {
			UserID bson.ObjectID `bson:"userId"`
		}
		if cursor.All(ctx, &rows) == nil {
			for _, r := range rows {
				linked[r.UserID.Hex()] = true
			}
		}
	}

	for i, user := range users {
		if i >= len(members) {
			break
		}
		if linked[user.ID.Hex()] {
			continue
		}
		first, last, _ := strings.Cut(user.Name, " ")
		update := bson.M{"userId": user.ID}
		if first != "" {
			update["firstName"] = first
		}
		if last != "" {
			update["lastName"] = last
		}
		// Leadership is active by definition — a pastor whose member record
		// says "visitor" makes every status report look broken.
		update["status"] = string(member.StatusActive)

		if _, err := s.raw.Collection("members").UpdateOne(ctx,
			bson.M{"_id": members[i].ID},
			bson.M{"$set": update}); err != nil {
			return fmt.Errorf("seed: link %s: %w", user.Name, err)
		}
	}
	return nil
}

// events seeds a church calendar and the attendance behind it.
//
// A weekly service plus a midweek one plus a couple of one-offs, because those
// four shapes are what exercise the parts that differ: a recurring series is
// one document expanded on read, a one-off is not, and the public site's events
// block has to render both without knowing which it has.
//
// Attendance is written for the Sundays that have already happened, so an
// attendance report has a trend in it rather than a single bar.
func (s *Seeder) events(ctx context.Context, churchID bson.ObjectID, members []member.Member) (int, int, error) {
	scoped := s.scope(churchID)

	svc := event.NewService(s.db, member.NewService(s.db, nil, "GH"))
	if err := svc.EnsureIndexes(scoped); err != nil {
		return 0, 0, err
	}

	now := time.Now().UTC()
	// The Sunday the weekly service started, far enough back that the series is
	// established rather than starting today.
	firstSunday := now.AddDate(0, 0, -int(now.Weekday())-7*s.opt.WeeksOfGiving)
	firstSunday = time.Date(firstSunday.Year(), firstSunday.Month(), firstSunday.Day(),
		9, 0, 0, 0, time.UTC)

	sunday, err := svc.Create(scoped, event.Input{
		Title:          "Sunday Service",
		Description:    "Our main gathering — worship, the word, and communion on the first Sunday of the month.",
		Location:       "Main Auditorium",
		StartDate:      firstSunday,
		EndDate:        firstSunday.Add(2 * time.Hour),
		RecurrenceRule: "FREQ=WEEKLY",
	})
	if err != nil {
		return 0, 0, fmt.Errorf("seed: sunday service: %w", err)
	}

	midweek := firstSunday.AddDate(0, 0, 3).Add(9*time.Hour + 30*time.Minute) // Wednesday 18:30
	others := []event.Input{
		{
			Title:          "Midweek Bible Study",
			Description:    "Working through the book of Acts, chapter by chapter.",
			Location:       "Fellowship Hall",
			StartDate:      midweek,
			EndDate:        midweek.Add(90 * time.Minute),
			RecurrenceRule: "FREQ=WEEKLY;BYDAY=WE",
		},
		{
			Title:       "Leaders' Retreat",
			Description: "Two days away for ministry leads and their spouses.",
			Location:    "Aburi Conference Centre",
			StartDate:   now.AddDate(0, 1, 0).Truncate(time.Hour),
			EndDate:     now.AddDate(0, 1, 2).Truncate(time.Hour),
			Capacity:    40,
		},
		{
			Title:       "Community Outreach",
			Description: "Food distribution and free health screening.",
			Location:    "Market Square",
			StartDate:   now.AddDate(0, 0, 12).Truncate(time.Hour),
			EndDate:     now.AddDate(0, 0, 12).Truncate(time.Hour).Add(5 * time.Hour),
		},
	}

	created := 1
	for _, in := range others {
		if _, err := svc.Create(scoped, in); err != nil {
			return created, 0, fmt.Errorf("seed: event %q: %w", in.Title, err)
		}
		created++
	}

	// Attendance for the Sundays that have already happened. Between half and
	// three-quarters of the congregation each week, which is what a real
	// register looks like and what makes the "who has stopped coming" report
	// have anything to find.
	recorded := 0
	for week := 0; week <= s.opt.WeeksOfGiving; week++ {
		occurrence := firstSunday.AddDate(0, 0, 7*week)
		if occurrence.After(now) {
			break
		}

		present := len(members)/2 + s.rng.Intn(max(1, len(members)/4))
		batch := make([]event.CheckIn, 0, present)
		seen := map[string]bool{}
		for len(batch) < present {
			m := members[s.rng.Intn(len(members))]
			if seen[m.ID.Hex()] {
				continue
			}
			seen[m.ID.Hex()] = true

			method := event.CheckInQR
			// Somebody always forgets their phone.
			if s.rng.Intn(100) < 15 {
				method = event.CheckInManual
			}
			batch = append(batch, event.CheckIn{
				MemberID: m.ID.Hex(),
				Method:   method,
				// Arriving across the half hour either side of the start.
				CheckedInAt: occurrence.Add(time.Duration(s.rng.Intn(60)-30) * time.Minute),
			})
		}

		result, err := svc.Sync(scoped, event.SyncRequest{
			EventID:    sunday.ID.Hex(),
			CheckIns:   batch,
			Occurrence: occurrence,
		})
		if err != nil {
			return created, recorded, fmt.Errorf("seed: attendance: %w", err)
		}
		recorded += result.Recorded
	}

	// Marked so Reset removes exactly these. Events and attendance are written
	// through the tenant wrapper, which stamps churchId and not the marker.
	for _, name := range []string{event.Collection, event.AttendanceCollection, event.RSVPCollection} {
		if _, err := s.raw.Collection(name).UpdateMany(ctx,
			bson.M{"churchId": churchID},
			bson.M{"$set": bson.M{MarkerField: Marker}}); err != nil {
			return created, recorded, fmt.Errorf("seed: mark %s: %w", name, err)
		}
	}
	return created, recorded, nil
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

// website gives a church a published home page (WP-40).
//
// Seeded because a CMS with no content cannot be judged: the interesting
// questions — does the draft stay private, does rollback restore, does the
// public renderer see only what is published — all need a page that exists.
// It also means `make seed` produces a subdomain that actually serves
// something, which is what makes WP-39 demonstrable rather than described.
func (s *Seeder) website(ctx context.Context, churchID bson.ObjectID, name, city string) error {
	scoped := s.scope(churchID)
	svc := site.NewService(s.db)

	if err := svc.EnsureIndexes(scoped); err != nil {
		return fmt.Errorf("seed: site indexes: %w", err)
	}

	// A re-run without -reset previously died here with "a page already exists
	// at that address", while the command's own output says "Re-running is
	// additive". A tool that documents a mode it then crashes in is worse than
	// one that never offered it: the next person reasonably assumes the crash
	// means something is broken, and reaches for -reset — which deletes data.
	//
	// An existing home page is not an error, it is the additive case. The
	// church already has a website and the seeder leaves it alone.
	if pages, lookupErr := svc.Pages(scoped); lookupErr == nil && len(pages) > 0 {
		s.opt.Log.Info("church already has a website, leaving it alone",
			slog.String("church", name), slog.Int("pages", len(pages)))
		return nil
	}

	home, err := svc.CreatePage(scoped, site.PageInput{
		Slug:  "",
		Title: name,
		SEODescription: fmt.Sprintf(
			"%s is a church in %s. Join us on Sunday.", name, city),
		InNav:    true,
		NavOrder: 10,
	})
	if err != nil {
		return fmt.Errorf("seed: create home page: %w", err)
	}

	blocks := []site.BlockInput{
		{Type: site.BlockHero, Data: map[string]any{
			"heading":    name,
			"subheading": "A place to belong, in " + city + ".",
			"ctaLabel":   "Plan your visit",
			"ctaUrl":     "/visit",
		}},
		{Type: site.BlockServiceTimes, Data: map[string]any{
			"services": []any{
				map[string]any{
					"name": "Sunday Worship", "time": "9:00 AM",
					"location": "Main Auditorium",
				},
				map[string]any{
					"name": "Midweek Service", "time": "Wednesday 6:30 PM",
					"location": "Fellowship Hall",
				},
			},
		}},
		// The three that read the church's own records, so a seeded site shows
		// what "never re-typed" means rather than only asserting it.
		{Type: site.BlockEvents, Data: map[string]any{"limit": 3}},
		{Type: site.BlockGivingCTA, Data: map[string]any{
			"body": "Your giving supports the work of this church.",
		}},
		{Type: site.BlockRichText, Data: map[string]any{"content": []any{
			map[string]any{
				"type": "heading", "level": 2,
				"spans": []any{map[string]any{"text": "New here?"}},
			},
			map[string]any{
				"type": "paragraph",
				"spans": []any{
					map[string]any{"text": "Come as you are. We would love to meet you — "},
					map[string]any{
						"text": "get in touch", "marks": []any{"link"}, "href": "/contact",
					},
					map[string]any{"text": " before you visit."},
				},
			},
		}}},
	}
	if _, err := svc.SetBlocks(scoped, home.ID.Hex(), blocks); err != nil {
		return fmt.Errorf("seed: home page blocks: %w", err)
	}
	if _, err := svc.Publish(scoped, home.ID.Hex(), "Initial site"); err != nil {
		return fmt.Errorf("seed: publish home page: %w", err)
	}

	// A second page left as an UNPUBLISHED draft, deliberately. It is what
	// makes "the public sees only what is published" observable in the seeded
	// data rather than only in a test.
	draft, err := svc.CreatePage(scoped, site.PageInput{
		Slug: "visit", Title: "Plan your visit", InNav: true, NavOrder: 20,
	})
	if err != nil {
		return fmt.Errorf("seed: create visit page: %w", err)
	}
	if _, err := svc.SetBlocks(scoped, draft.ID.Hex(), []site.BlockInput{
		{Type: site.BlockRichText, Data: map[string]any{"content": []any{
			map[string]any{
				"type":  "paragraph",
				"spans": []any{map[string]any{"text": "Parking is behind the building."}},
			},
		}}},
	}); err != nil {
		return fmt.Errorf("seed: visit page blocks: %w", err)
	}

	if _, err := svc.SetTheme(scoped, site.Theme{
		Palette: "warm", Typography: "classic", Mode: "light",
	}); err != nil {
		return fmt.Errorf("seed: theme: %w", err)
	}
	return nil
}
