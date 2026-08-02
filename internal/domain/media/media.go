// Package media is uploads and delivery (WP-29).
//
// # The file never touches this API
//
// Uploads are SIGNED, not proxied: the server issues a short-lived signature
// and the browser sends the bytes straight to Cloudinary. Three reasons, and
// the third is the one that matters most:
//
//   - A 45-minute sermon through a Go handler is 400MB of memory or a
//     streaming path nobody wants to maintain, on a pod sized for JSON.
//   - A church on Ghanaian mobile data uploading via our servers pays for the
//     round trip twice.
//   - R-13: uploads are deliberately OFF-ORIGIN. A file served from the same
//     origin as the church's site can carry script that runs with the site's
//     privileges, and the audience most likely to trust that page is the
//     congregation.
//
// # What a signature is allowed to permit
//
// A signature is a capability. An unconstrained one is an open upload endpoint
// on somebody else's CDN, billed to us, discoverable by anyone who can read a
// network tab. So every signature pins the folder (the church's own), the
// resource type, and an expiry — and the server records what it authorised, so
// an upload that arrives can be checked against something rather than trusted.
//
// # SVG is not an image here
//
// It is a document that can contain script, and serving one from a church's
// media library is R-13 with extra steps. The allowlist is raster formats plus
// the video and audio the sermon path needs.
package media

import (
	"errors"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// Collection holds a church's media library.
const Collection = "media"

var (
	// ErrNotFound means no such asset in this church.
	ErrNotFound = errors.New("media: not found")
	// ErrNotConfigured means no storage provider is set up.
	ErrNotConfigured = errors.New("media: no storage provider is configured")
	// ErrKindInvalid means an unrecognised kind of upload.
	ErrKindInvalid = errors.New("media: that kind of file is not supported")
	// ErrFormatRefused means the format is not on the allowlist.
	ErrFormatRefused = errors.New("media: that file format is not allowed")
	// ErrDeliveryAddress means the URL is not this platform's media account.
	//
	// Its own error rather than reusing ErrFormatRefused, which produced "that
	// file format is not allowed: that address is not this platform's media
	// account" — a message that sends somebody to check their file extension
	// when the problem is the address.
	ErrDeliveryAddress = errors.New("media: that delivery address is not allowed")
	// ErrTooLarge means the declared size is over the ceiling.
	ErrTooLarge = errors.New("media: that file is too large")
	// ErrSignatureExpired means an upload arrived after its authorisation ran out.
	ErrSignatureExpired = errors.New("media: that upload authorisation has expired")
)

// Kind is what is being uploaded, which decides the limits and the delivery.
type Kind string

const (
	// KindImage is a photo for a page, a logo, a gallery.
	KindImage Kind = "image"
	// KindVideo is a sermon recording.
	KindVideo Kind = "video"
	// KindAudio is a sermon in audio only — the variant that matters most on
	// metered data.
	KindAudio Kind = "audio"
	// KindDocument is a bulletin or a form.
	KindDocument Kind = "document"
)

// Valid reports whether a kind is recognised.
func (k Kind) Valid() bool {
	switch k {
	case KindImage, KindVideo, KindAudio, KindDocument:
		return true
	}
	return false
}

// resourceType maps a kind to Cloudinary's own three-way split.
func (k Kind) resourceType() string {
	switch k {
	case KindVideo, KindAudio:
		return "video"
	case KindDocument:
		return "raw"
	default:
		return "image"
	}
}

// MaxBytes is the ceiling for each kind.
//
// A sermon is genuinely large and a photo genuinely is not, so one shared limit
// would be either useless or hostile. These are ceilings on what a signature
// AUTHORISES, which is the only place a limit can be enforced when the bytes
// never reach this service.
func (k Kind) MaxBytes() int64 {
	const mb = 1 << 20
	switch k {
	case KindVideo:
		return 2048 * mb // a 45-minute recording at a sane bitrate
	case KindAudio:
		return 256 * mb
	case KindDocument:
		return 25 * mb
	default:
		return 15 * mb
	}
}

// allowedFormats is the allowlist per kind.
//
// An ALLOWLIST, not a blocklist. A blocklist is a list of the attacks somebody
// thought of, and the one that matters is always the one they did not.
//
// SVG is absent from the image list on purpose. It is a document that can carry
// script, and serving one from a church's own media library is R-13 with extra
// steps. HTML is absent for the same reason and more obviously.
var allowedFormats = map[Kind][]string{
	KindImage:    {"jpg", "jpeg", "png", "webp", "avif", "gif", "heic"},
	KindVideo:    {"mp4", "mov", "webm", "m4v"},
	KindAudio:    {"mp3", "m4a", "aac", "wav", "ogg"},
	KindDocument: {"pdf", "docx", "pptx", "xlsx"},
}

// FormatAllowed reports whether a format may be uploaded as a kind.
func FormatAllowed(k Kind, format string) bool {
	format = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(format, ".")))
	for _, allowed := range allowedFormats[k] {
		if allowed == format {
			return true
		}
	}
	return false
}

