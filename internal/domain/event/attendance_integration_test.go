package event

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/domain/member"
	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

// WP-21 acceptance: "200 check-ins recorded fully offline reconcile with zero
// duplicates on reconnect."
//
// Against a real MongoDB, because the guarantee IS the unique index. A test
// with a fake store would prove the sync code counts correctly and prove
// nothing about the property that actually holds at 9am on a Sunday, when two
// ushers' phones come back at once.

func testDB(t *testing.T) *mongodb.DB {
	t.Helper()

	uri := testsupport.MongoURI()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	db, err := mongodb.Connect(ctx, config.MongoConfig{
		URI: uri,
		// Its own database: this test drops collections and must never be able
		// to reach development or production data.
		Database:       "altar_test_events",
		ConnectTimeout: 3 * time.Second,
	})
	if err != nil {
		testsupport.SkipOrFail(t, "MongoDB at "+uri, err)
	}

	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = db.Database().Drop(cleanup)
		_ = db.Close(cleanup)
	})
	return db
}

// fixture builds a church with a service and a congregation of `size` members.
func fixture(t *testing.T, size int) (context.Context, *Service, *Event, []string) {
	t.Helper()

	db := testDB(t)
	churchID := bson.NewObjectID().Hex()
	ctx := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: churchID,
		UserID:   bson.NewObjectID().Hex(),
	})

	members := member.NewService(db, nil, "GH")
	if err := members.EnsureIndexes(ctx); err != nil {
		t.Fatalf("member indexes: %v", err)
	}

	svc := NewService(db, members)
	if err := svc.EnsureIndexes(ctx); err != nil {
		t.Fatalf("event indexes: %v", err)
	}

	service, err := svc.Create(ctx, Input{
		Title:     "Sunday Service",
		Location:  "Main Auditorium",
		StartDate: time.Now().UTC().Truncate(time.Hour),
	})
	if err != nil {
		t.Fatalf("create event: %v", err)
	}

	ids := make([]string, 0, size)
	for i := 0; i < size; i++ {
		created, err := members.Create(ctx, member.Input{
			FirstName: "Member",
			LastName:  fmt.Sprintf("%03d", i),
			// A distinct Ghanaian number per member, so the CRM's own
			// deduplication does not silently collapse the congregation.
			Phone: fmt.Sprintf("+2332%08d", i),
		})
		if err != nil {
			t.Fatalf("create member %d: %v", i, err)
		}
		ids = append(ids, created.ID.Hex())
	}
	return ctx, svc, service, ids
}

// queue builds the batch a device holds after a morning offline.
func queue(memberIDs []string) []CheckIn {
	base := time.Now().UTC().Add(-3 * time.Hour)
	batch := make([]CheckIn, 0, len(memberIDs))
	for i, id := range memberIDs {
		batch = append(batch, CheckIn{
			MemberID:    id,
			Method:      CheckInQR,
			CheckedInAt: base.Add(time.Duration(i) * time.Second),
		})
	}
	return batch
}

