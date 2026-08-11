package live

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/hayfordstanley/altar-os/internal/domain/plan"
	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
	"go.mongodb.org/mongo-driver/v2/bson"
)

const testChurch = "6a6d0a46536bf5e6e21cf901"

// fakeMedia stands in for the SFU. The point of the port is that every rule
// in this package can be tested without a browser, a TURN server or a second
// machine — so this is a few lines rather than a harness.
type fakeMedia struct {
	mu     sync.Mutex
	opened int
	closed int
}

func (f *fakeMedia) OpenRoom(context.Context, string, Kind) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.opened++
	return "room-1", nil
}
func (f *fakeMedia) Grant(_ context.Context, roomID, identity string, role Role) (*Grant, error) {
	return &Grant{RoomID: roomID, Token: "t-" + identity, Role: role}, nil
}
func (f *fakeMedia) CloseRoom(context.Context, string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closed++
	return nil
}

type fixedPlan struct{ ent plan.Entitlement }

func (f fixedPlan) For(context.Context) (plan.Entitlement, error) { return f.ent, nil }

type harness struct {
	svc   *Service
	media *fakeMedia
	ctx   context.Context
}

func newHarness(t *testing.T, seats int, streaming bool) *harness {
	t.Helper()
	connect, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	db, err := mongodb.Connect(connect, config.MongoConfig{
		URI: testsupport.MongoURI(), Database: "altar_test_live",
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

	media := &fakeMedia{}
	h := &harness{
		media: media,
		svc: NewService(db, fixedPlan{ent: plan.Entitlement{
			Streaming: streaming, MaxConcurrentViewers: seats,
		}}, media),
		ctx: tenancy.WithScope(context.Background(), tenancy.Scope{
			ChurchID: testChurch, UserID: "pastor", Role: "CHURCH_ADMIN",
		}),
	}
	return h
}

func (h *harness) schedule(t *testing.T) string {
	t.Helper()
	now := time.Now().UTC()
	res, err := h.svc.sessions.InsertOne(h.ctx, bson.M{
		"title": "Sunday Service", "kind": string(KindBroadcast),
		"status": string(StatusScheduled), "currentViewers": 0, "maxViewers": 0,
		"createdAt": now, "updatedAt": now,
	})
	if err != nil {
		t.Fatalf("schedule: %v", err)
	}
	id, _ := res.InsertedID.(bson.ObjectID)
	return id.Hex()
}

// THE test for this package. A congregation does not arrive gradually — it
// arrives when the service starts, and dozens of joins land inside the same
// second. A read-then-write capacity check admits all of them.
func TestAStampedeCannotOversellTheSeats(t *testing.T) {
	const seats = 10
	const rushing = 60

	h := newHarness(t, seats, true)
	id := h.schedule(t)
	if _, err := h.svc.Start(h.ctx, id, "pastor"); err != nil {
		t.Fatalf("Start: %v", err)
	}

	var wg sync.WaitGroup
	var mu sync.Mutex
	admitted, refused := 0, 0

	for i := 0; i < rushing; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			member := bson.NewObjectID().Hex()
			_, err := h.svc.Join(h.ctx, id, member)
			mu.Lock()
			defer mu.Unlock()
			switch err {
			case nil:
				admitted++
			case ErrFull:
				refused++
			default:
				t.Errorf("join %d: %v", n, err)
			}
		}(i)
	}
	wg.Wait()

	if admitted != seats {
		t.Fatalf("%d people admitted to a %d-seat service — the church is "+
			"paying for a cap that is only a suggestion", admitted, seats)
	}
	if refused != rushing-seats {
		t.Errorf("refused %d, want %d", refused, rushing-seats)
	}

	session, err := h.svc.SessionByID(h.ctx, id)
	if err != nil {
		t.Fatalf("SessionByID: %v", err)
	}
	if session.CurrentViewers != seats {
		t.Errorf("the session counts %d viewers, want %d",
			session.CurrentViewers, seats)
	}
}

// Rejoining on a flaky connection must not consume a second seat. On Ghanaian
// mobile data this is the common case, not the edge one.
func TestRejoiningDoesNotTakeASecondSeat(t *testing.T) {
	h := newHarness(t, 2, true)
	id := h.schedule(t)
	if _, err := h.svc.Start(h.ctx, id, "pastor"); err != nil {
		t.Fatalf("Start: %v", err)
	}
	member := bson.NewObjectID().Hex()

	for i := 0; i < 5; i++ {
		if _, err := h.svc.Join(h.ctx, id, member); err != nil {
			t.Fatalf("join %d: %v", i, err)
		}
	}
	session, _ := h.svc.SessionByID(h.ctx, id)
	if session.CurrentViewers != 1 {
		t.Fatalf("one member reconnecting five times consumed %d seats",
			session.CurrentViewers)
	}
}

// Leaving twice — a closed tab plus a heartbeat timeout racing — must release
// one seat, and the count must never go negative.
func TestLeavingTwiceReleasesOneSeat(t *testing.T) {
	h := newHarness(t, 5, true)
	id := h.schedule(t)
	if _, err := h.svc.Start(h.ctx, id, "pastor"); err != nil {
		t.Fatalf("Start: %v", err)
	}
	member := bson.NewObjectID().Hex()
	if _, err := h.svc.Join(h.ctx, id, member); err != nil {
		t.Fatalf("Join: %v", err)
	}
	for i := 0; i < 3; i++ {
		if err := h.svc.Leave(h.ctx, id, member); err != nil {
			t.Fatalf("leave %d: %v", i, err)
		}
	}
	session, _ := h.svc.SessionByID(h.ctx, id)
	if session.CurrentViewers != 0 {
		t.Fatalf("viewers = %d after one join and three leaves",
			session.CurrentViewers)
	}
}