// AllowedFormats returns the allowlist for a kind, for a client to enforce
// before somebody waits through an upload that will be refused.
func AllowedFormats(k Kind) []string {
	out := make([]string, len(allowedFormats[k]))
	copy(out, allowedFormats[k])
	return out
}

// Asset is one uploaded file.
type Asset struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`

	// PublicID is the provider's identifier, and the handle for deletion and
	// for building a delivery URL.
	PublicID string `bson:"publicId" json:"publicId"`
	Kind     Kind   `bson:"kind"     json:"kind"`
	Format   string `bson:"format"   json:"format"`
	Bytes    int64  `bson:"bytes"    json:"bytes"`

	// Title is what a person calls it in the library.
	Title string `bson:"title,omitempty" json:"title,omitempty"`
	// AltText is what a screen reader says and what a crawler indexes. Kept on
	// the ASSET rather than only on the block that uses it, so a photo reused
	// on three pages is described once.
	AltText string `bson:"altText,omitempty" json:"altText,omitempty"`

	Width    int `bson:"width,omitempty"    json:"width,omitempty"`
	Height   int `bson:"height,omitempty"   json:"height,omitempty"`
	Duration int `bson:"duration,omitempty" json:"duration,omitempty"`

	// URL is the canonical delivery address as the provider returned it.
	URL string `bson:"url" json:"url"`

	UploadedBy mongodb.ID `bson:"uploadedBy,omitempty" json:"uploadedBy,omitempty"`
	CreatedAt  time.Time  `bson:"createdAt" json:"createdAt"`
}

// Signature is a short-lived authorisation to upload one file.
type Signature struct {
	// Signature is what the provider checks.
	Signature string `json:"signature"`
	// Timestamp is what it was signed against, and what makes it expire.
	Timestamp int64 `json:"timestamp"`
	// APIKey and CloudName the client needs to address the provider. Public
	// values — the SECRET never leaves this service, which is the whole reason
	// signing happens here.
	APIKey    string `json:"apiKey"`
	CloudName string `json:"cloudName"`
	// UploadURL is where to send the bytes.
	UploadURL string `json:"uploadUrl"`
	// Folder pins the upload into the church's own space. It is part of what
	// was signed, so a client cannot move it.
	Folder string `json:"folder"`
	// ResourceType is the provider's own image/video/raw split.
	ResourceType string `json:"resourceType"`
	// AllowedFormats and MaxBytes are returned so a client can refuse a file
	// before somebody waits through an upload that the provider will reject.
	// They are advisory to the CLIENT and enforced on confirmation here.
	AllowedFormats []string `json:"allowedFormats"`
	MaxBytes       int64    `json:"maxBytes"`
	// ExpiresAt is when this stops working.
	ExpiresAt time.Time `json:"expiresAt"`
}

// SignatureTTL is how long an authorisation lasts.
//
// Ten minutes: long enough to upload a sermon over a slow connection, short
// enough that a signature scraped from a network tab is not a standing licence
// to fill somebody else's CDN account.
const SignatureTTL = 10 * time.Minute

// DeliveryOptions describe how an asset should be fetched.
type DeliveryOptions struct {
	// Metered says the viewer is on mobile data. The single most important
	// input on this platform: §2.1's market is mobile-first and pays per
	// megabyte, so a sermon that autoplays in 1080p is a bill somebody did not
	// agree to.
	Metered bool
	// Width, when non-zero, requests a resized variant.
	Width int
	// AudioOnly forces the audio variant of a video.
	AudioOnly bool
}
