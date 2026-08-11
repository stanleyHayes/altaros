package media

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/pion/webrtc/v4"
)

// Signalling: the messages a client and this server exchange to set up media.
//
// One connection per participant, held open for the whole service. It has to be
// a persistent connection rather than a request and a response, because the
// server needs to START an exchange: when the publisher's camera comes on after
// a viewer is already connected, that viewer must be offered the new track, and
// nothing the viewer does would prompt it.

// Message types on the wire.
const (
	// MsgOffer carries an SDP offer. From the client when it joins; from the
	// SERVER when the publisher's tracks change under a connected viewer.
	MsgOffer = "offer"
	// MsgAnswer carries an SDP answer, in whichever direction.
	MsgAnswer = "answer"
	// MsgReady means the server has finished setting up.
	MsgReady = "ready"
	// MsgError carries a failure the client should show or log.
	MsgError = "error"
	// MsgPing and MsgPong keep the connection alive through NAT timeouts.
	//
	// Mobile carrier NAT drops idle mappings in as little as thirty seconds,
	// and a signalling channel is idle for most of a sermon. Without this the
	// path is silently gone when the server next needs to send an offer.
	MsgPing = "ping"
	MsgPong = "pong"
)

// Message is one signalling frame.
type Message struct {
	Type string `json:"type"`
	// SDP is present on offer and answer.
	SDP *webrtc.SessionDescription `json:"sdp,omitempty"`
	// Reason is present on error, and is written for a person to read.
	Reason string `json:"reason,omitempty"`
}

// Conn is the transport under a signalling session.
//
// An interface rather than a concrete WebSocket so the negotiation logic can be
// tested without a network: the tricky part here is the ORDER of offers and
// answers, and a test that has to stand up a real socket to check it is a test
// nobody writes.
type Conn interface {
	Read(ctx context.Context) (Message, error)
	Write(ctx context.Context, msg Message) error
	Close(reason string) error
}

// ErrConnClosed means the participant went away.
var ErrConnClosed = errors.New("media: signalling connection closed")

// session is one participant's signalling loop.
type session struct {
	sfu    *SFU
	conn   Conn
	room   *Room
	id     string
	viewer bool

	// writeMu serialises writes. A renegotiation offer is written from the
	// publisher's track handler while the read loop may be answering
	// something else, and two goroutines writing frames to one socket
	// interleave into JSON neither side can parse.
	writeMu sync.Mutex

	pc *webrtc.PeerConnection
	// release detaches this participant from the room. Held so a reconnect on
	// the same signalling connection frees the old peer rather than leaking it.
	release func()
}

// ServeViewer runs the signalling loop for someone watching.
func (s *SFU) ServeViewer(ctx context.Context, conn Conn, roomID, viewerID string) error {
	room, err := s.Room(roomID)
	if err != nil {
		_ = conn.Write(ctx, Message{Type: MsgError, Reason: "That service is not running."})
		return err
	}
	sess := &session{sfu: s, conn: conn, room: room, id: viewerID, viewer: true}
	return sess.run(ctx)
}

// ServePublisher runs the signalling loop for whoever is broadcasting.
func (s *SFU) ServePublisher(ctx context.Context, conn Conn, roomID, identity string) error {
	room, err := s.Room(roomID)
	if err != nil {
		_ = conn.Write(ctx, Message{Type: MsgError, Reason: "That service is not running."})
		return err
	}
	sess := &session{sfu: s, conn: conn, room: room, id: identity}
	return sess.run(ctx)
}

func (s *session) write(ctx context.Context, msg Message) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	return s.conn.Write(ctx, msg)
}

func (s *session) run(ctx context.Context) error {
	defer s.cleanup()

	for {
		msg, err := s.conn.Read(ctx)
		if err != nil {
			return err
		}

		switch msg.Type {
		case MsgPing:
			if err := s.write(ctx, Message{Type: MsgPong}); err != nil {
				return err
			}

		case MsgOffer:
			if msg.SDP == nil {
				_ = s.write(ctx, Message{Type: MsgError, Reason: "That offer was empty."})
				continue
			}
			if err := s.handleOffer(ctx, *msg.SDP); err != nil {
				// Reported, not fatal. A failed offer is usually one attempt
				// on a bad network, and the client's retry arrives on this
				// same connection — closing it turns a recoverable moment
				// into a rejoin.
				s.sfu.log.Warn("signalling offer failed",
					"room", s.room.ID, "participant", s.id, "error", err)
				_ = s.write(ctx, Message{Type: MsgError, Reason: reasonFor(err)})
				continue
			}

		case MsgAnswer:
			// The answer to an offer WE sent, during renegotiation.
			if msg.SDP == nil || s.pc == nil {
				continue
			}
			if err := s.pc.SetRemoteDescription(*msg.SDP); err != nil {
				s.sfu.log.Warn("renegotiation answer rejected",
					"room", s.room.ID, "participant", s.id, "error", err)
			}

		default:
			// Unknown types are ignored rather than fatal, so a newer client
			// sending something this build does not know about keeps working.
			s.sfu.log.Debug("unknown signalling message",
				"type", msg.Type, "room", s.room.ID)
		}
	}
}

