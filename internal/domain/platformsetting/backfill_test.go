package platformsetting

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

// A backfill writes a money-splitting parameter across every church on the
// platform. The tests below are ordered by how expensive the mistake is.

type recordingGateway struct {
	applied map[string]int64
	// failFor makes one subaccount fail, standing in for a closed account or a
	// provider timeout.
	failFor string
	calls   int
}

func newGateway() *recordingGateway {
	return &recordingGateway{applied: map[string]int64{}}
}

func (g *recordingGateway) UpdateSubaccountCommission(_ context.Context, code string, bps int64) error {
	g.calls++
	if code == g.failFor {
		return errors.New("subaccount not found")
	}
	g.applied[code] = bps
	return nil
}

func backfillFixture(t *testing.T) (*Service, *mongodb.DB, context.Context) {
	t.Helper()

	uri := testsupport.MongoURI()
	connectCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	db, err := mongodb.Connect(connectCtx, config.MongoConfig{
		URI:            uri,
		Database:       "altar_test_backfill",
		ConnectTimeout: 3 * time.Second,
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

	return NewService(db), db, context.Background()
}

// church inserts a church with an optional negotiated rate.
func addChurch(t *testing.T, db *mongodb.DB, ctx context.Context,
	name, subaccount string, negotiated *int64) bson.ObjectID {
	t.Helper()

	doc := bson.M{"name": name, "isActive": true}
	if subaccount != "" {
		doc["payoutSubaccountCode"] = subaccount
	}
	if negotiated != nil {
		doc["commissionBasisPoints"] = *negotiated
	}
	res, err := db.Global("churches").InsertOne(ctx, doc)
	if err != nil {
		t.Fatalf("church %s: %v", name, err)
	}
	return res.InsertedID.(bson.ObjectID)
}

func bps(n int64) *int64 { return &n }

func TestABackfillNeverOverwritesANegotiatedRate(t *testing.T) {
	// The most expensive mistake available. A launch partner on 0% silently
	// re-priced to the platform default is a breach of whatever was agreed
	// with them, and it would be discovered on a settlement statement.
	svc, db, ctx := backfillFixture(t)
	if _, err := svc.Save(ctx, Update{CommissionBasisPoints: bps(200)}); err != nil {
		t.Fatalf("save: %v", err)
	}

	addChurch(t, db, ctx, "Ordinary", "ACCT_ordinary", nil)
	addChurch(t, db, ctx, "Launch partner", "ACCT_partner", bps(0))
	addChurch(t, db, ctx, "Negotiated", "ACCT_negotiated", bps(75))

	gw := newGateway()
	report, err := svc.BackfillCommission(ctx, db, gw, false)
	if err != nil {
		t.Fatalf("backfill: %v", err)
	}
	if report.Updated != 3 {
		t.Fatalf("updated %d, want 3", report.Updated)
	}

	want := map[string]int64{
		"ACCT_ordinary":   200, // the platform rate
		"ACCT_partner":    0,   // zero is a REAL rate, not "unset"
		"ACCT_negotiated": 75,
	}
	for code, expected := range want {
		if got, ok := gw.applied[code]; !ok {
			t.Errorf("%s was never updated", code)
		} else if got != expected {
			t.Errorf("%s got %d bps, want %d", code, got, expected)
		}
	}
}

func TestAChurchWithNoSubaccountIsNotAFailure(t *testing.T) {
	// A church that has never been onboarded to the provider has nothing to
	// write to. Counting it as a failure would make every run look broken and
	// train an operator to ignore the number that matters.
	svc, db, ctx := backfillFixture(t)
	addChurch(t, db, ctx, "Onboarded", "ACCT_yes", nil)
	addChurch(t, db, ctx, "Not yet", "", nil)

	report, err := svc.BackfillCommission(ctx, db, newGateway(), false)
	if err != nil {
		t.Fatalf("backfill: %v", err)
	}
	if report.Failed != 0 {
		t.Errorf("failed = %d, want 0", report.Failed)
	}
	if len(report.Churches) != 1 {
		t.Fatalf("considered %d churches, want only the onboarded one", len(report.Churches))
	}
}

func TestOneFailureDoesNotStopTheRest(t *testing.T) {
	// A single church whose subaccount was closed at the provider must not
	// cost the other 199 — an operator cannot finish a job that aborts on the
	// first bad row.
	svc, db, ctx := backfillFixture(t)
	for i := 0; i < 5; i++ {
		addChurch(t, db, ctx, fmt.Sprintf("Church %d", i), fmt.Sprintf("ACCT_%d", i), nil)
	}

	gw := newGateway()
	gw.failFor = "ACCT_2"

	report, err := svc.BackfillCommission(ctx, db, gw, false)
	if err != nil {
		t.Fatalf("backfill: %v", err)
	}
	if report.Updated != 4 || report.Failed != 1 {
		t.Fatalf("updated %d failed %d, want 4/1", report.Updated, report.Failed)
	}

	// And the report names WHICH one, with a reason. "197 of 200" without
	// saying which three is a report nobody can act on.
	named := false
	for _, c := range report.Churches {
		if c.Outcome == OutcomeFailed {
			named = true
			if c.Reason == "" {
				t.Error("a failure with no reason is unactionable")
			}
		}
	}
	if !named {
		t.Error("the failing church is not identified in the report")
	}
}

func TestARerunSkipsWhatIsAlreadyRightAndRetriesWhatIsNot(t *testing.T) {
	// This is what makes "run it again" the correct advice after a partial
	// failure, rather than a way to hammer the provider with N redundant calls.
	svc, db, ctx := backfillFixture(t)
	for i := 0; i < 4; i++ {
		addChurch(t, db, ctx, fmt.Sprintf("Church %d", i), fmt.Sprintf("ACCT_%d", i), nil)
	}

	first := newGateway()
	first.failFor = "ACCT_3"
	if _, err := svc.BackfillCommission(ctx, db, first, false); err != nil {
		t.Fatalf("first run: %v", err)
	}
	if first.calls != 4 {
		t.Fatalf("first run made %d calls, want 4", first.calls)
	}

	// Second run: the three that succeeded are already right and must not be
	// called again; the one that failed must be retried.
	second := newGateway()
	report, err := svc.BackfillCommission(ctx, db, second, false)
	if err != nil {
		t.Fatalf("second run: %v", err)
	}
	if second.calls != 1 {
		t.Fatalf("second run made %d provider calls, want 1 — the three that "+
			"already succeeded should be skipped", second.calls)
	}
	if report.Unchanged != 3 {
		t.Errorf("unchanged = %d, want 3", report.Unchanged)
	}
	if report.Updated != 1 {
		t.Errorf("updated = %d, want the one that failed before", report.Updated)
	}
}

func TestChangingTheRateMakesEveryChurchStaleAgain(t *testing.T) {
	// The skip must be keyed on the RATE, not on "has been synced once".
	// Otherwise the second rate change is a silent no-op and every church keeps
	// the first one forever.
	svc, db, ctx := backfillFixture(t)
	if _, err := svc.Save(ctx, Update{CommissionBasisPoints: bps(150)}); err != nil {
		t.Fatalf("save: %v", err)
	}
	addChurch(t, db, ctx, "Church", "ACCT_1", nil)

	if _, err := svc.BackfillCommission(ctx, db, newGateway(), false); err != nil {
		t.Fatalf("first: %v", err)
	}

	if _, err := svc.Save(ctx, Update{CommissionBasisPoints: bps(250)}); err != nil {
		t.Fatalf("re-save: %v", err)
	}

	gw := newGateway()
	report, err := svc.BackfillCommission(ctx, db, gw, false)
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if report.Updated != 1 {
		t.Fatalf("updated = %d, want 1 — a rate change must make it stale again",
			report.Updated)
	}
	if gw.applied["ACCT_1"] != 250 {
		t.Errorf("applied %d bps, want the new 250", gw.applied["ACCT_1"])
	}
}

func TestADryRunChangesNothing(t *testing.T) {
	// This writes a money-splitting parameter across every church. Being able
	// to read the list before pressing the button is the difference between a
	// considered change and a discovered one.
	svc, db, ctx := backfillFixture(t)
	addChurch(t, db, ctx, "Church", "ACCT_1", nil)

	gw := newGateway()
	report, err := svc.BackfillCommission(ctx, db, gw, true)
	if err != nil {
		t.Fatalf("dry run: %v", err)
	}
	if gw.calls != 0 {
		t.Fatalf("a dry run made %d provider calls", gw.calls)
	}
	if !report.DryRun {
		t.Error("the report does not say it was a dry run")
	}
	if report.Skipped != 1 || report.Updated != 0 {
		t.Errorf("skipped %d updated %d, want 1/0", report.Skipped, report.Updated)
	}
	// And it still says what WOULD happen, or it is useless.
	if len(report.Churches) != 1 || report.Churches[0].BasisPoints == 0 {
		t.Error("a dry run must report the rate each church would get")
	}
}

func TestTheReportSaysWhatItDoesNotDo(t *testing.T) {
	// The whole reason this operation is misunderstood: it looks like the thing
	// that makes a rate change take effect, and it is not. Saying so in the
	// response is cheaper than an operator discovering it during a dispute.
	svc, db, ctx := backfillFixture(t)
	report, err := svc.BackfillCommission(ctx, db, newGateway(), true)
	if err != nil {
		t.Fatalf("backfill: %v", err)
	}
	if report.Note == "" {
		t.Fatal("the report does not explain what it affects")
	}
}
