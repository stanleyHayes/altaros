package media

import (
	"errors"
	"strings"
	"testing"
)

// The two things this package is responsible for, and both are the kind that
// fail quietly:
//
//   - A signature is a capability. An unconstrained one is an open upload
//     endpoint on somebody else's CDN, billed to us.
//   - A sermon on a metered Ghanaian connection is a bill somebody did not
//     agree to, which is the acceptance criterion rather than a nicety.

func TestSVGIsNotAnImage(t *testing.T) {
	// It is a document that can carry script, and serving one from a church's
	// own media library is R-13 with extra steps — an XSS vector aimed at the
	// audience most likely to trust the page.
	for _, format := range []string{"svg", "SVG", ".svg", "html", "htm", "xml", "js"} {
		if FormatAllowed(KindImage, format) {
			t.Errorf("%q was accepted as an image", format)
		}
	}
	// And the formats a church actually uploads still work.
	for _, format := range []string{"jpg", "JPEG", ".png", "webp", "heic"} {
		if !FormatAllowed(KindImage, format) {
			t.Errorf("%q was refused as an image", format)
		}
	}
}

func TestAFormatIsOnlyAllowedForItsOwnKind(t *testing.T) {
	// An allowlist that ignored the kind would let a video be uploaded as a
	// document and skip the video ceiling entirely.
	if FormatAllowed(KindDocument, "mp4") {
		t.Error("a video was accepted as a document")
	}
	if FormatAllowed(KindImage, "pdf") {
		t.Error("a PDF was accepted as an image")
	}
	if FormatAllowed(KindAudio, "jpg") {
		t.Error("an image was accepted as audio")
	}
}

func TestCeilingsDifferByKind(t *testing.T) {
	// One shared limit would be either useless for sermons or hostile to
	// photos.
	if KindVideo.MaxBytes() <= KindImage.MaxBytes() {
		t.Error("a sermon is not allowed to be larger than a photo")
	}
	if KindImage.MaxBytes() > 50<<20 {
		t.Errorf("the image ceiling is %d bytes, which is not a photo",
			KindImage.MaxBytes())
	}
}

func TestASignaturePinsTheChurchsOwnFolder(t *testing.T) {
	// Derived from the TENANT, never from a request. A folder taken from a
	// body is a body that can name another church's folder.
	a := folderFor("church_a")
	b := folderFor("church_b")
	if a == b {
		t.Fatal("two churches share an upload folder")
	}
	if !strings.HasPrefix(a, "altaros/") {
		t.Errorf("folder %q is not namespaced to this platform", a)
	}
}

func TestSigningIsDeterministicAndDependsOnEveryParameter(t *testing.T) {
	svc := &Service{cfg: Config{CloudName: "c", APIKey: "k", APISecret: "secret"}}

	// Enough keys, enough times, that unsorted map iteration cannot pass by
	// luck. Two keys signed twice agree half the time — a test that catches a
	// non-deterministic bug half the time is a flaky test, which is worse than
	// no test: it trains somebody to re-run until it goes green.
	base := map[string]string{
		"folder":    "altaros/church_a",
		"timestamp": "1000",
		"eager":     "f_auto",
		"context":   "church=a",
		"tags":      "sermon",
	}
	first := svc.sign(base)
	for i := 0; i < 50; i++ {
		if svc.sign(base) != first {
			t.Fatal("signing is not deterministic — it depends on map iteration " +
				"order, so uploads would fail at random in production")
		}
	}

	// Changing ANY signed parameter has to change the signature, or that
	// parameter is not actually pinned.
	for _, changed := range []map[string]string{
		{"folder": "altaros/church_b", "timestamp": "1000"},
		{"folder": "altaros/church_a", "timestamp": "1001"},
	} {
		if svc.sign(changed) == first {
			t.Errorf("changing %v did not change the signature", changed)
		}
	}

	// And a different secret must produce a different signature, or the secret
	// is not participating.
	other := &Service{cfg: Config{CloudName: "c", APIKey: "k", APISecret: "different"}}
	if other.sign(base) == first {
		t.Error("the API secret does not affect the signature")
	}
}

