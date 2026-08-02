package welfare

import (
	"context"
	"errors"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/audit"
	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/fieldcrypt"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

// WP-27 acceptance: "a church admin without the welfare role cannot read case
// details via any endpoint; attempts are audited." The ACL half lives in the
// HTTP layer; what is provable here is the rest of §3.4(3) — that the contents
// are genuinely encrypted at rest, that a listing cannot leak them, and that
// every touch leaves a trail.

type recordedEntry struct {
	Action   audit.Action
	Resource audit.ResourceType
	ID       string
	Reason   string
}

type recordingAuditor struct{ entries []recordedEntry }

func (a *recordingAuditor) Record(_ context.Context, action audit.Action,
	resource audit.ResourceType, id, reason string) {
	a.entries = append(a.entries, recordedEntry{action, resource, id, reason})
}

func (a *recordingAuditor) RecordRead(ctx context.Context, resource audit.ResourceType, id string) {
	a.Record(ctx, audit.ActionRead, resource, id, "")
}

func (a *recordingAuditor) RecordDenied(ctx context.Context, resource audit.ResourceType, id, reason string) {
	a.Record(ctx, audit.ActionDenied, resource, id, reason)
}

func (a *recordingAuditor) count(action audit.Action) int {
	n := 0
	for _, e := range a.entries {
		if e.Action == action {
			n++
		}
	}
	return n
}

type fixture struct {
	svc     *Service
	ctx     context.Context
	db      *mongodb.DB
	auditor *recordingAuditor
}

const welfareKey = "a-separate-welfare-key"

func newFixture(t *testing.T, crypto *fieldcrypt.Cipher) *fixture {
	t.Helper()

	uri := testsupport.MongoURI()
	connect, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	db, err := mongodb.Connect(connect, config.MongoConfig{
		URI: uri, Database: "altar_test_welfare", ConnectTimeout: 3 * time.Second,
	})
	if err != nil {
		testsupport.SkipOrFail(t, "MongoDB at "+uri, err)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = db.Database().Drop(c)
		_ = db.Close(c)
	})

	ctx := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: bson.NewObjectID().Hex(),
		UserID:   bson.NewObjectID().Hex(),
		Role:     "CHURCH_ADMIN",
	})
	auditor := &recordingAuditor{}
	svc := NewService(db, crypto, auditor)
	if err := svc.EnsureIndexes(ctx); err != nil {
		t.Fatalf("indexes: %v", err)
	}
	return &fixture{svc: svc, ctx: ctx, db: db, auditor: auditor}
}

func withKey(t *testing.T) *fixture {
	t.Helper()
	c, err := fieldcrypt.New(welfareKey)
	if err != nil {
		t.Fatalf("cipher: %v", err)
	}
	return newFixture(t, c)
}

const disclosure = "Rent arrears of GHS 400. Landlord threatening eviction on Friday."

func TestCaseContentsAreUnreadableInTheDatabase(t *testing.T) {
	// The property that survives a stolen backup. Tenant isolation and an ACL
	// protect this from other USERS; neither protects it from anybody who
	// obtains the database.
	f := withKey(t)
	opened, err := f.svc.Open(f.ctx, Input{
		MemberID: "member_1", Category: CategoryHousing,
		Summary: disclosure, Detail: "Spoke to the landlord on Tuesday.",
	})
	if err != nil {
		t.Fatalf("open: %v", err)
	}

	// Read the RAW document, the way somebody with the database would.
	var raw bson.M
	if err := f.db.Global(Collection).FindOne(context.Background(),
		bson.M{"_id": opened.ID}).Decode(&raw); err != nil {
		t.Fatalf("raw read: %v", err)
	}

	stored, _ := raw["summary"].(string)
	if stored == disclosure {
		t.Fatal("the case summary is stored in plaintext")
	}
	if !fieldcrypt.IsEncrypted(stored) {
		t.Fatalf("the stored summary is not encrypted: %q", stored)
	}
	if detail, _ := raw["detail"].(string); !fieldcrypt.IsEncrypted(detail) {
		t.Fatalf("the stored detail is not encrypted: %q", detail)
	}
	// And the metadata IS readable, which the package comment states plainly
	// rather than pretending otherwise.
	if raw["memberId"] != "member_1" {
		t.Error("the member reference should stay queryable")
	}
}

func TestADifferentKeyCannotReadTheCase(t *testing.T) {
	// The whole point of a SEPARATE key: holding the database and the JWT
	// secret is not enough.
	f := withKey(t)
	opened, err := f.svc.Open(f.ctx, Input{
		MemberID: "member_1", Summary: disclosure,
	})
	if err != nil {
		t.Fatalf("open: %v", err)
	}

	wrong, _ := fieldcrypt.New("the-jwt-secret")
	other := NewService(f.db, wrong, &recordingAuditor{})
	if _, err := other.ByID(f.ctx, opened.ID.Hex()); err == nil {
		t.Fatal("a service with a different key read the case")
	}
}

