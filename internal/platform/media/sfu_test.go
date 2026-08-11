package media

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
	mediapkg "github.com/pion/webrtc/v4/pkg/media"
)

// These are REAL WebRTC connections over loopback, not mocks. An SFU's whole
// job is that a packet written by one peer comes out of another, and a test
// with a fake peer connection would pass while the forwarding was broken —
// which is the only thing here worth testing.

func testSFU(t *testing.T) *SFU {
	t.Helper()
	s, err := New(Config{
		Logger: slog.New(slog.NewTextHandler(os.Stderr,
			&slog.HandlerOptions{Level: slog.LevelError})),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(s.Shutdown)
	return s
}

// client is a peer on the other side of the SFU.
type client struct {
	pc    *webrtc.PeerConnection
	track *webrtc.TrackLocalStaticSample
}

func newClient(t *testing.T) *client {
	t.Helper()
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("client connection: %v", err)
	}
	t.Cleanup(func() { _ = pc.Close() })
	return &client{pc: pc}
}

// offerVideo adds a video track and produces an offer with candidates gathered.
func (c *client) offerVideo(t *testing.T) webrtc.SessionDescription {
	t.Helper()
	track, err := webrtc.NewTrackLocalStaticSample(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8},
		"video", "altar-test")
	if err != nil {
		t.Fatalf("track: %v", err)
	}
	c.track = track
	if _, err := c.pc.AddTrack(track); err != nil {
		t.Fatalf("add track: %v", err)
	}
	return c.offer(t)
}

// offerReceive produces an offer that only wants to receive.
func (c *client) offerReceive(t *testing.T) webrtc.SessionDescription {
	t.Helper()
	if _, err := c.pc.AddTransceiverFromKind(webrtc.RTPCodecTypeVideo,
		webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionRecvonly},
	); err != nil {
		t.Fatalf("transceiver: %v", err)
	}
	return c.offer(t)
}

func (c *client) offer(t *testing.T) webrtc.SessionDescription {
	t.Helper()
	offer, err := c.pc.CreateOffer(nil)
	if err != nil {
		t.Fatalf("create offer: %v", err)
	}
	gathered := webrtc.GatheringCompletePromise(c.pc)
	if err := c.pc.SetLocalDescription(offer); err != nil {
		t.Fatalf("set local: %v", err)
	}
	select {
	case <-gathered:
	case <-time.After(10 * time.Second):
		t.Fatal("client ICE gathering timed out")
	}
	return *c.pc.LocalDescription()
}

func (c *client) accept(t *testing.T, answer *webrtc.SessionDescription) {
	t.Helper()
	if err := c.pc.SetRemoteDescription(*answer); err != nil {
		t.Fatalf("set remote: %v", err)
	}
}

// sendVideo writes sample frames until the test is done.
func (c *client) sendVideo(t *testing.T) {
	t.Helper()
	stop := make(chan struct{})
	t.Cleanup(func() { close(stop) })
	go func() {
		ticker := time.NewTicker(20 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				_ = c.track.WriteSample(sampleFrame())
			}
		}
	}()
}