func TestTwoHundredOfflineCheckInsReconcileWithZeroDuplicates(t *testing.T) {
	const size = 200
	ctx, svc, service, memberIDs := fixture(t, size)
	batch := queue(memberIDs)

	first, err := svc.Sync(ctx, SyncRequest{EventID: service.ID.Hex(), CheckIns: batch, Offline: true})
	if err != nil {
		t.Fatalf("first sync: %v", err)
	}
	if first.Recorded != size || first.Duplicate != 0 || len(first.Rejected) != 0 {
		t.Fatalf("first sync recorded %d, duplicate %d, rejected %v; want %d/0/none",
			first.Recorded, first.Duplicate, first.Rejected, size)
	}
	if first.AttendanceCount != size {
		t.Fatalf("attendance after first sync = %d, want %d", first.AttendanceCount, size)
	}

	// The reconnect. A device that sent the batch and lost signal before
	// hearing the reply cannot know whether it landed, so it sends again.
	second, err := svc.Sync(ctx, SyncRequest{EventID: service.ID.Hex(), CheckIns: batch, Offline: true})
	if err != nil {
		t.Fatalf("second sync: %v", err)
	}
	if second.Recorded != 0 || second.Duplicate != size {
		t.Fatalf("retry recorded %d, duplicate %d; want 0/%d",
			second.Recorded, second.Duplicate, size)
	}

	// The criterion itself.
	records, err := svc.Attendance(ctx, service.ID.Hex(), time.Time{})
	if err != nil {
		t.Fatalf("read attendance: %v", err)
	}
	if len(records) != size {
		t.Fatalf("attendance holds %d records, want exactly %d", len(records), size)
	}
	seen := map[string]int{}
	for _, record := range records {
		seen[record.MemberID]++
	}
	for memberID, count := range seen {
		if count != 1 {
			t.Fatalf("member %s appears %d times", memberID, count)
		}
	}

	// The denormalised count on the event has to agree with the records, or
	// the church's dashboard and its register tell different stories.
	reloaded, err := svc.ByID(ctx, service.ID.Hex())
	if err != nil {
		t.Fatalf("reload event: %v", err)
	}
	if reloaded.AttendanceCount != size {
		t.Fatalf("event.attendanceCount = %d, want %d", reloaded.AttendanceCount, size)
	}
}

func TestConcurrentUshersSyncingTheSamePeopleProduceOneRecordEach(t *testing.T) {
	// Two phones with overlapping queues, reconnecting together. This is the
	// case application-level deduplication cannot survive: both read "not
	// present" before either writes.
	const size = 60
	ctx, svc, service, memberIDs := fixture(t, size)
	batch := queue(memberIDs)

	const ushers = 4
	var wg sync.WaitGroup
	results := make([]*SyncResult, ushers)
	errs := make([]error, ushers)

	for i := 0; i < ushers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results[i], errs[i] = svc.Sync(ctx, SyncRequest{EventID: service.ID.Hex(), CheckIns: batch, Offline: true})
		}(i)
	}
	wg.Wait()

	recorded := 0
	for i := range results {
		if errs[i] != nil {
			t.Fatalf("usher %d: %v", i, errs[i])
		}
		if len(results[i].Rejected) != 0 {
			t.Fatalf("usher %d had rejections: %v", i, results[i].Rejected)
		}
		recorded += results[i].Recorded
	}
	// Exactly one usher's write wins per person, across all four.
	if recorded != size {
		t.Fatalf("%d ushers recorded %d rows between them, want %d", ushers, recorded, size)
	}

	records, err := svc.Attendance(ctx, service.ID.Hex(), time.Time{})
	if err != nil {
		t.Fatalf("read attendance: %v", err)
	}
	if len(records) != size {
		t.Fatalf("attendance holds %d records, want %d", len(records), size)
	}
}