// A church without streaming in its plan cannot start a service, and no room
// is opened — otherwise we pay the media server for a service nobody watches.
func TestAChurchWithoutStreamingCannotStart(t *testing.T) {
	h := newHarness(t, 0, false)
	id := h.schedule(t)

	if _, err := h.svc.Start(h.ctx, id, "pastor"); err != ErrNotEntitled {
		t.Fatalf("Start returned %v, want ErrNotEntitled", err)
	}
	if h.media.opened != 0 {
		t.Error("a room was opened for a church that may not stream")
	}
}

// Two people pressing start — the pastor and the media desk, which is the
// normal case — must not open two rooms and split the congregation.
func TestStartingTwiceOpensOneRoom(t *testing.T) {
	h := newHarness(t, 50, true)
	id := h.schedule(t)

	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, _ = h.svc.Start(h.ctx, id, "pastor") }()
	}
	wg.Wait()

	session, _ := h.svc.SessionByID(h.ctx, id)
	if session.Status != StatusLive {
		t.Fatalf("session is %s", session.Status)
	}
	// Extra rooms may be opened by losing racers, but each must be closed
	// again — an orphaned room is one the media server keeps billing for.
	h.media.mu.Lock()
	defer h.media.mu.Unlock()
	if h.media.opened-h.media.closed != 1 {
		t.Errorf("opened %d rooms and closed %d — %d left orphaned",
			h.media.opened, h.media.closed, h.media.opened-h.media.closed-1)
	}
}

// The cap is snapshotted at start, so a subscription lapsing mid-service does
// not begin turning people away from a service already under way.
func TestTheCapIsSnapshottedWhenTheServiceStarts(t *testing.T) {
	h := newHarness(t, 25, true)
	id := h.schedule(t)
	if _, err := h.svc.Start(h.ctx, id, "pastor"); err != nil {
		t.Fatalf("Start: %v", err)
	}

	// The plan collapses mid-service.
	h.svc.plans = fixedPlan{ent: plan.Entitlement{Streaming: false, MaxConcurrentViewers: 0}}

	if _, err := h.svc.Join(h.ctx, id, bson.NewObjectID().Hex()); err != nil {
		t.Fatalf("a member was turned away from a service already in progress "+
			"because the church's plan lapsed: %v", err)
	}
	session, _ := h.svc.SessionByID(h.ctx, id)
	if session.MaxViewers != 25 {
		t.Errorf("the snapshotted cap changed to %d", session.MaxViewers)
	}
}

// A seat held by somebody who lost signal has to come back, or the service
// fills with ghosts while real members are refused.
func TestASilentViewerLosesTheirSeat(t *testing.T) {
	h := newHarness(t, 1, true)
	id := h.schedule(t)
	if _, err := h.svc.Start(h.ctx, id, "pastor"); err != nil {
		t.Fatalf("Start: %v", err)
	}
	ghost := bson.NewObjectID().Hex()
	if _, err := h.svc.Join(h.ctx, id, ghost); err != nil {
		t.Fatalf("Join: %v", err)
	}
	// The one seat is taken.
	if _, err := h.svc.Join(h.ctx, id, bson.NewObjectID().Hex()); err != ErrFull {
		t.Fatalf("second join returned %v, want ErrFull", err)
	}

	// The ghost goes quiet.
	h.svc.now = func() time.Time { return time.Now().UTC().Add(ViewerTimeout + time.Minute) }
	freed, err := h.svc.ReclaimStaleSeats(h.ctx, id)
	if err != nil {
		t.Fatalf("ReclaimStaleSeats: %v", err)
	}
	if freed != 1 {
		t.Fatalf("reclaimed %d seats, want 1", freed)
	}
	if _, err := h.svc.Join(h.ctx, id, bson.NewObjectID().Hex()); err != nil {
		t.Fatalf("a real member still could not join: %v", err)
	}
}

// A rapid reconnect must not take a second seat.
//
// Freezing the clock means every join rewrites lastSeenAt with the value it
// already holds, which is the condition under which the old ModifiedCount
// check mistook a viewer who was plainly present for a new arrival. It
// reproduces intermittently rather than every time — the exact trigger was
// never isolated — so this runs alongside the plain rejoin test rather than
// replacing it, and the two together caught it about five runs in twelve.
func TestAReconnectWithNoClockMovementKeepsOneSeat(t *testing.T) {
	h := newHarness(t, 2, true)
	// Every write stamps the same instant, so lastSeenAt never changes.
	frozen := time.Now().UTC().Truncate(time.Millisecond)
	h.svc.now = func() time.Time { return frozen }

	id := h.schedule(t)
	if _, err := h.svc.Start(h.ctx, id, "pastor"); err != nil {
		t.Fatalf("Start: %v", err)
	}
	member := bson.NewObjectID().Hex()

	for i := 0; i < 3; i++ {
		if _, err := h.svc.Join(h.ctx, id, member); err != nil {
			t.Fatalf("join %d: %v", i, err)
		}
	}

	session, err := h.svc.SessionByID(h.ctx, id)
	if err != nil {
		t.Fatalf("SessionByID: %v", err)
	}
	if session.CurrentViewers != 1 {
		t.Fatalf("one member reconnecting three times with a frozen clock "+
			"consumed %d seats — on a capped tier that is other members "+
			"turned away", session.CurrentViewers)
	}
}