// The single most important behaviour in this package: a packet the publisher
// sends comes out of a viewer's connection.
func TestAPublishersVideoReachesAViewer(t *testing.T) {
	s := testSFU(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	roomID, err := s.OpenRoom(ctx, "session-1", "broadcast")
	if err != nil {
		t.Fatalf("OpenRoom: %v", err)
	}

	publisher := newClient(t)
	answer, _, err := s.Publish(ctx, roomID, publisher.offerVideo(t))
	if err != nil {
		t.Fatalf("Publish: %v", err)
	}
	publisher.accept(t, answer)
	publisher.sendVideo(t)

	// The track has to reach the room before a viewer can be offered it.
	waitForTracks(t, s, roomID, 1)

	viewer := newClient(t)
	received := make(chan struct{})
	var once sync.Once
	viewer.pc.OnTrack(func(track *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		buf := make([]byte, 1500)
		for {
			if _, _, err := track.Read(buf); err != nil {
				return
			}
			// The packet arrived. That is the assertion.
			once.Do(func() { close(received) })
		}
	})

	viewerAnswer, _, err := s.Watch(ctx, roomID, "viewer-1", viewer.offerReceive(t))
	if err != nil {
		t.Fatalf("Watch: %v", err)
	}
	viewer.accept(t, viewerAnswer)

	select {
	case <-received:
	case <-time.After(20 * time.Second):
		t.Fatal("no media reached the viewer — the forwarding is broken")
	}
}

// A broadcast has one publisher. A second would interleave into an unwatchable
// stream, and is far more likely to be a stale reconnect than a second person.
func TestASecondPublisherIsRefused(t *testing.T) {
	s := testSFU(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	roomID, err := s.OpenRoom(ctx, "session-2", "broadcast")
	if err != nil {
		t.Fatalf("OpenRoom: %v", err)
	}

	first := newClient(t)
	if _, _, err := s.Publish(ctx, roomID, first.offerVideo(t)); err != nil {
		t.Fatalf("first Publish: %v", err)
	}

	second := newClient(t)
	if _, _, err := s.Publish(ctx, roomID, second.offerVideo(t)); !errors.Is(err, ErrAlreadyPublishing) {
		t.Fatalf("a second publisher was accepted: %v", err)
	}
}

// A publisher whose phone drops must be able to reconnect INTO THE SAME
// SERVICE. If the room ended with the connection, a ten-second signal loss
// would eject the whole congregation.
func TestAPublisherCanReconnectWithoutEndingTheService(t *testing.T) {
	s := testSFU(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	roomID, err := s.OpenRoom(ctx, "session-3", "broadcast")
	if err != nil {
		t.Fatalf("OpenRoom: %v", err)
	}

	first := newClient(t)
	_, release, err := s.Publish(ctx, roomID, first.offerVideo(t))
	if err != nil {
		t.Fatalf("first Publish: %v", err)
	}
	release() // the phone dropped

	room, err := s.Room(roomID)
	if err != nil {
		t.Fatalf("the room ended when its publisher dropped: %v", err)
	}
	if room.Publishing() {
		t.Fatal("the publisher slot was not released")
	}

	again := newClient(t)
	if _, _, err := s.Publish(ctx, roomID, again.offerVideo(t)); err != nil {
		t.Fatalf("could not reconnect into the same service: %v", err)
	}
}

// Reopening must not disconnect a congregation that is already watching — a
// start request retried after a timeout is an ordinary event.
func TestOpeningTheSameRoomTwiceKeepsIt(t *testing.T) {
	s := testSFU(t)
	ctx := context.Background()

	first, err := s.OpenRoom(ctx, "session-4", "broadcast")
	if err != nil {
		t.Fatalf("OpenRoom: %v", err)
	}
	roomBefore, _ := s.Room(first)

	second, err := s.OpenRoom(ctx, "session-4", "broadcast")
	if err != nil {
		t.Fatalf("second OpenRoom: %v", err)
	}
	roomAfter, _ := s.Room(second)

	if roomBefore != roomAfter {
		t.Fatal("reopening replaced the room, disconnecting everyone in it")
	}
	if s.Rooms() != 1 {
		t.Fatalf("rooms = %d, want 1", s.Rooms())
	}
}

// Ending a service that is not running here must SUCCEED. The database is the
// truth about a service ending, and this process may have restarted since it
// started — refusing would leave a church unable to close its own service.
func TestClosingAnUnknownRoomSucceeds(t *testing.T) {
	s := testSFU(t)
	if err := s.CloseRoom(context.Background(), "never-existed"); err != nil {
		t.Fatalf("CloseRoom on an unknown room: %v", err)
	}
}

func TestClosedRoomsAreGone(t *testing.T) {
	s := testSFU(t)
	ctx := context.Background()
	roomID, err := s.OpenRoom(ctx, "session-5", "broadcast")
	if err != nil {
		t.Fatalf("OpenRoom: %v", err)
	}
	if err := s.CloseRoom(ctx, roomID); err != nil {
		t.Fatalf("CloseRoom: %v", err)
	}
	if _, err := s.Room(roomID); !errors.Is(err, ErrRoomNotFound) {
		t.Fatalf("a closed room is still reachable: %v", err)
	}
}

// Without TURN, most of a Ghanaian congregation on mobile data never connects.
// Startup depends on this answer to decide whether to warn.
func TestHasRelayDetectsTURN(t *testing.T) {
	cases := []struct {
		name string
		urls []string
		want bool
	}{
		{name: "stun only", urls: []string{"stun:stun.example.org:19302"}},
		{name: "turn", urls: []string{"turn:relay.example.org:3478"}, want: true},
		{name: "turns", urls: []string{"turns:relay.example.org:5349"}, want: true},
		{name: "both", urls: []string{
			"stun:stun.example.org:19302", "turn:relay.example.org:3478"}, want: true},
		{name: "none"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, err := New(Config{ICEServers: []webrtc.ICEServer{{URLs: tc.urls}}})
			if err != nil {
				t.Fatalf("New: %v", err)
			}
			if got := s.HasRelay(); got != tc.want {
				t.Fatalf("HasRelay() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestOpenRoomNeedsASessionID(t *testing.T) {
	s := testSFU(t)
	if _, err := s.OpenRoom(context.Background(), "  ", "broadcast"); err == nil {
		t.Fatal("opened a room with no session id")
	}
}

// waitForTracks blocks until the room has the expected number of tracks.
func waitForTracks(t *testing.T, s *SFU, roomID string, want int) {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		room, err := s.Room(roomID)
		if err == nil && len(room.currentTracks()) >= want {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("the publisher's track never reached the room")
}

// sampleFrame is one unit of fake video.
//
// The CONTENT does not matter — the SFU forwards bytes without decoding them,
// which is exactly what makes it cheap enough to run many services at once. A
// real VP8 frame would test libvpx, not this package.
func sampleFrame() mediapkg.Sample {
	return mediapkg.Sample{
		Data:     []byte{0x10, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05},
		Duration: 20 * time.Millisecond,
	}
}
