package live

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"

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
