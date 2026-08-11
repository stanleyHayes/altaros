package media

import (
	"errors"
	"io"
	"log/slog"
	"sync"
	"time"

	"github.com/pion/webrtc/v4"
)

// A room is one live service: a single publisher, and everyone watching.
//
// This is a Selective Forwarding Unit rather than a mesh, and the difference is
// not an optimisation. In a mesh the publisher sends one copy per viewer: a
// pastor's phone streaming to 500 people would need 500 upstreams, which no
// phone and no Ghanaian mobile connection can do. Here the phone sends ONE
// stream to us, and we forward it. The publisher's upload cost stops depending
// on how many people came.
//
// We also do not decode or re-encode anything. Packets arrive and are forwarded
// as they are, which is what keeps a server able to carry many services at once
// on hardware a startup can afford.

// Room is a live session's media, in memory.
type Room struct {
	ID   string
	Kind string

	log *slog.Logger

	mu sync.RWMutex
	// tracks are what the publisher is sending — normally one audio, one
	// video. Keyed by the track's own id so a republish replaces rather than
	// duplicates.
	tracks map[string]*webrtc.TrackLocalStaticRTP
	// viewers are the peer connections receiving those tracks.
	viewers map[string]*viewer
	// publisher is the one connection allowed to send. Held so that a second
	// publisher can be refused and the first can be torn down on close.
	publisher *webrtc.PeerConnection

	closed bool
}

type viewer struct {
	id string
	pc *webrtc.PeerConnection
	// senders lets a viewer be renegotiated when the publisher's tracks
	// change, instead of being dropped and asked to rejoin.
	senders map[string]*webrtc.RTPSender
	// renegotiate asks the signalling layer to send this viewer a new offer.
	//
	// Without it, anyone who connected BEFORE the publisher started sending
	// would sit on a working connection carrying no media, forever — which is
	// most of a congregation, because people open the app and wait for the
	// service to begin.
	renegotiate func()
}

var (
	// ErrRoomClosed means the service has ended.
	ErrRoomClosed = errors.New("media: this service has ended")
	// ErrAlreadyPublishing means someone is already sending to this room.
	//
	// A broadcast has exactly one publisher. Two would interleave into an
	// unwatchable stream, and the second is far more likely to be a stale
	// reconnect from the same phone than a second person.
	ErrAlreadyPublishing = errors.New("media: this service already has a publisher")
)

// isClosed reports whether the service has ended, under the lock.
//
// An accessor rather than a bare field read: `closed` is written by Close from
// whatever goroutine ends the service, and the SFU reads it while deciding
// whether a room is still usable. Reading it unsynchronised is a data race the
// detector finds and, without it, a room can be handed out mid-teardown.
func (r *Room) isClosed() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.closed
}

func newRoom(id, kind string, log *slog.Logger) *Room {
	return &Room{
		ID: id, Kind: kind, log: log,
		tracks:  make(map[string]*webrtc.TrackLocalStaticRTP),
		viewers: make(map[string]*viewer),
	}
}

// addTrack registers a forwarding track and tells the viewers to renegotiate.
func (r *Room) addTrack(remote *webrtc.TrackRemote) (*webrtc.TrackLocalStaticRTP, error) {
	local, err := webrtc.NewTrackLocalStaticRTP(
		remote.Codec().RTPCodecCapability, remote.ID(), remote.StreamID())
	if err != nil {
		return nil, err
	}

	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return nil, ErrRoomClosed
	}
	r.tracks[remote.ID()] = local
	r.mu.Unlock()

	// Everyone already connected is offered the new track. This is what makes
	// "open the app, then the service starts" work.
	r.renegotiateAll()
	return local, nil
}

// renegotiateAll asks every viewer's signalling loop to send a fresh offer.
//
// The callbacks are collected under the lock and CALLED outside it: each one
// writes to a WebSocket, and holding the room lock across a slow client's
// socket would stall the publisher's track handler and, through it, the
// service for everyone else.
func (r *Room) renegotiateAll() {
	r.mu.RLock()
	callbacks := make([]func(), 0, len(r.viewers))
	for _, v := range r.viewers {
		if v.renegotiate != nil {
			callbacks = append(callbacks, v.renegotiate)
		}
	}
	r.mu.RUnlock()
	for _, cb := range callbacks {
		cb()
	}
}

func (r *Room) removeTrack(id string) {
	r.mu.Lock()
	_, existed := r.tracks[id]
	delete(r.tracks, id)
	r.mu.Unlock()
	if existed {
		r.renegotiateAll()
	}
}

// forward copies RTP packets from the publisher to everyone watching.
//
// A read error ends the loop rather than retrying: it means the publisher's
// track has gone, and a loop that kept trying would hold a goroutine per track
// per ended service for as long as the process lives.
func (r *Room) forward(remote *webrtc.TrackRemote, local *webrtc.TrackLocalStaticRTP) {
	defer r.removeTrack(remote.ID())

	buf := make([]byte, 1500)
	for {
		n, _, err := remote.Read(buf)
		if err != nil {
			if !errors.Is(err, io.EOF) {
				r.log.Debug("publisher track ended", "room", r.ID, "error", err)
			}
			return
		}
		if _, err := local.Write(buf[:n]); err != nil && !errors.Is(err, io.ErrClosedPipe) {
			// A write failure is one viewer's connection, not the broadcast.
			// Returning here would end the service for everyone because one
			// person's phone went into a tunnel.
			r.log.Debug("forward write failed", "room", r.ID, "error", err)
		}
	}
}