func TestADeliveryURLMustBeThisPlatformsMediaAccount(t *testing.T) {
	svc := &Service{cfg: Config{CloudName: "altaros", APIKey: "k", APISecret: "s"}}

	if err := svc.checkDeliveryURL("https://res.cloudinary.com/altaros/image/upload/v1/x.jpg"); err != nil {
		t.Fatalf("our own delivery address was refused: %v", err)
	}

	for _, bad := range []string{
		"http://res.cloudinary.com/altaros/image/upload/x.jpg",       // not https
		"https://evil.example/x.jpg",                                 // not the provider
		"https://res.cloudinary.com/someone-else/image/upload/x.jpg", // another customer
		"javascript:alert(1)",
		"",
	} {
		if err := svc.checkDeliveryURL(bad); err == nil {
			t.Errorf("%q was accepted as a delivery address", bad)
		} else if !errors.Is(err, ErrDeliveryAddress) {
			// Its own error, so the message does not send somebody to check a
			// file extension when the problem is the address.
			t.Errorf("%q was refused as %v, want ErrDeliveryAddress", bad, err)
		}
	}
}

func TestAMeteredConnectionGetsAudioOnlyForASermon(t *testing.T) {
	// The acceptance criterion: "audio-only is offered by default on metered
	// connections". A sermon is words; the video is roughly twenty times the
	// data for the same content, and this market pays per megabyte.
	sermon := &Asset{
		Kind: KindVideo,
		URL:  "https://res.cloudinary.com/altaros/video/upload/v1/sermon.mp4",
	}

	metered := sermon.DeliveryURL(DeliveryOptions{Metered: true})
	if !strings.Contains(metered, "ac_none") {
		t.Errorf("a metered viewer was served video: %s", metered)
	}

	onWifi := sermon.DeliveryURL(DeliveryOptions{})
	if strings.Contains(onWifi, "ac_none") {
		t.Errorf("a viewer on wifi was denied the video: %s", onWifi)
	}
	if !strings.Contains(onWifi, "vc_auto") {
		t.Errorf("no adaptive bitrate was requested: %s", onWifi)
	}

	// And the explicit download-for-offline the criterion names.
	if audio := sermon.AudioURL(); !strings.Contains(audio, "f_mp3") {
		t.Errorf("AudioURL is not audio: %s", audio)
	}
}

func TestAMeteredConnectionGetsASmallerImage(t *testing.T) {
	photo := &Asset{
		Kind: KindImage,
		URL:  "https://res.cloudinary.com/altaros/image/upload/v1/photo.jpg",
	}

	metered := photo.DeliveryURL(DeliveryOptions{Metered: true})
	if !strings.Contains(metered, "q_auto:eco") {
		t.Errorf("a metered viewer was not given the cheaper quality: %s", metered)
	}
	// The commonest cause of a huge image is somebody uploading straight off a
	// camera, so there is a ceiling even when nobody asked for a width.
	if !strings.Contains(metered, "w_1080") {
		t.Errorf("no width ceiling on a metered connection: %s", metered)
	}
	// f_auto is what gets a modern phone a file a third the size, with no
	// second upload and no client logic.
	if !strings.Contains(metered, "f_auto") {
		t.Errorf("format negotiation was not requested: %s", metered)
	}
}

func TestTheTransformationGoesWhereTheProviderExpectsIt(t *testing.T) {
	// Injected into the segment right after /upload/. Anywhere else and the
	// provider serves a 404 or, worse, the original — which would look like it
	// worked while costing full size.
	photo := &Asset{
		Kind: KindImage,
		URL:  "https://res.cloudinary.com/altaros/image/upload/v1234/church/photo.jpg",
	}
	got := photo.DeliveryURL(DeliveryOptions{Width: 400})

	if !strings.HasPrefix(got, "https://res.cloudinary.com/altaros/image/upload/") {
		t.Fatalf("the address was rewritten: %s", got)
	}
	if !strings.HasSuffix(got, "/v1234/church/photo.jpg") {
		t.Fatalf("the file path was lost: %s", got)
	}
	if !strings.Contains(got, "/upload/f_auto,q_auto:good,w_400,c_limit/v1234/") {
		t.Fatalf("the transformation is in the wrong place: %s", got)
	}
}

func TestAnUnknownURLShapeIsLeftAlone(t *testing.T) {
	// Better to serve the original than to build an address that 404s.
	odd := &Asset{Kind: KindImage, URL: "https://example.test/photo.jpg"}
	if got := odd.DeliveryURL(DeliveryOptions{Metered: true}); got != odd.URL {
		t.Errorf("an unrecognised URL was rewritten to %s", got)
	}
}
