// Package live is streamed services and the giving that happens during them.
//
// # Broadcast first, and why the distinction is structural
//
// A church service is ONE-TO-MANY: the pastor publishes, the congregation
// watches. Nobody in the congregation sends video. That is a different problem
// from a Zoom room where everyone publishes, and the difference is not a
// setting — it decides whether five hundred viewers is routine or impossible.
// Peer-to-peer cannot do it at all: a mesh would need five hundred upstreams
// from one phone on Ghanaian mobile data.
//
// So a Session has a Kind, broadcast rooms are built first, and two-way rooms
// arrive later behind the same port rather than by loosening broadcast.
//
// # The media server is a port
//
// Nothing in this package knows what an SDP offer is. It decides who may
// start a service, who may watch it, when it is full, and what happens to the
// recording — and hands the media itself to a MediaServer. That is the same
// shape ADR-002 uses for payments and notification.Transport uses for SMS, and
// it is what makes the business rules testable without a browser, a TURN
// server, or a second machine.
package live

import (
	"context"
	"errors"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// Collections.
const (
	SessionCollection = "live_sessions"
	// ViewerCollection records who watched, for attendance and for the
	// concurrent-viewer count that enforces the tier cap.
	ViewerCollection = "live_viewers"
)

var (
	// ErrSessionNotFound means no such session in this church.
	ErrSessionNotFound = errors.New("live: session not found")
	// ErrNotLive means the session has not started or has ended.
	ErrNotLive = errors.New("live: that service is not live")
	// ErrFull means the tier's concurrent-viewer cap is reached.
	ErrFull = errors.New("live: this service is full")
	// ErrNotEntitled means the church's plan does not include streaming.
	ErrNotEntitled = errors.New("live: your plan does not include live services")
	// ErrTitleRequired means a session with no name.
	ErrTitleRequired = errors.New("live: give the service a name")
)

// Kind is the shape of a session.
type Kind string

const (
	// KindBroadcast is one publisher, many viewers. A service.
	KindBroadcast Kind = "broadcast"
	// KindRoom is many publishers. A prayer meeting or small group.
	//
	// Declared now so the model does not have to change when it ships, and
	// deliberately NOT the zero value: a session created without a kind is a
	// broadcast, which is the cheap one to be wrong about.
	KindRoom Kind = "room"
)

// Valid reports whether a kind is recognised.
func (k Kind) Valid() bool { return k == KindBroadcast || k == KindRoom }

// Status is where a session is in its life.
type Status string

const (
	StatusScheduled Status = "scheduled"
	StatusLive      Status = "live"
	StatusEnded     Status = "ended"
)

// Live reports whether people may join.
func (s Status) Live() bool { return s == StatusLive }

// Session is one streamed service.
type Session struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`

	Title       string `bson:"title"                 json:"title"`
	Description string `bson:"description,omitempty" json:"description,omitempty"`
	Kind        Kind   `bson:"kind"                  json:"kind"`
	Status      Status `bson:"status"                json:"status"`

	// CampaignID ties the session to an appeal, so giving during the service
	// lands against it without the giver choosing anything.
	CampaignID mongodb.ID `bson:"campaignId,omitempty" json:"campaignId,omitempty"`

	// MaxViewers is the cap for THIS session, snapshotted from the church's
	// tier when the service starts.
	//
	// Snapshotted rather than read live on every join, so a subscription that
	// lapses or downgrades mid-service cannot start turning people away from a
	// service already in progress. Whatever the church was entitled to when
	// the pastor pressed start is what the congregation gets for the next
	// hour; the next service picks up the new plan.
	MaxViewers int `bson:"maxViewers" json:"maxViewers"`
	// CurrentViewers is the live count admission is enforced against.
	CurrentViewers int `bson:"currentViewers" json:"currentViewers"`
	// PeakViewers is what the church sees afterwards, and what a tier upgrade
	// conversation is grounded in.
	PeakViewers int `bson:"peakViewers" json:"peakViewers"`

	// RoomID is the media server's handle. Opaque here on purpose.
	RoomID string `bson:"roomId,omitempty" json:"-"`

	StartedBy mongodb.ID `bson:"startedBy,omitempty" json:"startedBy,omitempty"`
	StartedAt *time.Time `bson:"startedAt,omitempty" json:"startedAt,omitempty"`
	EndedAt   *time.Time `bson:"endedAt,omitempty"   json:"endedAt,omitempty"`

	// GivenMinor is what members gave during the service. Summed from the
	// ledger, never stored — the same rule as campaign totals, and for the
	// same reason.
	GivenMinor int64 `bson:"-" json:"givenMinor"`

	CreatedAt time.Time `bson:"createdAt" json:"createdAt"`
	UpdatedAt time.Time `bson:"updatedAt" json:"updatedAt"`
}

// Viewer is one person watching, and the row the cap is counted from.
type Viewer struct {
	ID        bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID  mongodb.ID    `bson:"churchId"      json:"churchId"`
	SessionID mongodb.ID    `bson:"sessionId"     json:"sessionId"`
	MemberID  mongodb.ID    `bson:"memberId"      json:"memberId"`

	JoinedAt time.Time  `bson:"joinedAt"       json:"joinedAt"`
	LeftAt   *time.Time `bson:"leftAt,omitempty" json:"leftAt,omitempty"`
	// LastSeenAt is refreshed by a heartbeat.
	//
	// Needed because people do not leave, they lose signal. Without it a
	// dropped connection holds a seat until the service ends, and on a
	// congregation-sized cap that means the service fills with ghosts and
	// real members are turned away.
	LastSeenAt time.Time `bson:"lastSeenAt" json:"lastSeenAt"`
}

// ViewerTimeout is how long a silent viewer keeps their seat.
//
// Long enough to survive a tunnel or a lift, short enough that a seat is
// recovered while the service is still on.
const ViewerTimeout = 90 * time.Second

// Stale reports whether a viewer has gone quiet and their seat may be reclaimed.
func (v *Viewer) Stale(now time.Time) bool {
	return v != nil && v.LeftAt == nil && now.Sub(v.LastSeenAt) > ViewerTimeout
}

// Role is what a token lets somebody do in a room.
type Role string

const (
	// RolePublisher may send media. The pastor, or a member in a two-way room.
	RolePublisher Role = "publisher"
	// RoleViewer may only receive.
	RoleViewer Role = "viewer"
)

// Grant is permission to connect, issued after admission is decided here.
type Grant struct {
	RoomID string `json:"roomId"`
	Token  string `json:"token"`
	Role   Role   `json:"role"`
	// ICEServers are the STUN/TURN servers the client must use.
	//
	// Handed to the client per grant rather than baked into the app, because
	// managed TURN credentials are short-lived by design and an app shipped
	// with a static one would stop connecting the day they rotate.
	ICEServers []ICEServer `json:"iceServers"`
	ExpiresAt  time.Time   `json:"expiresAt"`
}

// ICEServer is one STUN or TURN endpoint.
type ICEServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

// MediaServer is the port the SFU sits behind.
//
// Narrow on purpose. This package decides WHO may connect; the implementation
// decides how bytes move. Keeping the interface this small is what lets the
// SFU be replaced — by a different library, or by a managed provider if
// running our own stops being worth it — without touching a single rule about
// tiers, capacity or giving.
type MediaServer interface {
	// OpenRoom prepares a room and returns its handle.
	OpenRoom(ctx context.Context, sessionID string, kind Kind) (roomID string, err error)
	// Grant issues a client credential for a role in a room.
	Grant(ctx context.Context, roomID, identity string, role Role) (*Grant, error)
	// CloseRoom tears the room down and disconnects everyone.
	CloseRoom(ctx context.Context, roomID string) error
}
