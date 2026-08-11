package plan

import (
	"context"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

const churchA = "6a6d0a46536bf5e6e21cfa01"

func newService(t *testing.T) (*Service, context.Context) {
	t.Helper()
	connect, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	db, err := mongodb.Connect(connect, config.MongoConfig{
		URI: testsupport.MongoURI(), Database: "altar_test_plan",
		ConnectTimeout: 5 * time.Second,
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
	svc := NewService(db)
	ctx := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: churchA, UserID: "admin", Role: "SUPER_ADMIN",
	})
	if err := svc.EnsureIndexes(ctx); err != nil {
		t.Fatalf("EnsureIndexes: %v", err)
	}
	return svc, ctx
}

// Every church that existed before this collection has no row. A missing
// subscription must mean "has not paid us yet", never "cannot use the
// product" — otherwise shipping tiers takes every existing church offline.
func TestAChurchWithNoSubscriptionGetsTheFreeTier(t *testing.T) {
	svc, ctx := newService(t)

	ent, err := svc.For(ctx)
	if err != nil {
		t.Fatalf("For: %v", err)
	}
	if ent.Tier != TierFree {
		t.Errorf("tier = %q, want free", ent.Tier)
	}
	if ent.CommissionBasisPoints != EntitlementFor(TierFree).CommissionBasisPoints {
		t.Error("a church with no plan is not on the free commission")
	}

	// And reading must not have written anything.
	n, err := svc.subs.CountDocuments(ctx, bson.M{})
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Errorf("reading a plan created %d rows", n)
	}
}

// The grace clock starts on the FIRST failure and is never restarted. A card
// failing nightly for a fortnight would otherwise reset it every night and
// never expire — a church streaming free forever because its payment method
// is broken rather than because anybody decided to allow it.
func TestRepeatedFailuresDoNotRestartTheGraceClock(t *testing.T) {
	svc, ctx := newService(t)
	if _, err := svc.SetTier(ctx, TierGrowth, "admin"); err != nil {
		t.Fatalf("SetTier: %v", err)
	}

	base := time.Date(2026, 8, 1, 9, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return base }
	if _, err := svc.MarkPastDue(ctx); err != nil {
		t.Fatalf("MarkPastDue: %v", err)
	}
	first, err := svc.Current(ctx)
	if err != nil {
		t.Fatalf("Current: %v", err)
	}
	if first.PastDueSince == nil {
		t.Fatal("the grace clock never started")
	}
	started := *first.PastDueSince

	// It keeps failing for a week.
	for d := 1; d <= 7; d++ {
		svc.now = func() time.Time { return base.AddDate(0, 0, d) }
		if _, err := svc.MarkPastDue(ctx); err != nil {
			t.Fatalf("MarkPastDue day %d: %v", d, err)
		}
	}
	after, _ := svc.Current(ctx)
	if !after.PastDueSince.Equal(started) {
		t.Fatalf("the grace clock restarted: %s then %s", started, *after.PastDueSince)
	}
}

// Suspension must only ever move past_due to suspended. A bug here that
// touched active subscriptions would take paying churches off the air.
func TestSuspensionNeverTouchesAPayingChurch(t *testing.T) {
	svc, ctx := newService(t)
	if _, err := svc.SetTier(ctx, TierGrowth, "admin"); err != nil {
		t.Fatalf("SetTier: %v", err)
	}

	// Well past any grace period, but active.
	svc.now = func() time.Time { return time.Now().UTC().Add(365 * 24 * time.Hour) }
	n, err := svc.SuspendExpired(context.Background())
	if err != nil {
		t.Fatalf("SuspendExpired: %v", err)
	}
	if n != 0 {
		t.Fatalf("suspended %d active subscriptions", n)
	}

	cur, _ := svc.Current(ctx)
	if cur.Status != StatusActive {
		t.Errorf("a paying church is %q", cur.Status)
	}
	if !cur.Effective().Streaming {
		t.Error("a paying church lost streaming")
	}
}

