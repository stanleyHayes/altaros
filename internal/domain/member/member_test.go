package member

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

// capturePublisher records emitted events.
type capturePublisher struct {
	events []struct {
		Topic, Key string
		Payload    any
	}
}

func (c *capturePublisher) Publish(_ context.Context, topic, key string, payload any) error {
	c.events = append(c.events, struct {
		Topic, Key string
		Payload    any
	}{topic, key, payload})
	return nil
}

func (c *capturePublisher) countOf(topic string) int {
	n := 0
	for _, e := range c.events {
		if e.Topic == topic {
			n++
		}
	}
	return n
}

func newService(t *testing.T) (*Service, *capturePublisher, context.Context) {
	t.Helper()

	uri := os.Getenv("MONGODB_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}
	connectCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	db, err := mongodb.Connect(connectCtx, config.MongoConfig{
		URI:            uri,
		Database:       "altar_test_member",
		ConnectTimeout: 3 * time.Second,
	})
	if err != nil {
		testsupport.SkipOrFail(t, "MongoDB", err)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = db.Database().Drop(c)
		_ = db.Close(c)
	})

	pub := &capturePublisher{}
	svc := NewService(db, pub, "GH")

	ctx := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: "church_member_test",
		UserID:   "admin_1",
		Role:     "CHURCH_ADMIN",
	})
	if err := svc.EnsureIndexes(ctx); err != nil {
		t.Fatalf("EnsureIndexes: %v", err)
	}
	return svc, pub, ctx
}

// WP-12 acceptance: 1,000 rows in mixed formats produce 1,000 members, zero
// duplicates, all stored as E.164.
func TestBulkImportOfMixedFormatsProducesNoDuplicates(t *testing.T) {
	svc, _, ctx := newService(t)

	// Every row is a distinct person, but written the way a real church
	// spreadsheet is: inconsistently.
	formats := []string{
		"0%09d", "+233%09d", "233%09d", "%09d", "0%09d ", " +233%09d",
	}
	rows := make([]ImportRow, 0, 1000)
	for i := 0; i < 1000; i++ {
		national := 240000000 + i // distinct 9-digit national numbers
		rows = append(rows, ImportRow{
			FirstName: fmt.Sprintf("Member%04d", i),
			LastName:  "Test",
			Phone:     fmt.Sprintf(formats[i%len(formats)], national),
		})
	}

	result, err := svc.Import(ctx, rows)
	if err != nil {
		t.Fatalf("Import: %v", err)
	}
	if len(result.Failures) > 0 {
		t.Fatalf("no row should fail; first failure: row %d — %s",
			result.Failures[0].Row, result.Failures[0].Reason)
	}
	if result.Created != 1000 {
		t.Fatalf("want 1000 created, got %d (updated=%d skipped=%d)",
			result.Created, result.Updated, result.Skipped)
	}

	count, err := svc.Count(ctx, "")
	if err != nil {
		t.Fatalf("Count: %v", err)
	}
	if count != 1000 {
		t.Fatalf("want 1000 members stored, got %d", count)
	}

	// Every stored number must be E.164.
	members, err := svc.List(ctx, "", 1000)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	for _, m := range members {
		if m.PhoneE164 == "" {
			t.Fatalf("member %s stored with no phone", m.FullName())
		}
		if !isE164(m.PhoneE164) {
			t.Fatalf("member %s stored a non-E.164 number: %q", m.FullName(), m.PhoneE164)
		}
	}
}

func TestSelfSignupLinksExistingRosterIdentityWithoutDuplicatingIt(t *testing.T) {
	svc, pub, ctx := newService(t)
	existing, err := svc.Create(ctx, Input{
		FirstName: "Ama", LastName: "Mensah", Phone: "024 123 4567",
		Email: "ama@example.com", Status: StatusActive,
	})
	if err != nil {
		t.Fatalf("create roster member: %v", err)
	}
	userID := bson.NewObjectID().Hex()
	linked, err := svc.LinkOrCreateForUser(ctx, userID, Input{
		FirstName: "Ama", LastName: "Mensah", Phone: "+233241234567",
		Email: "AMA@example.com", Status: StatusActive,
	})
	if err != nil {
		t.Fatalf("link existing member: %v", err)
	}
	if linked.ID != existing.ID || linked.UserID.String() != userID {
		t.Fatalf("link created the wrong identity: %+v", linked)
	}
	if pub.countOf(TopicMemberCreated) != 1 {
		t.Fatalf("link emitted a duplicate member-created event: %d", pub.countOf(TopicMemberCreated))
	}
	if _, err := svc.LinkOrCreateForUser(ctx, bson.NewObjectID().Hex(), Input{
		FirstName: "Ama", Phone: "0241234567", Email: "ama@example.com",
	}); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("second account took an already-linked member: %v", err)
	}
}