func TestAListingNeverCarriesCaseContents(t *testing.T) {
	// A church needs to see it has cases without putting people's
	// circumstances on a screen somebody walks past.
	f := withKey(t)
	for i := 0; i < 3; i++ {
		if _, err := f.svc.Open(f.ctx, Input{
			MemberID: "member_1", Summary: disclosure, Detail: "detail",
		}); err != nil {
			t.Fatalf("open: %v", err)
		}
	}

	queue, err := f.svc.Queue(f.ctx, "", true)
	if err != nil {
		t.Fatalf("queue: %v", err)
	}
	if len(queue) != 3 {
		t.Fatalf("queue has %d cases, want 3", len(queue))
	}
	// CaseSummary has no field that could carry the narrative — that is
	// structural rather than a filter somebody has to remember. This asserts
	// the shape has not grown one.
	encoded, err := bson.MarshalExtJSON(bson.M{"q": queue}, false, false)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if contains(string(encoded), "Rent arrears") {
		t.Fatalf("a listing leaked case contents: %s", encoded)
	}
}

func TestWithNoKeyNothingIsStoredAtAll(t *testing.T) {
	// The failure that would matter most: a church recording a safeguarding
	// disclosure in plaintext while believing it is protected. Refusing is the
	// correct outcome.
	f := newFixture(t, nil)
	if _, err := f.svc.Open(f.ctx, Input{
		MemberID: "member_1", Summary: disclosure,
	}); !errors.Is(err, ErrNotEncrypted) {
		t.Fatalf("a case was stored with no key: %v", err)
	}

	n, err := f.db.Global(Collection).CountDocuments(context.Background(), bson.M{})
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Fatalf("%d cases were written with no encryption key", n)
	}
}

func TestEveryTouchIsAudited(t *testing.T) {
	// §3.4(3), and the only after-the-fact answer to "who looked at this".
	f := withKey(t)
	opened, err := f.svc.Open(f.ctx, Input{MemberID: "member_1", Summary: disclosure})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if f.auditor.count(audit.ActionCreate) != 1 {
		t.Error("opening a case was not audited")
	}

	if _, err := f.svc.ByID(f.ctx, opened.ID.Hex()); err != nil {
		t.Fatalf("read: %v", err)
	}
	if f.auditor.count(audit.ActionRead) != 1 {
		t.Error("reading a case was not audited")
	}

	if _, err := f.svc.AddNote(f.ctx, opened.ID.Hex(), "Visited on Wednesday"); err != nil {
		t.Fatalf("note: %v", err)
	}
	if _, err := f.svc.SetStatus(f.ctx, opened.ID.Hex(), StatusResolved); err != nil {
		t.Fatalf("status: %v", err)
	}
	if f.auditor.count(audit.ActionUpdate) != 2 {
		t.Errorf("updates audited %d times, want 2", f.auditor.count(audit.ActionUpdate))
	}

	// A refusal is the entry that matters most.
	f.svc.Denied(f.ctx, opened.ID.Hex(), "no welfare permission")
	if f.auditor.count(audit.ActionDenied) != 1 {
		t.Error("a refused attempt was not audited")
	}
}

func TestALISTINGDoesNotCountAsReadingACase(t *testing.T) {
	// If a listing were audited as a read, every entry would look the same and
	// the trail would answer nothing. Opening a case is the act worth
	// recording.
	f := withKey(t)
	if _, err := f.svc.Open(f.ctx, Input{MemberID: "m", Summary: disclosure}); err != nil {
		t.Fatalf("open: %v", err)
	}
	before := f.auditor.count(audit.ActionRead)
	if _, err := f.svc.Queue(f.ctx, "", true); err != nil {
		t.Fatalf("queue: %v", err)
	}
	if f.auditor.count(audit.ActionRead) != before {
		t.Error("listing the queue was recorded as reading case details")
	}
}

func TestASafeguardingCaseIsNeverRoutine(t *testing.T) {
	// Somebody filing one in a hurry must not be able to leave it at the
	// bottom of a queue by accepting a default.
	f := withKey(t)
	opened, err := f.svc.Open(f.ctx, Input{
		MemberID: "member_1", Category: CategorySafeguarding,
		Urgency: UrgencyRoutine, Summary: "Child disclosed abuse at home.",
	})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if opened.Urgency == UrgencyRoutine {
		t.Fatal("a safeguarding case was filed as routine")
	}
	// An explicitly higher urgency is respected rather than overwritten.
	emergency, err := f.svc.Open(f.ctx, Input{
		MemberID: "member_2", Category: CategorySafeguarding,
		Urgency: UrgencyEmergency, Summary: "Immediate risk.",
	})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if emergency.Urgency != UrgencyEmergency {
		t.Fatalf("an emergency was downgraded to %q", emergency.Urgency)
	}
}

func TestNotesRoundTripThroughEncryption(t *testing.T) {
	f := withKey(t)
	opened, err := f.svc.Open(f.ctx, Input{MemberID: "m", Summary: disclosure})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	const note = "Paid GHS 200 towards the arrears from the benevolent fund."
	updated, err := f.svc.AddNote(f.ctx, opened.ID.Hex(), note)
	if err != nil {
		t.Fatalf("note: %v", err)
	}
	if len(updated.Notes) != 1 || updated.Notes[0].Body != note {
		t.Fatalf("the note did not round trip: %+v", updated.Notes)
	}

	var raw bson.M
	_ = f.db.Global(Collection).FindOne(context.Background(),
		bson.M{"_id": opened.ID}).Decode(&raw)
	encoded, _ := bson.MarshalExtJSON(raw, false, false)
	if contains(string(encoded), "benevolent fund") {
		t.Fatal("a case note is stored in plaintext")
	}
}

func contains(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
