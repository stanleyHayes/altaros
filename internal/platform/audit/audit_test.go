package audit

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

func newLogger(t *testing.T) (*Logger, context.Context) {
	t.Helper()

	uri := os.Getenv("MONGODB_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}

	connectCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	db, err := mongodb.Connect(connectCtx, config.MongoConfig{
		URI:            uri,
		Database:       "altar_test_audit",
		ConnectTimeout: 3 * time.Second,
	})
	if err != nil {
		testsupport.SkipOrFail(t, "MongoDB", err)
	}

	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = db.Database().Drop(c)
		_ = db.Close(c)
	})

	ctx := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: "church_audit",
		UserID:   "pastor_1",
		Role:     "CHURCH_ADMIN",
	})
	ctx = WithRequestMetadata(ctx, "41.210.0.7", "req-abc123")

	l := NewLogger(db)
	if err := l.EnsureIndexes(ctx); err != nil {
		t.Fatalf("EnsureIndexes: %v", err)
	}
	return l, ctx
}

// WP-08 acceptance: reading a prayer request writes an audit row.
func TestReadingPrayerRequestIsAudited(t *testing.T) {
	l, ctx := newLogger(t)

	l.RecordRead(ctx, ResourcePrayer, "prayer_42")

	entries, err := l.ForResource(ctx, ResourcePrayer, "prayer_42")
	if err != nil {
		t.Fatalf("ForResource: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("reading a prayer request must write exactly one audit row, got %d", len(entries))
	}

	e := entries[0]
	if e.Action != ActionRead {
		t.Errorf("action: want %s, got %s", ActionRead, e.Action)
	}
	// Attribution comes from the request scope, not the caller, so a handler
	// cannot log someone else's identity.
	if e.ActorID != "pastor_1" || e.ActorRole != "CHURCH_ADMIN" {
		t.Errorf("actor should come from the request scope, got %s/%s", e.ActorID, e.ActorRole)
	}
	if e.ChurchID != "church_audit" {
		t.Errorf("entry must be tenant-scoped, got %s", e.ChurchID)
	}
	if e.IP != "41.210.0.7" || e.RequestID != "req-abc123" {
		t.Errorf("request metadata should be captured, got ip=%s reqId=%s", e.IP, e.RequestID)
	}
	if e.CreatedAt.IsZero() {
		t.Error("entry must be timestamped")
	}
}

func TestWelfareReadsAreAudited(t *testing.T) {
	l, ctx := newLogger(t)

	l.RecordRead(ctx, ResourceWelfare, "case_7")

	entries, err := l.ForResource(ctx, ResourceWelfare, "case_7")
	if err != nil {
		t.Fatalf("ForResource: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("welfare case reads must be audited, got %d entries", len(entries))
	}
}

// Ordinary reads must not be audited, or the log drowns in noise and the
// sensitive accesses become impossible to find.
func TestNonSensitiveReadsAreNotAudited(t *testing.T) {
	l, ctx := newLogger(t)

	l.RecordRead(ctx, ResourceMember, "member_1")

	entries, err := l.ForResource(ctx, ResourceMember, "member_1")
	if err != nil {
		t.Fatalf("ForResource: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("routine member reads should not be audited, got %d", len(entries))
	}
}

// Refused attempts are the entries that reveal probing.
func TestDeniedAccessIsRecorded(t *testing.T) {
	l, ctx := newLogger(t)

	l.RecordDenied(ctx, ResourceWelfare, "case_9", "actor lacks the welfare role")

	entries, err := l.ForResource(ctx, ResourceWelfare, "case_9")
	if err != nil {
		t.Fatalf("ForResource: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("denied access must be recorded, got %d", len(entries))
	}
	if entries[0].Action != ActionDenied {
		t.Errorf("want %s, got %s", ActionDenied, entries[0].Action)
	}
	if entries[0].Reason == "" {
		t.Error("a denial without a reason is not useful evidence")
	}
}

// "What did this user access?" must be answerable, newest first.
func TestActorHistoryIsQueryable(t *testing.T) {
	l, ctx := newLogger(t)

	l.RecordRead(ctx, ResourcePrayer, "p1")
	l.RecordRead(ctx, ResourceWelfare, "w1")
	l.Record(ctx, ActionExport, ResourceMemberExport, "export_1", "subject access request")

	entries, err := l.ForActor(ctx, "pastor_1")
	if err != nil {
		t.Fatalf("ForActor: %v", err)
	}
	if len(entries) != 3 {
		t.Fatalf("want 3 entries for this actor, got %d", len(entries))
	}
	for i := 1; i < len(entries); i++ {
		prev, cur := entries[i-1], entries[i]
		if cur.CreatedAt.After(prev.CreatedAt) {
			t.Error("actor history must be newest-first")
		}
	}
}

// The audit log is tenant-scoped like everything else: one church must not be
// able to read another's access history.
func TestAuditIsTenantScoped(t *testing.T) {
	l, ctxA := newLogger(t)
	ctxB := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: "other_church", UserID: "u2", Role: "CHURCH_ADMIN",
	})

	l.RecordRead(ctxA, ResourcePrayer, "prayer_x")

	entries, err := l.ForResource(ctxB, ResourcePrayer, "prayer_x")
	if err != nil {
		t.Fatalf("ForResource: %v", err)
	}
	if len(entries) != 0 {
		t.Fatal("one church must not see another church's audit entries")
	}
}

// An entry with no tenant is dropped rather than written unattributed — but
// it must not panic or take the request down with it.
func TestMissingTenantDoesNotPanic(t *testing.T) {
	l, _ := newLogger(t)

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("audit must not panic without a tenant: %v", r)
		}
	}()
	l.RecordRead(context.Background(), ResourcePrayer, "p1")
}

func TestSensitivityClassification(t *testing.T) {
	for _, r := range []ResourceType{ResourcePrayer, ResourceWelfare, ResourceMemberExport} {
		if !IsSensitive(r) {
			t.Errorf("%s must be treated as sensitive on read", r)
		}
	}
	for _, r := range []ResourceType{ResourceMember, ResourceTransaction} {
		if IsSensitive(r) {
			t.Errorf("%s should not trigger read auditing", r)
		}
	}
}
