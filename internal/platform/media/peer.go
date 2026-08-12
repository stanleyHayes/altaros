package media

import (
	"context"
	"fmt"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"
)

// Publish attaches a publisher to a room and returns the answer to its offer.
//
// The publisher sends; it never receives. A pastor's phone uploading one stream
// and downloading nothing is the whole point of an SFU, and asking it to also
// receive the mixed output would put the mesh problem back.
func (s *SFU) Publish(ctx context.Context, roomID string, offer webrtc.SessionDescription) (*webrtc.SessionDescription, func(), error) {
	room, err := s.Room(roomID)
	if err != nil {
		return nil, nil, err
	}

	pc, err := s.api.NewPeerConnection(webrtc.Configuration{ICEServers: s.cfg.ICEServers})
	if err != nil {
		return nil, nil, fmt.Errorf("media: publisher connection: %w", err)
	}
	if err := room.setPublisher(pc); err != nil {
		_ = pc.Close()
		return nil, nil, err
	}

	// Receive-only transceivers, declared BEFORE SetRemoteDescription so the
	// answer offers to receive both. Without them a publisher that offers
	// video gets an answer that does not accept it, and the church sees a
	// connected call with no picture.
	for _, kind := range []webrtc.RTPCodecType{
		webrtc.RTPCodecTypeAudio, webrtc.RTPCodecTypeVideo,
	} {
		if _, err := pc.AddTransceiverFromKind(kind,
			webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionRecvonly},
		); err != nil {
			_ = pc.Close()
			room.clearPublisher(pc)
			return nil, nil, fmt.Errorf("media: publisher transceiver: %w", err)
		}
	}

	pc.OnTrack(func(remote *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		local, err := room.addTrack(remote)
		if err != nil {
			s.log.Warn("could not accept publisher track",
				"room", roomID, "error", err)
			return
		}
		// Keyframes on a timer, for the benefit of whoever joins next. A
		// viewer arriving between keyframes has a black screen until the
		// encoder produces one, and encoders left alone can take a long time.
		go s.requestKeyframes(pc, remote)
		room.forward(remote, local)
	})

	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		switch state {
		case webrtc.PeerConnectionStateFailed,
			webrtc.PeerConnectionStateClosed,
			webrtc.PeerConnectionStateDisconnected:
			// The publisher is released but the ROOM stays open. A pastor
			// whose phone drops for ten seconds must be able to reconnect
			// into the same service rather than find it ended and every
			// viewer ejected.
			room.clearPublisher(pc)
		}
	})

	answer, err := s.negotiate(ctx, pc, offer)
	if err != nil {
		_ = pc.Close()
		room.clearPublisher(pc)
		return nil, nil, err
	}

	release := func() {
		room.clearPublisher(pc)
		_ = pc.Close()
	}
	return answer, release, nil
}

// Watch attaches a viewer to a room and returns the answer to its offer.
func (s *SFU) Watch(ctx context.Context, roomID, viewerID string, offer webrtc.SessionDescription) (*webrtc.SessionDescription, func(), error) {
	room, err := s.Room(roomID)
	if err != nil {
		return nil, nil, err
	}

	pc, err := s.api.NewPeerConnection(webrtc.Configuration{ICEServers: s.cfg.ICEServers})
	if err != nil {
		return nil, nil, fmt.Errorf("media: viewer connection: %w", err)
	}

	v := &viewer{id: viewerID, pc: pc, senders: map[string]*webrtc.RTPSender{}}
	if err := room.addViewer(v); err != nil {
		_ = pc.Close()
		return nil, nil, err
	}

	for _, track := range room.currentTracks() {
		sender, err := pc.AddTrack(track)
		if err != nil {
			room.removeViewer(viewerID, v)
			return nil, nil, fmt.Errorf("media: attach track: %w", err)
		}
		v.senders[track.ID()] = sender
		go readRTCP(sender)
	}

	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		switch state {
		case webrtc.PeerConnectionStateFailed,
			webrtc.PeerConnectionStateClosed,
			webrtc.PeerConnectionStateDisconnected:
			room.removeViewer(viewerID, v)
		}
	})

	answer, err := s.negotiate(ctx, pc, offer)
	if err != nil {
		room.removeViewer(viewerID, v)
		return nil, nil, err
	}
	return answer, func() { room.removeViewer(viewerID, v) }, nil
}

// negotiate completes the offer/answer exchange.
//
// It waits for ICE gathering to finish and returns the COMPLETE local
// description, rather than trickling candidates. Trickle is faster to first
// frame, and this is the version that works over a plain request/response
// signalling exchange without a candidate channel — worth the extra second on
// a first connect, and the thing to revisit when connect time is the
// complaint.
func (s *SFU) negotiate(ctx context.Context, pc *webrtc.PeerConnection, offer webrtc.SessionDescription) (*webrtc.SessionDescription, error) {
	if err := pc.SetRemoteDescription(offer); err != nil {
		return nil, fmt.Errorf("media: remote description: %w", err)
	}
	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		return nil, fmt.Errorf("media: create answer: %w", err)
	}

	gathered := webrtc.GatheringCompletePromise(pc)
	if err := pc.SetLocalDescription(answer); err != nil {
		return nil, fmt.Errorf("media: local description: %w", err)
	}

	// Bounded. A gather that never completes — a blocked STUN port, a network
	// that swallows the responses — would otherwise hold the request open
	// until the client gave up, with no answer and no explanation.
	select {
	case <-gathered:
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(gatherTimeout):
		return nil, fmt.Errorf("media: gathering candidates timed out after %s", gatherTimeout)
	}

	return pc.LocalDescription(), nil
}

// gatherTimeout bounds ICE gathering.
const gatherTimeout = 10 * time.Second

// requestKeyframes periodically asks the publisher for a fresh keyframe.
func (s *SFU) requestKeyframes(pc *webrtc.PeerConnection, remote *webrtc.TrackRemote) {
	if remote.Kind() != webrtc.RTPCodecTypeVideo {
		return
	}
	ticker := time.NewTicker(keyframeInterval)
	defer ticker.Stop()
	for range ticker.C {
		if pc.ConnectionState() != webrtc.PeerConnectionStateConnected {
			return
		}
		if err := pc.WriteRTCP([]rtcp.Packet{
			&rtcp.PictureLossIndication{MediaSSRC: uint32(remote.SSRC())},
		}); err != nil {
			return
		}
	}
}