func TestSelfSignupCreatesLinkedRosterIdentityWhenNoneExists(t *testing.T) {
	svc, pub, ctx := newService(t)
	userID := bson.NewObjectID().Hex()
	created, err := svc.LinkOrCreateForUser(ctx, userID, Input{
		FirstName: "Esi", LastName: "Boateng", Phone: "0555000199",
		Email: "esi@example.com", Status: StatusActive,
	})
	if err != nil {
		t.Fatalf("create linked member: %v", err)
	}
	if created.UserID.String() != userID || created.Status != StatusActive {
		t.Fatalf("created member is not linked and active: %+v", created)
	}
	if pub.countOf(TopicMemberCreated) != 1 {
		t.Fatalf("created member emitted %d events, want one", pub.countOf(TopicMemberCreated))
	}
}

func isE164(s string) bool {
	if len(s) < 8 || s[0] != '+' {
		return false
	}
	for _, r := range s[1:] {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// The same person written two ways in one file is one member, not two.
func TestImportDeduplicatesWithinTheFile(t *testing.T) {
	svc, _, ctx := newService(t)

	rows := []ImportRow{
		{FirstName: "Ama", LastName: "Owusu", Phone: "0241234567"},
		{FirstName: "Ama", LastName: "Owusu", Phone: "+233 24 123 4567"}, // same number
		{FirstName: "Kofi", LastName: "Boateng", Phone: "0209876543"},
	}

	result, err := svc.Import(ctx, rows)
	if err != nil {
		t.Fatalf("Import: %v", err)
	}
	if result.Created != 2 {
		t.Errorf("want 2 created, got %d", result.Created)
	}
	if result.Skipped != 1 {
		t.Errorf("the duplicate spelling should be skipped, got %d", result.Skipped)
	}
	if len(result.Failures) != 1 || result.Failures[0].Row != 2 {
		t.Errorf("the skip should be reported against row 2, got %+v", result.Failures)
	}
}

// Re-importing the same file must not double the congregation.
func TestReimportUpdatesRatherThanDuplicates(t *testing.T) {
	svc, _, ctx := newService(t)

	rows := []ImportRow{
		{FirstName: "Ama", LastName: "Owusu", Phone: "0241234567"},
		{FirstName: "Kofi", LastName: "Boateng", Phone: "0209876543"},
	}

	if _, err := svc.Import(ctx, rows); err != nil {
		t.Fatalf("first import: %v", err)
	}

	// Second pass, one name corrected and formats changed.
	rows[0].LastName = "Owusu-Ansah"
	rows[0].Phone = "+233241234567"
	second, err := svc.Import(ctx, rows)
	if err != nil {
		t.Fatalf("second import: %v", err)
	}
	if second.Created != 0 || second.Updated != 2 {
		t.Errorf("re-import should update both, got created=%d updated=%d",
			second.Created, second.Updated)
	}

	count, _ := svc.Count(ctx, "")
	if count != 2 {
		t.Fatalf("congregation must not double on re-import, got %d", count)
	}

	updated, err := svc.ByPhone(ctx, "024 123 4567")
	if err != nil {
		t.Fatalf("ByPhone: %v", err)
	}
	if updated.LastName != "Owusu-Ansah" {
		t.Errorf("the corrected name should have been applied, got %q", updated.LastName)
	}
}

// A few bad rows must not reject the whole file.
func TestBadRowsDoNotFailTheImport(t *testing.T) {
	svc, _, ctx := newService(t)

	rows := []ImportRow{
		{FirstName: "Ama", LastName: "Owusu", Phone: "0241234567"},
		{FirstName: "", LastName: "", Phone: "0201111111"}, // no name
		{FirstName: "Kofi", LastName: "B", Phone: "024"},   // unusable number
		{FirstName: "Yaw", LastName: "Darko", Phone: "0277654321"},
	}

	result, err := svc.Import(ctx, rows)
	if err != nil {
		t.Fatalf("Import: %v", err)
	}
	if result.Created != 2 {
		t.Errorf("the two good rows should load, got %d", result.Created)
	}
	if len(result.Failures) != 2 {
		t.Fatalf("both bad rows should be reported, got %+v", result.Failures)
	}
	// Row numbers are 1-based so they line up with a spreadsheet.
	if result.Failures[0].Row != 2 || result.Failures[1].Row != 3 {
		t.Errorf("failures should name rows 2 and 3, got %+v", result.Failures)
	}
}

// Any spelling must find the member, because the lookup normalises too.
func TestLookupByAnySpelling(t *testing.T) {
	svc, _, ctx := newService(t)

	if _, err := svc.Create(ctx, Input{FirstName: "Ama", LastName: "Owusu", Phone: "0241234567"}); err != nil {
		t.Fatalf("Create: %v", err)
	}

	for _, spelling := range []string{"0241234567", "+233241234567", "024 123 4567", "241234567"} {
		if _, err := svc.ByPhone(ctx, spelling); err != nil {
			t.Errorf("ByPhone(%q) should find the member: %v", spelling, err)
		}
	}
}

func TestDuplicatePhoneInSameChurchIsRejected(t *testing.T) {
	svc, _, ctx := newService(t)

	if _, err := svc.Create(ctx, Input{FirstName: "Ama", LastName: "O", Phone: "0241234567"}); err != nil {
		t.Fatalf("first create: %v", err)
	}
	if _, err := svc.Create(ctx, Input{FirstName: "Someone", LastName: "Else", Phone: "+233 24 123 4567"}); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("want ErrDuplicate for the same number, got %v", err)
	}
}

// The same person may legitimately belong to two churches.
func TestSameNumberAllowedInDifferentChurches(t *testing.T) {
	svc, _, ctxA := newService(t)
	ctxB := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: "another_church", UserID: "admin_2", Role: "CHURCH_ADMIN",
	})

	if _, err := svc.Create(ctxA, Input{FirstName: "Ama", LastName: "O", Phone: "0241234567"}); err != nil {
		t.Fatalf("church A: %v", err)
	}
	if _, err := svc.Create(ctxB, Input{FirstName: "Ama", LastName: "O", Phone: "0241234567"}); err != nil {
		t.Fatalf("the same person may attend two churches: %v", err)
	}
}