func TestAWeeklyServiceRecordsEverySundaySeparately(t *testing.T) {
	// The bug the occurrence key exists to prevent. A recurring event is ONE
	// document, so a key of (church, event, member) would read "may attend
	// Sunday service once, ever" — and every Sunday after the first would
	// record nobody while reporting a clean sync.
	ctx, svc, _, memberIDs := fixture(t, 20)

	// A weekly service that started three Sundays ago.
	start := lastSunday(time.Now().UTC()).Add(-14 * 24 * time.Hour).
		Add(9 * time.Hour) // 09:00
	service, err := svc.Create(ctx, Input{
		Title:          "Sunday Service",
		StartDate:      start,
		RecurrenceRule: "FREQ=WEEKLY",
	})
	if err != nil {
		t.Fatalf("create recurring event: %v", err)
	}
	id := service.ID.Hex()

	// Three Sundays of ushers checking the same people in.
	for week := 0; week < 3; week++ {
		sunday := start.AddDate(0, 0, 7*week)
		batch := make([]CheckIn, 0, len(memberIDs))
		for i, memberID := range memberIDs {
			batch = append(batch, CheckIn{
				MemberID: memberID,
				Method:   CheckInQR,
				// Scanned as people arrive, a few minutes either side of the
				// start — which is what makes snapping, rather than truncating
				// to a date, the thing being tested.
				CheckedInAt: sunday.Add(time.Duration(i-5) * time.Minute),
			})
		}
		result, err := svc.Sync(ctx, SyncRequest{EventID: id, CheckIns: batch, Offline: true})
		if err != nil {
			t.Fatalf("week %d sync: %v", week, err)
		}
		if result.Recorded != len(memberIDs) {
			t.Fatalf("week %d recorded %d, want %d (a later Sunday must not "+
				"collide with an earlier one)", week, result.Recorded, len(memberIDs))
		}
		if result.OccurrenceAttendance != len(memberIDs) {
			t.Fatalf("week %d reported %d present at that service, want %d",
				week, result.OccurrenceAttendance, len(memberIDs))
		}
		if result.OccurrenceAt == nil || !result.OccurrenceAt.Equal(sunday) {
			t.Fatalf("week %d filed against %v, want %s",
				week, result.OccurrenceAt, sunday)
		}
	}

	// Every occurrence is separately readable...
	for week := 0; week < 3; week++ {
		sunday := start.AddDate(0, 0, 7*week)
		records, err := svc.Attendance(ctx, id, sunday)
		if err != nil {
			t.Fatalf("week %d register: %v", week, err)
		}
		if len(records) != len(memberIDs) {
			t.Fatalf("week %d register holds %d, want %d",
				week, len(records), len(memberIDs))
		}
	}
	// ...and the total is the sum, not one week of it.
	all, err := svc.Attendance(ctx, id, time.Time{})
	if err != nil {
		t.Fatalf("total register: %v", err)
	}
	if want := 3 * len(memberIDs); len(all) != want {
		t.Fatalf("total attendance = %d, want %d", len(all), want)
	}

	// And a resent week is still a duplicate, not a fourth Sunday.
	replay := make([]CheckIn, 0, len(memberIDs))
	for i, memberID := range memberIDs {
		replay = append(replay, CheckIn{
			MemberID:    memberID,
			Method:      CheckInQR,
			CheckedInAt: start.Add(time.Duration(i-5) * time.Minute),
		})
	}
	again, err := svc.Sync(ctx, SyncRequest{EventID: id, CheckIns: replay, Offline: true})
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if again.Recorded != 0 || again.Duplicate != len(memberIDs) {
		t.Fatalf("replaying week 0 recorded %d, duplicate %d; want 0/%d",
			again.Recorded, again.Duplicate, len(memberIDs))
	}
}

// lastSunday returns the most recent Sunday at midnight UTC.
func lastSunday(from time.Time) time.Time {
	day := from.UTC().Truncate(24 * time.Hour)
	return day.AddDate(0, 0, -int(day.Weekday()))
}

func TestSyncKeepsTheUsherTimestampNotTheArrivalTime(t *testing.T) {
	// An attendance report timestamped when the phone found signal is wrong in
	// exactly the way nobody checks: everybody appears to have arrived at once,
	// hours after the service.
	ctx, svc, service, memberIDs := fixture(t, 1)

	scanned := time.Now().UTC().Add(-4 * time.Hour).Truncate(time.Second)
	if _, err := svc.Sync(ctx, SyncRequest{EventID: service.ID.Hex(), Offline: true, CheckIns: []CheckIn{{
		MemberID:    memberIDs[0],
		Method:      CheckInQR,
		CheckedInAt: scanned,
	}}}); err != nil {
		t.Fatalf("sync: %v", err)
	}

	records, err := svc.Attendance(ctx, service.ID.Hex(), time.Time{})
	if err != nil {
		t.Fatalf("read attendance: %v", err)
	}
	if !records[0].CheckedInAt.Equal(scanned) {
		t.Fatalf("checkedInAt = %s, want the usher's %s",
			records[0].CheckedInAt, scanned)
	}
	if !records[0].RecordedAt.After(records[0].CheckedInAt) {
		t.Fatal("recordedAt should be later than checkedInAt for an offline capture")
	}
	if !records[0].Offline {
		t.Fatal("an offline capture should be marked as one")
	}
}

