package media

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

func vp8Codec() webrtc.RTPCodecParameters {
	return webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType: webrtc.MimeTypeVP8, ClockRate: 90000,
		},
	}
}

func opusCodec() webrtc.RTPCodecParameters {
	return webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2,
		},
	}
}

func videoPacket(seq uint16) *rtp.Packet {
	return &rtp.Packet{
		Header:  rtp.Header{Version: 2, SequenceNumber: seq, Timestamp: uint32(seq) * 3000, SSRC: 1},
		Payload: []byte{0x10, 0x00, 0x00, 0x01, 0x02, 0x03},
	}
}

func TestRecorderWritesAPlayableFile(t *testing.T) {
	dir := t.TempDir()
	rec, err := NewRecorder(dir, "session-abc")
	if err != nil {
		t.Fatalf("NewRecorder: %v", err)
	}
	for i := 0; i < 30; i++ {
		rec.Write(vp8Codec(), videoPacket(uint16(i)))
	}
	bytes, err := rec.Close()
	if err != nil {
		t.Fatalf("Close: %v", err)
	}
	if bytes == 0 {
		t.Fatal("recorded zero bytes")
	}

	video, _ := rec.Paths()
	info, err := os.Stat(video)
	if err != nil {
		t.Fatalf("no video file was written: %v", err)
	}
	if info.Size() == 0 {
		t.Fatal("the video file is empty")
	}
}

// A church told a service was being recorded is owed the truth when it was
// not. An empty file plus a success is the one outcome nobody can act on.
func TestRecorderReportsWhenNothingArrived(t *testing.T) {
	rec, err := NewRecorder(t.TempDir(), "silent")
	if err != nil {
		t.Fatalf("NewRecorder: %v", err)
	}
	if _, err := rec.Close(); err == nil {
		t.Fatal("a recording with no media reported success")
	}
}

// A service ends through the pastor pressing stop, the publisher dropping, and
// the room closing — all three legitimately arrive.
func TestRecorderCloseIsIdempotent(t *testing.T) {
	rec, err := NewRecorder(t.TempDir(), "twice")
	if err != nil {
		t.Fatalf("NewRecorder: %v", err)
	}
	rec.Write(vp8Codec(), videoPacket(1))

	first, firstErr := rec.Close()
	second, secondErr := rec.Close()
	if first != second {
		t.Fatalf("byte counts disagree: %d then %d", first, second)
	}
	if (firstErr == nil) != (secondErr == nil) {
		t.Fatalf("verdicts disagree: %v then %v", firstErr, secondErr)
	}
}

// A codec we cannot write must FAIL rather than produce a file that looks
// fine until somebody tries to play it.
func TestRecorderRefusesACodecItCannotWrite(t *testing.T) {
	rec, err := NewRecorder(t.TempDir(), "h264")
	if err != nil {
		t.Fatalf("NewRecorder: %v", err)
	}
	rec.Write(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType: webrtc.MimeTypeH264, ClockRate: 90000,
		},
	}, videoPacket(1))

	if _, err := rec.Close(); err == nil {
		t.Fatal("an unwritable codec reported success")
	}
}

// A room id is an ObjectId today. If one ever carried a path separator, an
// unsanitised name would write a church's service wherever the string pointed.
func TestRecorderCannotEscapeItsDirectory(t *testing.T) {
	dir := t.TempDir()
	rec, err := NewRecorder(dir, "../../etc/passwd")
	if err != nil {
		t.Fatalf("NewRecorder: %v", err)
	}
	video, audio := rec.Paths()
	for _, path := range []string{video, audio} {
		if !strings.HasPrefix(filepath.Clean(path), filepath.Clean(dir)) {
			t.Fatalf("recording path escaped its directory: %s", path)
		}
		if strings.Contains(path, "..") {
			t.Fatalf("recording path still carries a traversal: %s", path)
		}
	}
}

func TestRecorderNeedsADirectory(t *testing.T) {
	if _, err := NewRecorder("  ", "session"); err == nil {
		t.Fatal("built a recorder with nowhere to write")
	}
}

// Retention must succeed against a recording whose files are already gone, or
// the sweeper stops on the first one and everything behind it outlives its
// expiry.
func TestRemovingAnAlreadyGoneRecordingSucceeds(t *testing.T) {
	if err := RemoveRecording(t.TempDir(), "never-written"); err != nil {
		t.Fatalf("removing an absent recording failed: %v", err)
	}
}

func TestRemoveRecordingErasesBothFiles(t *testing.T) {
	dir := t.TempDir()
	rec, err := NewRecorder(dir, "erase-me")
	if err != nil {
		t.Fatalf("NewRecorder: %v", err)
	}
	rec.Write(vp8Codec(), videoPacket(1))
	rec.Write(opusCodec(), &rtp.Packet{
		Header:  rtp.Header{Version: 2, SequenceNumber: 1, SSRC: 2},
		Payload: []byte{0xf8, 0xff, 0xfe},
	})
	if _, err := rec.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	video, audio := rec.Paths()
	for _, path := range []string{video, audio} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("expected %s to exist before erasure: %v", path, err)
		}
	}
	if err := rec.Remove(); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	for _, path := range []string{video, audio} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("%s survived erasure", path)
		}
	}
}