// Once grace runs out the features stop — and the commission does not move,
// which is ADR-009's line.
func TestGraceExpiryWithdrawsFeaturesOnly(t *testing.T) {
	svc, ctx := newService(t)
	if _, err := svc.SetTier(ctx, TierGrowth, "admin"); err != nil {
		t.Fatalf("SetTier: %v", err)
	}
	before := EntitlementFor(TierGrowth).CommissionBasisPoints

	base := time.Date(2026, 8, 1, 9, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return base }
	if _, err := svc.MarkPastDue(ctx); err != nil {
		t.Fatalf("MarkPastDue: %v", err)
	}

	svc.now = func() time.Time { return base.Add(GracePeriod).Add(time.Hour) }
	n, err := svc.SuspendExpired(context.Background())
	if err != nil {
		t.Fatalf("SuspendExpired: %v", err)
	}
	if n != 1 {
		t.Fatalf("suspended %d, want 1", n)
	}

	ent, err := svc.For(ctx)
	if err != nil {
		t.Fatalf("For: %v", err)
	}
	if ent.Streaming || ent.MaxConcurrentViewers != 0 {
		t.Error("a suspended church kept its streaming")
	}
	if ent.CommissionBasisPoints != before {
		t.Fatalf("suspension moved the commission from %d to %d — that "+
			"recovers our fee from members' giving", before, ent.CommissionBasisPoints)
	}
}

// Paying clears the suspension state and the clock with it.
func TestPayingRestoresEverything(t *testing.T) {
	svc, ctx := newService(t)
	if _, err := svc.SetTier(ctx, TierStarter, "admin"); err != nil {
		t.Fatalf("SetTier: %v", err)
	}
	if _, err := svc.MarkPastDue(ctx); err != nil {
		t.Fatalf("MarkPastDue: %v", err)
	}
	if _, err := svc.MarkPaid(ctx, time.Now().UTC().AddDate(0, 1, 0)); err != nil {
		t.Fatalf("MarkPaid: %v", err)
	}

	cur, _ := svc.Current(ctx)
	if cur.Status != StatusActive {
		t.Errorf("status = %q after payment", cur.Status)
	}
	if cur.PastDueSince != nil {
		t.Error("the grace clock survived a successful payment, so the next " +
			"failure would start already expired")
	}
	if !cur.Effective().Streaming {
		t.Error("streaming did not come back")
	}
}

// An unknown tier is refused rather than stored — a typo must not create a
// subscription whose entitlements nothing can resolve.
func TestAnUnknownTierIsRefused(t *testing.T) {
	svc, ctx := newService(t)
	if _, err := svc.SetTier(ctx, Tier("platinum"), "admin"); err == nil {
		t.Fatal("an unrecognised tier was stored")
	}
}

// A church that recovered but kept a stale grace timestamp must not be
// suspended by the sweeper.
//
// Today nothing leaves that state behind — MarkPaid and SetTier both clear the
// clock — so filtering on the timestamp alone happens to be sufficient. That is
// exactly why this is worth pinning: the safety comes from the STATUS check,
// not from an invariant about which fields are set, and a future path that
// forgets to unset the clock would otherwise take a paying church off the air
// with nothing failing.
func TestAStaleGraceClockOnAnActiveChurchIsIgnored(t *testing.T) {
	svc, ctx := newService(t)
	if _, err := svc.SetTier(ctx, TierGrowth, "admin"); err != nil {
		t.Fatalf("SetTier: %v", err)
	}

	// Active, paying — and carrying a grace timestamp from long ago.
	ancient := time.Now().UTC().Add(-365 * 24 * time.Hour)
	if _, err := svc.subs.UpdateOne(ctx, bson.M{},
		bson.M{"$set": bson.M{"pastDueSince": ancient}}); err != nil {
		t.Fatalf("seed stale clock: %v", err)
	}

	n, err := svc.SuspendExpired(context.Background())
	if err != nil {
		t.Fatalf("SuspendExpired: %v", err)
	}
	if n != 0 {
		t.Fatalf("suspended %d active subscription(s) because of a leftover "+
			"timestamp — a paying church would be off the air", n)
	}

	cur, _ := svc.Current(ctx)
	if cur.Status != StatusActive || !cur.Effective().Streaming {
		t.Errorf("a paying church ended up %q with streaming=%v",
			cur.Status, cur.Effective().Streaming)
	}
}