func TestABadRowDoesNotCostTheBatch(t *testing.T) {
	// An usher standing at a door cannot re-scan two hundred people because one
	// row named somebody who has since been removed.
	ctx, svc, service, memberIDs := fixture(t, 5)

	batch := queue(memberIDs)
	batch = append(batch,
		CheckIn{MemberID: bson.NewObjectID().Hex(), Method: CheckInQR}, // no such member
		CheckIn{MemberID: "", Method: CheckInQR},                       // no member named
		CheckIn{MemberID: "not-an-id", Method: CheckInQR},              // unusable id
	)

	result, err := svc.Sync(ctx, SyncRequest{EventID: service.ID.Hex(), CheckIns: batch, Offline: true})
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	if result.Recorded != 5 {
		t.Fatalf("recorded %d, want the 5 good rows", result.Recorded)
	}
	if len(result.Rejected) != 3 {
		t.Fatalf("rejected %v, want the 3 bad rows", result.Rejected)
	}
	for _, rejected := range result.Rejected {
		if rejected.Reason == "" {
			t.Fatal("a rejection with no reason is unactionable")
		}
	}
}

func TestADeviceThatScannedSomebodyTwiceIsNotToldItDuplicated(t *testing.T) {
	// Nothing was duplicated on the server — the device scanned twice. Counting
	// that as a duplicate would make a first sync look like a retry.
	ctx, svc, service, memberIDs := fixture(t, 1)

	early := time.Now().UTC().Add(-2 * time.Hour).Truncate(time.Second)
	result, err := svc.Sync(ctx, SyncRequest{EventID: service.ID.Hex(), Offline: true, CheckIns: []CheckIn{
		{MemberID: memberIDs[0], Method: CheckInQR, CheckedInAt: early.Add(time.Minute)},
		{MemberID: memberIDs[0], Method: CheckInManual, CheckedInAt: early},
	}})
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	if result.Recorded != 1 || result.Duplicate != 0 {
		t.Fatalf("recorded %d, duplicate %d; want 1/0", result.Recorded, result.Duplicate)
	}

	records, _ := svc.Attendance(ctx, service.ID.Hex(), time.Time{})
	if len(records) != 1 {
		t.Fatalf("attendance holds %d records, want 1", len(records))
	}
	// The earliest of the two scans is when they arrived.
	if !records[0].CheckedInAt.Equal(early) {
		t.Fatalf("kept %s, want the earlier %s", records[0].CheckedInAt, early)
	}
}

func TestACheckInFromAnotherChurchFindsNobody(t *testing.T) {
	// The cross-tenant case. A member id from another church is not rejected by
	// a rule someone wrote — it is simply absent from a tenant-scoped roster.
	ctx, svc, service, _ := fixture(t, 1)

	other := bson.NewObjectID().Hex()
	result, err := svc.Sync(ctx, SyncRequest{EventID: service.ID.Hex(), Offline: true,
		CheckIns: []CheckIn{{MemberID: other, Method: CheckInQR}}})
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	if result.Recorded != 0 || len(result.Rejected) != 1 {
		t.Fatalf("recorded %d, rejected %v; want 0 recorded and 1 rejection",
			result.Recorded, result.Rejected)
	}
	if result.AttendanceCount != 0 {
		t.Fatalf("attendance = %d, want 0", result.AttendanceCount)
	}
}

func TestADeviceClockAheadOfTheServerIsClamped(t *testing.T) {
	// A phone whose clock is wrong would otherwise sort to the top of every
	// attendance list forever.
	ctx, svc, service, memberIDs := fixture(t, 1)

	future := time.Now().UTC().Add(72 * time.Hour)
	if _, err := svc.Sync(ctx, SyncRequest{EventID: service.ID.Hex(), Offline: true, CheckIns: []CheckIn{{
		MemberID:    memberIDs[0],
		Method:      CheckInQR,
		CheckedInAt: future,
	}}}); err != nil {
		t.Fatalf("sync: %v", err)
	}

	records, _ := svc.Attendance(ctx, service.ID.Hex(), time.Time{})
	if records[0].CheckedInAt.After(time.Now().UTC().Add(futureSkew)) {
		t.Fatalf("checkedInAt = %s, which is still in the future", records[0].CheckedInAt)
	}
}

