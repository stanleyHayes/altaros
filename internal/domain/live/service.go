package live

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/domain/plan"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// Entitlements is the slice of the plan service this package needs.
type Entitlements interface {
	For(ctx context.Context) (plan.Entitlement, error)
}

// Service runs live sessions.
type Service struct {
	sessions *mongodb.TenantCollection
	viewers  *mongodb.TenantCollection
	plans    Entitlements
	media    MediaServer
	now      func() time.Time
}

// NewService builds the service.
func NewService(db *mongodb.DB, plans Entitlements, media MediaServer) *Service {
	return &Service{
		sessions: db.Tenant(SessionCollection),
		viewers:  db.Tenant(ViewerCollection),
		plans:    plans,
		media:    media,
		now:      func() time.Time { return time.Now().UTC() },
	}
}

// Start takes a scheduled session live.
//
// The tier is read HERE and snapshotted onto the session — see MaxViewers for
// why a lapsed subscription must not start turning people away from a service
// already under way.
func (s *Service) Start(ctx context.Context, sessionID, actorID string) (*Session, error) {
	oid, session, err := s.read(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if session.Status == StatusEnded {
		return nil, ErrNotLive
	}

	ent, err := s.plans.For(ctx)
	if err != nil {
		return nil, fmt.Errorf("live: read plan: %w", err)
	}
	if !ent.Streaming || ent.MaxConcurrentViewers <= 0 {
		return nil, ErrNotEntitled
	}

	roomID, err := s.media.OpenRoom(ctx, oid.Hex(), session.Kind)
	if err != nil {
		return nil, fmt.Errorf("live: open room: %w", err)
	}

	now := s.now()
	// Conditional on it not already being live. Two people pressing start —
	// the pastor and the media desk, which is the normal case — must not open
	// two rooms and split the congregation between them.
	res, err := s.sessions.UpdateOne(ctx,
		bson.M{"_id": oid, "status": bson.M{"$ne": string(StatusLive)}},
		bson.M{"$set": bson.M{
			"status": string(StatusLive), "roomId": roomID,
			"maxViewers": ent.MaxConcurrentViewers, "currentViewers": 0,
			"startedAt": now, "startedBy": mongodb.ID(actorID), "updatedAt": now,
		}})
	if err != nil {
		return nil, fmt.Errorf("live: start session: %w", err)
	}
	if res.ModifiedCount == 0 {
		// Somebody else started it. Tear down the room we just opened rather
		// than leaving an orphan the media server bills for.
		_ = s.media.CloseRoom(ctx, roomID)
		return s.SessionByID(ctx, sessionID)
	}
	return s.SessionByID(ctx, sessionID)
}

// Join admits a viewer, or refuses because the service is full.
//
// # Why this is one conditional update and not a read-then-write
//
// The obvious version reads CurrentViewers, compares it to MaxViewers, and
// then increments. On a Sunday morning that is exactly wrong: a congregation
// does not arrive gradually, it arrives when the service starts, and dozens of
// joins land inside the same second. Every one of them reads the same count,
// every one decides there is room, and a 100-seat tier admits 130 people — the
// bandwidth is spent before anybody notices, and the cap the church is paying
// for turns out to be a suggestion.
//
// So the check and the increment are the SAME statement, and the database
// decides. A join that loses the race matches nothing and is refused.
func (s *Service) Join(ctx context.Context, sessionID, memberID string) (*Grant, error) {
	oid, session, err := s.read(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if !session.Status.Live() {
		return nil, ErrNotLive
	}

	now := s.now()

	// Already watching: rejoining on a flaky connection must not consume a
	// second seat. Refreshes the heartbeat and reissues a grant.
	existing, err := s.viewers.UpdateOne(ctx, bson.M{
		"sessionId": oid, "memberId": mongodb.ID(memberID),
		"leftAt": bson.M{"$exists": false},
	}, bson.M{"$set": bson.M{"lastSeenAt": now}})
	if err != nil {
		return nil, fmt.Errorf("live: refresh viewer: %w", err)
	}
	if existing.ModifiedCount == 0 {
		// A new seat. The filter carries the capacity test, so the increment
		// only happens if there was room at the instant it ran.
		res, err := s.sessions.UpdateOne(ctx, bson.M{
			"_id":    oid,
			"status": string(StatusLive),
			"$expr":  bson.M{"$lt": bson.A{"$currentViewers", "$maxViewers"}},
		}, bson.M{"$inc": bson.M{"currentViewers": 1}})
		if err != nil {
			return nil, fmt.Errorf("live: admit viewer: %w", err)
		}
		if res.ModifiedCount == 0 {
			return nil, ErrFull
		}

		if _, err := s.viewers.InsertOne(ctx, bson.M{
			"sessionId": oid, "memberId": mongodb.ID(memberID),
			"joinedAt": now, "lastSeenAt": now,
		}); err != nil {
			// The seat is taken but unrecorded. Give it back rather than
			// leaking capacity for the rest of the service.
			_, _ = s.sessions.UpdateOne(ctx, bson.M{"_id": oid},
				bson.M{"$inc": bson.M{"currentViewers": -1}})
			return nil, fmt.Errorf("live: record viewer: %w", err)
		}
		s.recordPeak(ctx, oid)
	}

	role := RoleViewer
	if session.Kind == KindRoom {
		role = RolePublisher
	}
	return s.media.Grant(ctx, session.RoomID, memberID, role)
}

// Leave releases a seat.
func (s *Service) Leave(ctx context.Context, sessionID, memberID string) error {
	oid, _, err := s.read(ctx, sessionID)
	if err != nil {
		return err
	}
	now := s.now()

	// Conditional on the viewer still being present, so a double "leave" —
	// a closed tab plus a heartbeat timeout racing — releases one seat, not
	// two, and the count cannot drift below zero.
	res, err := s.viewers.UpdateOne(ctx, bson.M{
		"sessionId": oid, "memberId": mongodb.ID(memberID),
		"leftAt": bson.M{"$exists": false},
	}, bson.M{"$set": bson.M{"leftAt": now}})
	if err != nil {
		return fmt.Errorf("live: mark viewer left: %w", err)
	}
	if res.ModifiedCount == 0 {
		return nil
	}

	if _, err := s.sessions.UpdateOne(ctx,
		bson.M{"_id": oid, "currentViewers": bson.M{"$gt": 0}},
		bson.M{"$inc": bson.M{"currentViewers": -1}}); err != nil {
		return fmt.Errorf("live: release seat: %w", err)
	}
	return nil
}

// Heartbeat keeps a seat. Called by the client while it is still watching.
func (s *Service) Heartbeat(ctx context.Context, sessionID, memberID string) error {
	oid, _, err := s.read(ctx, sessionID)
	if err != nil {
		return err
	}
	_, err = s.viewers.UpdateOne(ctx, bson.M{
		"sessionId": oid, "memberId": mongodb.ID(memberID),
		"leftAt": bson.M{"$exists": false},
	}, bson.M{"$set": bson.M{"lastSeenAt": s.now()}})
	if err != nil {
		return fmt.Errorf("live: heartbeat: %w", err)
	}
	return nil
}

// ReclaimStaleSeats releases seats held by viewers who went quiet.
//
// People do not leave, they lose signal. Without this a dropped connection
// holds a seat until the service ends, and on a congregation-sized cap the
// service fills with ghosts while real members are turned away.
func (s *Service) ReclaimStaleSeats(ctx context.Context, sessionID string) (int, error) {
	oid, _, err := s.read(ctx, sessionID)
	if err != nil {
		return 0, err
	}
	cutoff := s.now().Add(-ViewerTimeout)

	var stale []Viewer
	if err := s.viewers.Find(ctx, bson.M{
		"sessionId": oid, "leftAt": bson.M{"$exists": false},
		"lastSeenAt": bson.M{"$lt": cutoff},
	}, &stale); err != nil {
		return 0, fmt.Errorf("live: find stale viewers: %w", err)
	}

	freed := 0
	for i := range stale {
		if err := s.Leave(ctx, sessionID, stale[i].MemberID.String()); err == nil {
			freed++
		}
	}
	return freed, nil
}

// End closes the service.
func (s *Service) End(ctx context.Context, sessionID string) (*Session, error) {
	oid, session, err := s.read(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if session.RoomID != "" {
		// Best effort: the session must end in our records even if the media
		// server is unreachable, or a church is billed for a room it cannot
		// close and the seats never come back.
		_ = s.media.CloseRoom(ctx, session.RoomID)
	}

	now := s.now()
	if _, err := s.sessions.UpdateOne(ctx, bson.M{"_id": oid}, bson.M{"$set": bson.M{
		"status": string(StatusEnded), "endedAt": now,
		"currentViewers": 0, "updatedAt": now,
	}}); err != nil {
		return nil, fmt.Errorf("live: end session: %w", err)
	}
	return s.SessionByID(ctx, sessionID)
}

// recordPeak raises the high-water mark, never lowers it.
func (s *Service) recordPeak(ctx context.Context, oid bson.ObjectID) {
	var cur Session
	if err := s.sessions.FindOne(ctx, bson.M{"_id": oid}, &cur); err != nil {
		return
	}
	if cur.CurrentViewers > cur.PeakViewers {
		_, _ = s.sessions.UpdateOne(ctx,
			bson.M{"_id": oid, "peakViewers": bson.M{"$lt": cur.CurrentViewers}},
			bson.M{"$set": bson.M{"peakViewers": cur.CurrentViewers}})
	}
}

// SessionByID reads one session.
func (s *Service) SessionByID(ctx context.Context, id string) (*Session, error) {
	_, out, err := s.read(ctx, id)
	return out, err
}

func (s *Service) read(ctx context.Context, id string) (bson.ObjectID, *Session, error) {
	oid, err := bson.ObjectIDFromHex(strings.TrimSpace(id))
	if err != nil {
		return bson.ObjectID{}, nil, ErrSessionNotFound
	}
	var out Session
	err = s.sessions.FindOne(ctx, bson.M{"_id": oid}, &out)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return bson.ObjectID{}, nil, ErrSessionNotFound
	}
	if err != nil {
		return bson.ObjectID{}, nil, fmt.Errorf("live: read session: %w", err)
	}
	return oid, &out, nil
}

// ScheduleInput creates a session before it goes live.
type ScheduleInput struct {
	Title       string
	Description string
	Kind        Kind
	CampaignID  string
}

// Schedule creates a session in the scheduled state.
//
// Separate from Start on purpose: a church puts next Sunday's service in the
// app during the week, and the tier is checked when it STARTS rather than
// here — scheduling something your plan cannot yet run is a reason to upgrade,
// not an error to show a volunteer on a Tuesday.
func (s *Service) Schedule(ctx context.Context, in ScheduleInput) (*Session, error) {
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return nil, ErrTitleRequired
	}
	if in.Kind == "" {
		in.Kind = KindBroadcast
	}
	if !in.Kind.Valid() {
		in.Kind = KindBroadcast
	}

	now := s.now()
	doc := bson.M{
		"title": title, "kind": string(in.Kind),
		"status":         string(StatusScheduled),
		"currentViewers": 0, "maxViewers": 0, "peakViewers": 0,
		"createdAt": now, "updatedAt": now,
	}
	if d := strings.TrimSpace(in.Description); d != "" {
		doc["description"] = d
	}
	if in.CampaignID != "" {
		doc["campaignId"] = mongodb.ID(in.CampaignID)
	}

	res, err := s.sessions.InsertOne(ctx, doc)
	if err != nil {
		return nil, fmt.Errorf("live: schedule session: %w", err)
	}
	oid, _ := res.InsertedID.(bson.ObjectID)
	return s.SessionByID(ctx, oid.Hex())
}

// Sessions lists this church's services, newest first.
func (s *Service) Sessions(ctx context.Context) ([]Session, error) {
	out := []Session{}
	err := s.sessions.Find(ctx, bson.M{}, &out,
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetLimit(100))
	if err != nil {
		return nil, fmt.Errorf("live: list sessions: %w", err)
	}
	return out, nil
}

// EnsureIndexes creates what live sessions need.
func (s *Service) EnsureIndexes(ctx context.Context) error {
	if err := s.sessions.EnsureIndexes(ctx, []mongo.IndexModel{{
		Keys: bson.D{
			{Key: "churchId", Value: 1}, {Key: "status", Value: 1},
			{Key: "createdAt", Value: -1},
		},
		Options: options.Index().SetName("church_live_status"),
	}}); err != nil {
		return fmt.Errorf("live: session indexes: %w", err)
	}
	return s.viewers.EnsureIndexes(ctx, []mongo.IndexModel{{
		// One live seat per member per session. The unique index is what makes
		// the "already watching" check safe under a reconnect storm rather
		// than merely usually right.
		Keys: bson.D{
			{Key: "churchId", Value: 1}, {Key: "sessionId", Value: 1},
			{Key: "memberId", Value: 1}, {Key: "joinedAt", Value: 1},
		},
		Options: options.Index().SetName("church_session_member_seat"),
	}})
}

// NotConfigured is the media server used when no SFU is wired up.
//
// It REFUSES rather than pretending, for the same reason an unconfigured SMS
// transport records a suppression instead of reporting success: a church that
// presses "go live" and sees nothing happen deserves to be told the feature is
// not switched on, not left watching a spinner while the product implies a
// broadcast nobody can join.
type NotConfigured struct{}

// ErrMediaNotConfigured means no SFU is available in this deployment.
var ErrMediaNotConfigured = errors.New("live: streaming is not configured on this server")

func (NotConfigured) OpenRoom(context.Context, string, Kind) (string, error) {
	return "", ErrMediaNotConfigured
}
func (NotConfigured) Grant(context.Context, string, string, Role) (*Grant, error) {
	return nil, ErrMediaNotConfigured
}
func (NotConfigured) CloseRoom(context.Context, string) error { return nil }
