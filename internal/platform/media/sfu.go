package media

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/pion/interceptor"
	"github.com/pion/webrtc/v4"
)

// SFU forwards one publisher's media to many viewers.
//
// It runs IN the API process rather than as a separate service, which is a
// deliberate choice for the size this product is at: a church of 200 watching a
// Sunday service is a few hundred megabits, and a second deployable to operate,
// monitor and secure buys nothing until that stops being true. The port
// (live.MediaServer) is what makes moving it later a swap rather than a rewrite
// — the domain never learns what is behind it.

// Config is what the SFU needs to reach clients.
type Config struct {
	// ICEServers are handed to every client. STUN alone is not enough here.
	//
	// Ghanaian mobile networks are overwhelmingly behind carrier-grade NAT,
	// where two phones cannot be made to talk directly however much STUN they
	// do. Without a TURN relay a large share of a congregation simply never
	// connects, and the failure looks like "the app does not work on MTN"
	// rather than anything a log would explain.
	ICEServers []webrtc.ICEServer

	// GrantTTL is how long a client credential stays valid.
	GrantTTL time.Duration

	Logger *slog.Logger
}

// DefaultGrantTTL bounds a stolen credential without outliving a service.
//
// Long enough that a two-hour service does not eject the congregation, short
// enough that a token lifted from a shared screenshot stops working the same
// afternoon. Reconnects re-issue, so a legitimate viewer never notices.
const DefaultGrantTTL = 3 * time.Hour

// SFU is the media server.
type SFU struct {
	cfg Config
	log *slog.Logger

	mu    sync.RWMutex
	rooms map[string]*Room

	// api is built once. The MediaEngine and interceptor registry it carries
	// are what enable NACK and RTCP feedback, and building a fresh one per
	// connection is both slower and a way for two connections to disagree
	// about which codecs exist.
	api *webrtc.API
}

var (
	// ErrRoomNotFound means no such live room on this server.
	ErrRoomNotFound = errors.New("media: that service is not running here")
	// ErrNoTURN means the SFU was configured without a relay.
	ErrNoTURN = errors.New("media: no TURN server is configured")
)

// New builds an SFU.
func New(cfg Config) (*SFU, error) {
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	if cfg.GrantTTL <= 0 {
		cfg.GrantTTL = DefaultGrantTTL
	}

	engine := &webrtc.MediaEngine{}
	if err := engine.RegisterDefaultCodecs(); err != nil {
		return nil, fmt.Errorf("media: register codecs: %w", err)
	}
	registry := &interceptor.Registry{}
	if err := webrtc.RegisterDefaultInterceptors(engine, registry); err != nil {
		return nil, fmt.Errorf("media: register interceptors: %w", err)
	}

	return &SFU{
		cfg:   cfg,
		log:   cfg.Logger,
		rooms: make(map[string]*Room),
		api: webrtc.NewAPI(
			webrtc.WithMediaEngine(engine),
			webrtc.WithInterceptorRegistry(registry),
		),
	}, nil
}

// HasRelay reports whether a TURN server is configured.
//
// Exposed so startup can WARN rather than discover it when a congregation
// cannot connect. A church on a corporate wifi will work fine in testing and
// the same build will fail for most of the congregation on mobile data.
func (s *SFU) HasRelay() bool {
	for _, ice := range s.cfg.ICEServers {
		for _, u := range ice.URLs {
			if strings.HasPrefix(u, "turn:") || strings.HasPrefix(u, "turns:") {
				return true
			}
		}
	}
	return false
}

// OpenRoom prepares a room for a session.
//
// Idempotent: reopening an existing room returns it rather than replacing it,
// because a start request retried after a timeout must not disconnect a
// congregation that is already watching.
func (s *SFU) OpenRoom(_ context.Context, sessionID, kind string) (string, error) {
	if strings.TrimSpace(sessionID) == "" {
		return "", errors.New("media: a room needs a session id")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.rooms[sessionID]; ok && !existing.isClosed() {
		return existing.ID, nil
	}
	room := newRoom(sessionID, kind, s.log)
	s.rooms[sessionID] = room
	s.log.Info("live room opened", "room", sessionID, "kind", kind)
	return sessionID, nil
}

// Room returns a live room, if it is running here.
func (s *SFU) Room(id string) (*Room, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	room, ok := s.rooms[id]
	if !ok || room.isClosed() {
		return nil, ErrRoomNotFound
	}
	return room, nil
}

// CloseRoom ends a service and disconnects everyone.
//
// A room that is not here is NOT an error. The service ending is the truth in
// the database; this process may have restarted since it started, and refusing
// to end a service because its media is already gone would leave a church
// unable to close it.
func (s *SFU) CloseRoom(_ context.Context, roomID string) error {
	s.mu.Lock()
	room, ok := s.rooms[roomID]
	delete(s.rooms, roomID)
	s.mu.Unlock()
	if !ok {
		return nil
	}
	room.Close()
	s.log.Info("live room closed", "room", roomID)
	return nil
}

// ICEServers is what a client must be told to use.
func (s *SFU) ICEServers() []webrtc.ICEServer { return s.cfg.ICEServers }

// GrantTTL is how long a credential lasts.
func (s *SFU) GrantTTL() time.Duration { return s.cfg.GrantTTL }

// Rooms is how many services are running, for health reporting.
func (s *SFU) Rooms() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.rooms)
}

// Shutdown closes every room.
func (s *SFU) Shutdown() {
	s.mu.Lock()
	rooms := make([]*Room, 0, len(s.rooms))
	for _, r := range s.rooms {
		rooms = append(rooms, r)
	}
	s.rooms = map[string]*Room{}
	s.mu.Unlock()
	for _, r := range rooms {
		r.Close()
	}
}