func (s *session) handleOffer(ctx context.Context, offer webrtc.SessionDescription) error {
	// A second offer on the same connection replaces the first. This is a
	// client reconnecting its media without dropping its signalling — common
	// when a phone moves between wifi and mobile data mid-service.
	s.cleanupPeer()

	if s.viewer {
		return s.answerViewer(ctx, offer)
	}
	return s.answerPublisher(ctx, offer)
}

func (s *session) answerPublisher(ctx context.Context, offer webrtc.SessionDescription) error {
	answer, release, err := s.sfu.Publish(ctx, s.room.ID, offer)
	if err != nil {
		return err
	}
	s.release = release
	if err := s.write(ctx, Message{Type: MsgAnswer, SDP: answer}); err != nil {
		release()
		return err
	}
	return s.write(ctx, Message{Type: MsgReady})
}

func (s *session) answerViewer(ctx context.Context, offer webrtc.SessionDescription) error {
	answer, release, err := s.sfu.Watch(ctx, s.room.ID, s.id, offer)
	if err != nil {
		return err
	}
	s.release = release

	// Registered AFTER the connection exists, so a track arriving during setup
	// finds a viewer that can actually be renegotiated.
	s.room.setRenegotiator(s.id, func() { s.offerCurrentTracks(context.WithoutCancel(ctx)) })
	s.pc = s.room.viewerPC(s.id)

	if err := s.write(ctx, Message{Type: MsgAnswer, SDP: answer}); err != nil {
		release()
		return err
	}
	return s.write(ctx, Message{Type: MsgReady})
}

// offerCurrentTracks sends a viewer an offer carrying whatever is being
// published now.
//
// Called from the publisher's track handler, on a different goroutine to the
// read loop, which is why every write goes through the mutex.
func (s *session) offerCurrentTracks(ctx context.Context) {
	if s.pc == nil {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, renegotiateTimeout)
	defer cancel()

	if err := s.room.syncViewerTracks(s.id); err != nil {
		s.sfu.log.Warn("could not sync viewer tracks",
			"room", s.room.ID, "viewer", s.id, "error", err)
		return
	}

	offer, err := s.pc.CreateOffer(nil)
	if err != nil {
		return
	}
	if err := s.pc.SetLocalDescription(offer); err != nil {
		return
	}
	if err := s.write(ctx, Message{Type: MsgOffer, SDP: s.pc.LocalDescription()}); err != nil {
		s.sfu.log.Debug("could not send renegotiation offer",
			"room", s.room.ID, "viewer", s.id, "error", err)
	}
}

// renegotiateTimeout bounds a write to a viewer that has stopped reading.
//
// A phone that lost signal without closing its socket accepts writes into a
// buffer that never drains. Unbounded, one such viewer would hold the
// publisher's track handler and stall the renegotiation of everyone after it.
const renegotiateTimeout = 10 * time.Second

func (s *session) cleanupPeer() {
	if s.release != nil {
		s.release()
		s.release = nil
	}
	s.pc = nil
}

func (s *session) cleanup() {
	s.cleanupPeer()
	if s.viewer {
		s.room.setRenegotiator(s.id, nil)
	}
}

// reasonFor turns an internal error into something a client can act on.
func reasonFor(err error) string {
	switch {
	case errors.Is(err, ErrAlreadyPublishing):
		return "Someone is already broadcasting this service."
	case errors.Is(err, ErrRoomClosed), errors.Is(err, ErrRoomNotFound):
		return "That service has ended."
	default:
		return "We could not start your connection. Please try again."
	}
}

// Decode reads a signalling frame from raw bytes.
func Decode(data []byte) (Message, error) {
	var msg Message
	if err := json.Unmarshal(data, &msg); err != nil {
		return Message{}, fmt.Errorf("media: malformed signalling frame: %w", err)
	}
	return msg, nil
}