// Members with no phone must not collide with each other via the unique index.
func TestMultipleMembersWithoutPhone(t *testing.T) {
	svc, _, ctx := newService(t)

	for i := 0; i < 3; i++ {
		if _, err := svc.Create(ctx, Input{
			FirstName: fmt.Sprintf("Pastoral%d", i), LastName: "Record",
		}); err != nil {
			t.Fatalf("record %d: %v", i, err)
		}
	}
	count, _ := svc.Count(ctx, "")
	if count != 3 {
		t.Fatalf("all three phone-less records should store, got %d", count)
	}
}

// A member with no recorded journey is a visitor, not active — assuming
// otherwise inflates every engagement metric.
func TestDefaultStatusIsVisitor(t *testing.T) {
	svc, _, ctx := newService(t)

	m, err := svc.Create(ctx, Input{FirstName: "New", LastName: "Person"})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if m.Status != StatusVisitor {
		t.Errorf("want visitor, got %s", m.Status)
	}
}

func TestStatusTransitionEmitsEvent(t *testing.T) {
	svc, pub, ctx := newService(t)

	m, err := svc.Create(ctx, Input{FirstName: "New", LastName: "Person"})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if pub.countOf(TopicMemberCreated) != 1 {
		t.Errorf("creation should emit one event, got %d", pub.countOf(TopicMemberCreated))
	}

	if err := svc.SetStatus(ctx, m.ID.Hex(), StatusNewConvert); err != nil {
		t.Fatalf("SetStatus: %v", err)
	}
	if pub.countOf(TopicMemberStatusChanged) != 1 {
		t.Fatalf("a transition should emit one event, got %d", pub.countOf(TopicMemberStatusChanged))
	}

	// Setting the same status again is not a transition.
	if err := svc.SetStatus(ctx, m.ID.Hex(), StatusNewConvert); err != nil {
		t.Fatalf("idempotent SetStatus: %v", err)
	}
	if pub.countOf(TopicMemberStatusChanged) != 1 {
		t.Error("re-setting the same status must not emit a second event")
	}
}

func TestInvalidStatusIsRejected(t *testing.T) {
	svc, _, ctx := newService(t)

	if _, err := svc.Create(ctx, Input{
		FirstName: "X", LastName: "Y", Status: Status("vip"),
	}); !errors.Is(err, ErrInvalidStatus) {
		t.Fatalf("want ErrInvalidStatus, got %v", err)
	}
}

func TestNameIsRequired(t *testing.T) {
	svc, _, ctx := newService(t)

	if _, err := svc.Create(ctx, Input{Phone: "0241234567"}); !errors.Is(err, ErrNameRequired) {
		t.Fatalf("want ErrNameRequired, got %v", err)
	}
}

// Members are tenant-scoped like everything else.
func TestMembersDoNotCrossChurches(t *testing.T) {
	svc, _, ctxA := newService(t)
	ctxB := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: "other_church", UserID: "u", Role: "CHURCH_ADMIN",
	})

	if _, err := svc.Create(ctxA, Input{FirstName: "Ama", LastName: "O", Phone: "0241234567"}); err != nil {
		t.Fatalf("create: %v", err)
	}

	if _, err := svc.ByPhone(ctxB, "0241234567"); !errors.Is(err, ErrNotFound) {
		t.Fatal("another church must not see this member")
	}
	count, _ := svc.Count(ctxB, "")
	if count != 0 {
		t.Fatalf("another church should see no members, got %d", count)
	}
}

func TestImportRequiresTenantScope(t *testing.T) {
	svc, _, _ := newService(t)

	if _, err := svc.Import(context.Background(), []ImportRow{
		{FirstName: "A", LastName: "B", Phone: "0241234567"},
	}); !errors.Is(err, tenancy.ErrNoTenant) {
		t.Fatalf("want ErrNoTenant, got %v", err)
	}
}