// currentTracks is a snapshot for a viewer that is joining or renegotiating.
func (r *Room) currentTracks() []*webrtc.TrackLocalStaticRTP {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]*webrtc.TrackLocalStaticRTP, 0, len(r.tracks))
	for _, t := range r.tracks {
		out = append(out, t)
	}
	return out
}

// Viewers is how many connections are receiving this room.
//
// Reported for observability only. The BILLABLE count — the one a tier caps —
// is the seat count in the live domain, which is held in the database and
// survives this process restarting. Capping on an in-memory number would reset
// a church's limit every deploy.
func (r *Room) Viewers() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.viewers)
}

// Publishing reports whether anyone is sending media.
func (r *Room) Publishing() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.publisher != nil
}

func (r *Room) addViewer(v *viewer) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return ErrRoomClosed
	}
	r.viewers[v.id] = v
	return nil
}

func (r *Room) removeViewer(id string) {
	r.mu.Lock()
	v, ok := r.viewers[id]
	delete(r.viewers, id)
	r.mu.Unlock()
	if ok && v.pc != nil {
		_ = v.pc.Close()
	}
}

// setRenegotiator records how to reach a viewer's signalling loop.
//
// A nil callback deregisters, which is what a departing viewer does. Keeping a
// callback that writes to a closed socket would have every later track change
// spend its timeout on a participant who left.
func (r *Room) setRenegotiator(viewerID string, cb func()) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if v, ok := r.viewers[viewerID]; ok {
		v.renegotiate = cb
	}
}

// viewerPC returns a viewer's peer connection, for renegotiation.
func (r *Room) viewerPC(viewerID string) *webrtc.PeerConnection {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if v, ok := r.viewers[viewerID]; ok {
		return v.pc
	}
	return nil
}

// syncViewerTracks makes a viewer's senders match what is being published.
//
// Both directions matter. Adding covers the ordinary case — someone opened the
// app before the service started. REMOVING covers the camera being switched
// off mid-service: a sender left attached to a track nobody writes to shows the
// congregation a frozen last frame, which reads as a broken app rather than a
// camera that was turned off.
func (r *Room) syncViewerTracks(viewerID string) error {
	r.mu.Lock()
	v, ok := r.viewers[viewerID]
	if !ok {
		r.mu.Unlock()
		return nil
	}
	wanted := make(map[string]*webrtc.TrackLocalStaticRTP, len(r.tracks))
	for id, t := range r.tracks {
		wanted[id] = t
	}
	pc := v.pc
	have := make(map[string]*webrtc.RTPSender, len(v.senders))
	for id, sender := range v.senders {
		have[id] = sender
	}
	r.mu.Unlock()

	added := map[string]*webrtc.RTPSender{}
	for id, track := range wanted {
		if _, ok := have[id]; ok {
			continue
		}
		sender, err := pc.AddTrack(track)
		if err != nil {
			return err
		}
		added[id] = sender
		go readRTCP(sender)
	}
	removed := []string{}
	for id, sender := range have {
		if _, ok := wanted[id]; ok {
			continue
		}
		if err := pc.RemoveTrack(sender); err != nil {
			return err
		}
		removed = append(removed, id)
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if v, ok := r.viewers[viewerID]; ok {
		for id, sender := range added {
			v.senders[id] = sender
		}
		for _, id := range removed {
			delete(v.senders, id)
		}
	}
	return nil
}

func (r *Room) setPublisher(pc *webrtc.PeerConnection) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return ErrRoomClosed
	}
	if r.publisher != nil {
		return ErrAlreadyPublishing
	}
	r.publisher = pc
	return nil
}

func (r *Room) clearPublisher(pc *webrtc.PeerConnection) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.publisher == pc {
		r.publisher = nil
	}
}

// Close ends the service and disconnects everyone.
func (r *Room) Close() {
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return
	}
	r.closed = true
	pub := r.publisher
	viewers := make([]*viewer, 0, len(r.viewers))
	for _, v := range r.viewers {
		viewers = append(viewers, v)
	}
	r.publisher = nil
	r.viewers = map[string]*viewer{}
	r.tracks = map[string]*webrtc.TrackLocalStaticRTP{}
	r.mu.Unlock()

	// Closed outside the lock: PeerConnection.Close blocks while ICE shuts
	// down, and holding the room lock through 500 of those would stall every
	// other room on the server.
	if pub != nil {
		_ = pub.Close()
	}
	for _, v := range viewers {
		_ = v.pc.Close()
	}
}

// readRTCP drains a sender's RTCP so pion processes receiver reports.
//
// Not optional despite discarding everything: these carry the NACKs and PLIs
// that drive retransmission and keyframe requests, and pion only acts on them
// if something reads. A stream left undrained degrades into freezing video
// that looks like a network problem.
func readRTCP(sender *webrtc.RTPSender) {
	buf := make([]byte, 1500)
	for {
		if _, _, err := sender.Read(buf); err != nil {
			return
		}
	}
}

// keyframeInterval is how often a viewer asks the publisher for a fresh
// keyframe.
//
// Someone joining a service mid-sermon sees nothing until the next keyframe
// arrives, and an encoder left alone may not send one for many seconds. Asking
// costs a little bandwidth and removes the "I joined and the screen is black"
// report, which is otherwise indistinguishable from the stream being broken.
const keyframeInterval = 3 * time.Second
