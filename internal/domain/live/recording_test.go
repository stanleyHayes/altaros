package live

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// A church may keep a recording for less than the default. It must not be able
// to keep one for longer than the ceiling — a settings box accepting "10 years"
// would make video of a congregation praying the longest-lived data in the
// product, outliving the financial records Act 915 actually requires.
func TestRecordingRetentionIsCapped(t *testing.T) {
	svc, sessionID := liveFixture(t)
	ctx := scoped(t)

	if _, err := svc.StartRecording(ctx, sessionID, "path", "actor",
		MaxRetention+24*time.Hour); !errors.Is(err, ErrRetentionTooLong) {
		t.Fatalf("accepted a retention past the ceiling: %v", err)
	}

	rec, err := svc.StartRecording(ctx, sessionID, "path", "actor", 30*24*time.Hour)
	if err != nil {
		t.Fatalf("refused a shorter retention: %v", err)
	}
	if rec.DeleteAfter.IsZero() {
		t.Fatal("a recording was created with no expiry")
	}
}

// The expiry is stamped when recording STARTS, not when it ends. A service that
// crashes mid-write would otherwise leave a row with no expiry — the exact
// recording nobody remembers, kept forever.
func TestRecordingGetsItsExpiryAtTheStart(t *testing.T) {
	svc, sessionID := liveFixture(t)
	ctx := scoped(t)

	before := time.Now().UTC()
	rec, err := svc.StartRecording(ctx, sessionID, "path", "actor", 0)
	if err != nil {
		t.Fatalf("StartRecording: %v", err)
	}
	if rec.Status != RecordingActive {
		t.Fatalf("status = %q, want %q", rec.Status, RecordingActive)
	}
	if rec.EndedAt != nil {
		t.Fatal("a recording that just started has an end time")
	}
	// Default retention, applied when none was asked for.
	want := before.Add(DefaultRetention)
	if rec.DeleteAfter.Before(want.Add(-time.Minute)) ||
		rec.DeleteAfter.After(want.Add(time.Minute)) {
		t.Fatalf("expiry = %s, want about %s", rec.DeleteAfter, want)
	}
}

// The sweeper's query. A recording past its expiry must be found, and one
// already erased must not be found again forever.
func TestExpiredRecordingsFindsWhatIsPastItsRetention(t *testing.T) {
	svc, sessionID := liveFixture(t)
	ctx := scoped(t)

	rec, err := svc.StartRecording(ctx, sessionID, "to-erase", "actor", time.Hour)
	if err != nil {
		t.Fatalf("StartRecording: %v", err)
	}

	// Nothing is expired yet.
	found, err := svc.ExpiredRecordings(ctx, time.Now().UTC(), 10)
	if err != nil {
		t.Fatalf("ExpiredRecordings: %v", err)
	}
	if containsRecording(found, rec.ID.Hex()) {
		t.Fatal("a recording inside its retention was swept")
	}

	// An hour and a moment later, it is.
	found, err = svc.ExpiredRecordings(ctx, time.Now().UTC().Add(2*time.Hour), 10)
	if err != nil {
		t.Fatalf("ExpiredRecordings: %v", err)
	}
	if !containsRecording(found, rec.ID.Hex()) {
		t.Fatal("a recording past its retention was not swept — it would be kept forever")
	}

	if err := svc.MarkRecordingDeleted(ctx, rec.ID.Hex()); err != nil {
		t.Fatalf("MarkRecordingDeleted: %v", err)
	}
	found, err = svc.ExpiredRecordings(ctx, time.Now().UTC().Add(2*time.Hour), 10)
	if err != nil {
		t.Fatalf("ExpiredRecordings: %v", err)
	}
	if containsRecording(found, rec.ID.Hex()) {
		t.Fatal("an erased recording is still swept, so the sweeper never drains")
	}
}

