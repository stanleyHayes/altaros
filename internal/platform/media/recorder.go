package media

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media/ivfwriter"
	"github.com/pion/webrtc/v4/pkg/media/oggwriter"
)

// Recording writes a service to disk as it is broadcast.
//
// Two files, not one: IVF for the video and Ogg for the audio, because that is
// what can be written from RTP without decoding anything. Muxing them into a
// single playable container is a job for ffmpeg after the service, and doing it
// here would mean decoding and re-encoding live — which is the difference
// between a server that carries many services and one that carries two.
//
// Writing happens on the forwarding path, so it must never block it. Every
// write error is recorded and the packet is dropped: a full disk must degrade
// into a lost recording, never into a service that stops for the congregation
// watching it.

// Recorder writes one room's media.
type Recorder struct {
	dir  string
	base string

	mu       sync.Mutex
	video    *ivfwriter.IVFWriter
	audio    *oggwriter.OggWriter
	failed   error
	closed   bool
	written  int64
	sawVideo bool
	sawAudio bool
}

// ErrNoRecordingDir means recording was asked for without somewhere to put it.
var ErrNoRecordingDir = errors.New("media: no recording directory is configured")

// NewRecorder opens a recorder for a room.
//
// The id is used as a filename, so it is sanitised rather than trusted: a room
// id is an ObjectId today, and a path separator arriving in one later would
// write a church's service wherever the string pointed.
func NewRecorder(dir, roomID string) (*Recorder, error) {
	if strings.TrimSpace(dir) == "" {
		return nil, ErrNoRecordingDir
	}
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, fmt.Errorf("media: create recording directory: %w", err)
	}
	return &Recorder{dir: dir, base: safeName(roomID)}, nil
}

// safeName strips anything that could leave the recording directory.
func safeName(id string) string {
	cleaned := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			return r
		case r == '-', r == '_':
			return r
		default:
			return -1
		}
	}, id)
	if cleaned == "" {
		return "recording"
	}
	return cleaned
}

// Paths are where this recording's files live.
func (r *Recorder) Paths() (video, audio string) {
	return filepath.Join(r.dir, r.base+".ivf"), filepath.Join(r.dir, r.base+".ogg")
}

// Write records one RTP packet.
//
// Never returns an error. A recording problem is recorded on the Recorder and
// surfaced at Close, because this is called from the packet-forwarding path
// and a broadcast must not stop because a disk filled up.
func (r *Recorder) Write(codec webrtc.RTPCodecParameters, packet *rtp.Packet) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed || r.failed != nil {
		return
	}

	mime := strings.ToLower(codec.MimeType)
	switch {
	case strings.HasPrefix(mime, "video/"):
		if r.video == nil {
			// VP8 only. H.264 in IVF is not a thing, and writing it anyway
			// produces a file that looks fine until someone tries to play it.
			if !strings.EqualFold(codec.MimeType, webrtc.MimeTypeVP8) {
				r.failed = fmt.Errorf("media: cannot record %s video", codec.MimeType)
				return
			}
			w, err := ivfwriter.New(filepath.Join(r.dir, r.base+".ivf"))
			if err != nil {
				r.failed = err
				return
			}
			r.video, r.sawVideo = w, true
		}
		if err := r.video.WriteRTP(packet); err != nil {
			r.failed = err
		}

	case strings.HasPrefix(mime, "audio/"):
		if r.audio == nil {
			if !strings.EqualFold(codec.MimeType, webrtc.MimeTypeOpus) {
				r.failed = fmt.Errorf("media: cannot record %s audio", codec.MimeType)
				return
			}
			w, err := oggwriter.New(filepath.Join(r.dir, r.base+".ogg"),
				codec.ClockRate, codec.Channels)
			if err != nil {
				r.failed = err
				return
			}
			r.audio, r.sawAudio = w, true
		}
		if err := r.audio.WriteRTP(packet); err != nil {
			r.failed = err
		}
	default:
		return
	}
	r.written += int64(packet.MarshalSize())
}

// Close finishes the files and reports what happened.
//
// Idempotent: a service can end through the pastor pressing stop, the publisher
// disconnecting, and the room closing, and all three legitimately arrive.
func (r *Recorder) Close() (bytes int64, err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return r.written, r.failed
	}
	r.closed = true

	if r.video != nil {
		if cerr := r.video.Close(); cerr != nil && r.failed == nil {
			r.failed = cerr
		}
	}
	if r.audio != nil {
		if cerr := r.audio.Close(); cerr != nil && r.failed == nil {
			r.failed = cerr
		}
	}
	if r.failed == nil && !r.sawVideo && !r.sawAudio {
		// A recording with no media in it. Reported as a failure so the church
		// is told the service was not captured, rather than left with an empty
		// file and the belief that it was.
		r.failed = errors.New("media: nothing was recorded — no media arrived")
	}
	return r.written, r.failed
}

// Remove deletes this recording's files.
//
// A missing file is NOT an error: retention must succeed against a recording
// whose files were already removed by hand, or the sweeper stops on the first
// one and every recording behind it outlives its expiry.
func (r *Recorder) Remove() error { return RemoveRecording(r.dir, r.base) }

// RemoveRecording erases the files of a recording by path.
func RemoveRecording(dir, base string) error {
	var firstErr error
	for _, ext := range []string{".ivf", ".ogg"} {
		if err := os.Remove(filepath.Join(dir, safeName(base)+ext)); err != nil &&
			!errors.Is(err, os.ErrNotExist) && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}