func TestRSVPIsOneAnswerPerPersonAndRespectsCapacity(t *testing.T) {
	ctx, svc, _, memberIDs := fixture(t, 3)

	limited, err := svc.Create(ctx, Input{
		Title:     "Leaders' Retreat",
		StartDate: time.Now().UTC().Add(30 * 24 * time.Hour),
		Capacity:  2,
	})
	if err != nil {
		t.Fatalf("create event: %v", err)
	}
	id := limited.ID.Hex()

	for _, memberID := range memberIDs[:2] {
		if _, err := svc.Respond(ctx, id, memberID, RSVPGoing); err != nil {
			t.Fatalf("rsvp: %v", err)
		}
	}
	if _, err := svc.Respond(ctx, id, memberIDs[2], RSVPGoing); err != ErrCapacityReached {
		t.Fatalf("third GOING returned %v, want ErrCapacityReached", err)
	}
	// Being unable to attend is never full.
	if _, err := svc.Respond(ctx, id, memberIDs[2], RSVPNotGoing); err != nil {
		t.Fatalf("NOT_GOING on a full event: %v", err)
	}

	// Changing an answer replaces it rather than adding one.
	if _, err := svc.Respond(ctx, id, memberIDs[0], RSVPMaybe); err != nil {
		t.Fatalf("change answer: %v", err)
	}
	answers, err := svc.RSVPs(ctx, id)
	if err != nil {
		t.Fatalf("list rsvps: %v", err)
	}
	if len(answers) != 3 {
		t.Fatalf("%d answers for 3 people", len(answers))
	}

	// A place freed by somebody changing their mind is a place again.
	if _, err := svc.Respond(ctx, id, memberIDs[2], RSVPGoing); err != nil {
		t.Fatalf("rsvp after a place freed up: %v", err)
	}
	reloaded, _ := svc.ByID(ctx, id)
	if reloaded.RSVPCount != 2 {
		t.Fatalf("rsvpCount = %d, want 2 going", reloaded.RSVPCount)
	}
}

func TestDeletingAnEventTakesItsAttendanceWithIt(t *testing.T) {
	ctx, svc, service, memberIDs := fixture(t, 3)
	id := service.ID.Hex()

	if _, err := svc.Sync(ctx, SyncRequest{EventID: id, CheckIns: queue(memberIDs), Offline: true}); err != nil {
		t.Fatalf("sync: %v", err)
	}
	if _, err := svc.Respond(ctx, id, memberIDs[0], RSVPGoing); err != nil {
		t.Fatalf("rsvp: %v", err)
	}
	if err := svc.Delete(ctx, id); err != nil {
		t.Fatalf("delete: %v", err)
	}

	// Recreate an event and confirm nothing from the deleted one bleeds in.
	replacement, err := svc.Create(ctx, Input{
		Title:     "Sunday Service",
		StartDate: time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("recreate: %v", err)
	}
	records, err := svc.Attendance(ctx, replacement.ID.Hex(), time.Time{})
	if err != nil {
		t.Fatalf("read attendance: %v", err)
	}
	if len(records) != 0 {
		t.Fatalf("the new event already has %d attendance records", len(records))
	}
}

func TestCheckInCodeResolvesTheEventAndIsForgivingAboutTyping(t *testing.T) {
	ctx, svc, service, _ := fixture(t, 1)

	for _, typed := range []string{
		service.CheckInCode,
		strings.ToLower(service.CheckInCode),
		" " + service.CheckInCode + " ",
		service.CheckInCode[:3] + "-" + service.CheckInCode[3:],
	} {
		found, err := svc.ByCheckInCode(ctx, typed)
		if err != nil {
			t.Fatalf("ByCheckInCode(%q): %v", typed, err)
		}
		if found.ID != service.ID {
			t.Fatalf("ByCheckInCode(%q) resolved the wrong event", typed)
		}
	}
	if _, err := svc.ByCheckInCode(ctx, "ZZZZZZ"); err != ErrCheckInCodeInvalid {
		t.Fatalf("an unknown code returned %v", err)
	}
}