// The ROW survives its media, and the PATH does not. Keeping the path would
// leave a map to a file we promised to erase; erasing the row would leave a
// church unable to tell a member that yes, that service was recorded, and it
// was erased on this date.
func TestErasedRecordingsKeepTheirRecordButNotTheirPath(t *testing.T) {
	svc, sessionID := liveFixture(t)
	ctx := scoped(t)

	rec, err := svc.StartRecording(ctx, sessionID, "some/path", "actor", time.Hour)
	if err != nil {
		t.Fatalf("StartRecording: %v", err)
	}
	if err := svc.MarkRecordingDeleted(ctx, rec.ID.Hex()); err != nil {
		t.Fatalf("MarkRecordingDeleted: %v", err)
	}

	after, err := svc.RecordingByID(ctx, rec.ID.Hex())
	if err != nil {
		t.Fatalf("the record was destroyed along with its media: %v", err)
	}
	if after.Status != RecordingDeleted {
		t.Fatalf("status = %q, want %q", after.Status, RecordingDeleted)
	}
	if after.DeletedAt == nil {
		t.Fatal("no erasure date was recorded")
	}
	if after.StoragePath != "" {
		t.Fatalf("the path to erased media survived: %q", after.StoragePath)
	}
}

// A church that was told the service was recorded is owed the answer when it
// was not.
func TestAFailedRecordingKeepsItsRow(t *testing.T) {
	svc, sessionID := liveFixture(t)
	ctx := scoped(t)

	rec, err := svc.StartRecording(ctx, sessionID, "path", "actor", time.Hour)
	if err != nil {
		t.Fatalf("StartRecording: %v", err)
	}
	finished, err := svc.FinishRecording(ctx, rec.ID.Hex(), 0, true)
	if err != nil {
		t.Fatalf("FinishRecording: %v", err)
	}
	if finished.Status != RecordingFailed {
		t.Fatalf("status = %q, want %q", finished.Status, RecordingFailed)
	}
	if finished.EndedAt == nil {
		t.Fatal("a finished recording has no end time")
	}
}

// Consent that arrives after somebody is already on camera is not consent, so
// the notice is part of JOIN. And it must say how long — the part a generic
// notice always omits and the part a person actually wants to know.
func TestRecordingNoticeTellsPeopleBeforeTheyAppear(t *testing.T) {
	quiet := NoticeFor(&Session{Recording: false}, nil)
	if quiet.Recording {
		t.Fatal("an unrecorded service claims to be recorded")
	}
	if quiet.Notice != "" {
		t.Fatal("an unrecorded service carries a recording notice")
	}

	until := time.Now().Add(DefaultRetention)
	notice := NoticeFor(&Session{Recording: true}, &until)
	if !notice.Recording {
		t.Fatal("a recorded service does not say so")
	}
	if notice.Notice == "" {
		t.Fatal("a recorded service carries no notice for the congregation")
	}
	if notice.KeptUntil == nil {
		t.Fatal("the notice does not say how long the recording is kept")
	}
}

// A nil session must not claim to be recording. It is what a caller gets when
// a lookup failed, and defaulting to "recording" there would announce a
// recording that does not exist.
func TestNoticeForANilSessionIsNotRecording(t *testing.T) {
	if NoticeFor(nil, nil).Recording {
		t.Fatal("a missing session announced a recording")
	}
}

func TestRecordingExpiredIsHonestAboutDeletedOnes(t *testing.T) {
	now := time.Now().UTC()
	past := &Recording{Status: RecordingReady, DeleteAfter: now.Add(-time.Hour)}
	if !past.Expired(now) {
		t.Fatal("a recording past its expiry is not expired")
	}
	future := &Recording{Status: RecordingReady, DeleteAfter: now.Add(time.Hour)}
	if future.Expired(now) {
		t.Fatal("a recording inside its retention is expired")
	}
	// Already erased: not expired, or the sweeper picks it up forever.
	gone := &Recording{Status: RecordingDeleted, DeleteAfter: now.Add(-time.Hour)}
	if gone.Expired(now) {
		t.Fatal("an erased recording is still reported expired")
	}
	if (*Recording)(nil).Expired(now) {
		t.Fatal("a nil recording is expired")
	}
}

// liveFixture is the harness the other tests in this package use, with a
// scheduled session ready to record.
func liveFixture(t *testing.T) (*Service, string) {
	t.Helper()
	h := newHarness(t, 100, true)
	return h.svc, h.schedule(t)
}

// scoped is the church context the harness runs in.
func scoped(t *testing.T) context.Context {
	t.Helper()
	return tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: testChurch, UserID: "pastor", Role: "CHURCH_ADMIN",
	})
}

func containsRecording(recordings []Recording, id string) bool {
	for i := range recordings {
		if recordings[i].ID.Hex() == id {
			return true
		}
	}
	return false
}
