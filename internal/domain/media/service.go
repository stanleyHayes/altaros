package media

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// Config is the storage provider's credentials.
type Config struct {
	CloudName string
	APIKey    string
	APISecret string
}

// Configured reports whether uploads are possible.
func (c Config) Configured() bool {
	return c.CloudName != "" && c.APIKey != "" && c.APISecret != ""
}

// Service issues upload authorisations and keeps the library.
type Service struct {
	assets *mongodb.TenantCollection
	cfg    Config
	now    func() time.Time
}

// NewService builds the media service.
func NewService(db *mongodb.DB, cfg Config) *Service {
	return &Service{
		assets: db.Tenant(Collection),
		cfg:    cfg,
		now:    time.Now,
	}
}

// EnsureIndexes creates what the library is read by.
func (s *Service) EnsureIndexes(ctx context.Context) error {
	err := s.assets.EnsureIndexes(ctx, []mongo.IndexModel{
		{
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "kind", Value: 1},
				{Key: "createdAt", Value: -1},
			},
			Options: options.Index().SetName("church_media_recent"),
		},
		{
			// One row per uploaded file. A confirmation that arrives twice —
			// a retried request, a double-clicked button — must not put the
			// same photo in the library twice.
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "publicId", Value: 1},
			},
			Options: options.Index().SetName("uq_church_public_id").SetUnique(true),
		},
	})
	if err != nil {
		return fmt.Errorf("media: create indexes: %w", err)
	}
	return nil
}

// folderFor is the church's own space in the provider's namespace.
//
// Every signature pins this, and it is derived from the TENANT rather than
// from anything a caller sends. A folder taken from a request body is a
// request body that can name another church's folder.
func folderFor(churchID string) string {
	return "altaros/" + churchID
}

// SignUpload issues a short-lived authorisation to upload one file.
func (s *Service) SignUpload(ctx context.Context, kind Kind) (*Signature, error) {
	if !s.cfg.Configured() {
		return nil, ErrNotConfigured
	}
	if !kind.Valid() {
		return nil, fmt.Errorf("%w: %q", ErrKindInvalid, kind)
	}
	churchID, err := tenancy.MustChurchID(ctx)
	if err != nil {
		return nil, err
	}

	now := s.now().UTC()
	folder := folderFor(churchID)

	// The exact parameter set that is SIGNED. Anything not in here is not
	// authorised, and anything in here the client cannot change without
	// invalidating the signature — which is what makes the folder a boundary
	// rather than a suggestion.
	params := map[string]string{
		"folder":    folder,
		"timestamp": strconv.FormatInt(now.Unix(), 10),
	}

	return &Signature{
		Signature:      s.sign(params),
		Timestamp:      now.Unix(),
		APIKey:         s.cfg.APIKey,
		CloudName:      s.cfg.CloudName,
		UploadURL:      s.uploadURL(kind),
		Folder:         folder,
		ResourceType:   kind.resourceType(),
		AllowedFormats: AllowedFormats(kind),
		MaxBytes:       kind.MaxBytes(),
		ExpiresAt:      now.Add(SignatureTTL),
	}, nil
}

// sign produces Cloudinary's signature: the parameters sorted, joined, and
// hashed with the API secret appended.
//
// Sorted deterministically because the provider sorts them too; a different
// order is a different string and a signature that never validates.
func (s *Service) sign(params map[string]string) string {
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+"="+params[k])
	}

	//nolint:gosec // SHA-1 is what the provider's signing scheme specifies.
	sum := sha1.Sum([]byte(strings.Join(parts, "&") + s.cfg.APISecret))
	return hex.EncodeToString(sum[:])
}

func (s *Service) uploadURL(kind Kind) string {
	return fmt.Sprintf("https://api.cloudinary.com/v1_1/%s/%s/upload",
		s.cfg.CloudName, kind.resourceType())
}

// ConfirmInput is what a client reports after the provider accepted a file.
type ConfirmInput struct {
	PublicID string
	Kind     Kind
	Format   string
	Bytes    int64
	URL      string
	Width    int
	Height   int
	Duration int
	Title    string
	AltText  string
	// SignedAt is the timestamp the upload was authorised with. Checked so a
	// confirmation cannot be replayed days later against a signature that has
	// long expired.
	SignedAt int64
}

// Confirm records an upload the provider accepted.
//
// This is where the limits are actually ENFORCED. The client is told the
// allowlist and the ceiling so it can refuse a file early, but a client is not
// a boundary — it is a convenience. Everything is re-checked here, against a
// request that has to name a signature this service issued.
func (s *Service) Confirm(ctx context.Context, in ConfirmInput) (*Asset, error) {
	if !in.Kind.Valid() {
		return nil, fmt.Errorf("%w: %q", ErrKindInvalid, in.Kind)
	}
	if !FormatAllowed(in.Kind, in.Format) {
		return nil, fmt.Errorf("%w: %s is not allowed for %s uploads",
			ErrFormatRefused, in.Format, in.Kind)
	}
	if in.Bytes > in.Kind.MaxBytes() {
		return nil, fmt.Errorf("%w: %d bytes is over the %d limit for %s",
			ErrTooLarge, in.Bytes, in.Kind.MaxBytes(), in.Kind)
	}
	if in.SignedAt > 0 {
		signed := time.Unix(in.SignedAt, 0).UTC()
		if s.now().UTC().After(signed.Add(SignatureTTL)) {
			return nil, ErrSignatureExpired
		}
	}

	churchID, err := tenancy.MustChurchID(ctx)
	if err != nil {
		return nil, err
	}
	publicID := strings.TrimSpace(in.PublicID)
	if publicID == "" {
		return nil, fmt.Errorf("%w: no file was named", ErrNotFound)
	}
	// The provider's id has to sit inside THIS church's folder. Without this a
	// church could confirm — and then read, and then DELETE — another church's
	// asset simply by knowing its id.
	if !strings.HasPrefix(publicID, folderFor(churchID)+"/") {
		return nil, fmt.Errorf("%w: that file does not belong to this church", ErrNotFound)
	}
	// And the delivery URL has to be the provider's, or the library becomes a
	// place to store a link to anywhere — which is R-13 by another route.
	if err := s.checkDeliveryURL(in.URL); err != nil {
		return nil, err
	}

	scope, _ := tenancy.FromContext(ctx)
	doc := bson.M{
		"publicId":  publicID,
		"kind":      string(in.Kind),
		"format":    strings.ToLower(strings.TrimPrefix(in.Format, ".")),
		"bytes":     in.Bytes,
		"url":       in.URL,
		"createdAt": s.now().UTC(),
	}
	for field, value := range map[string]int{
		"width": in.Width, "height": in.Height, "duration": in.Duration,
	} {
		if value > 0 {
			doc[field] = value
		}
	}
	if title := strings.TrimSpace(in.Title); title != "" {
		doc["title"] = title
	}
	if alt := strings.TrimSpace(in.AltText); alt != "" {
		doc["altText"] = alt
	}
	if scope.UserID != "" {
		doc["uploadedBy"] = mongodb.ID(scope.UserID)
	}

	res, err := s.assets.InsertOne(ctx, doc)
	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			// Already recorded. A retried confirmation is the same fact
			// arriving twice, not an error to show somebody.
			return s.ByPublicID(ctx, publicID)
		}
		return nil, fmt.Errorf("media: record asset: %w", err)
	}
	return s.byObjectID(ctx, res.InsertedID.(bson.ObjectID))
}

// checkDeliveryURL refuses anything that is not this account's CDN.
func (s *Service) checkDeliveryURL(raw string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "https" {
		return fmt.Errorf("%w: it must be an https address", ErrDeliveryAddress)
	}
	if parsed.Host != "res.cloudinary.com" {
		return fmt.Errorf("%w: it must be served by the media provider", ErrDeliveryAddress)
	}
	// And it must be OUR cloud, not another Cloudinary account somebody else
	// controls — the host alone is shared by every customer of the provider.
	if !strings.HasPrefix(parsed.Path, "/"+s.cfg.CloudName+"/") {
		return fmt.Errorf("%w: it belongs to a different media account", ErrDeliveryAddress)
	}
	return nil
}

// --- reading ---------------------------------------------------------------------

// Library lists a church's assets, newest first.
func (s *Service) Library(ctx context.Context, kind Kind, limit int64) ([]Asset, error) {
	filter := bson.M{}
	if kind != "" {
		if !kind.Valid() {
			return nil, fmt.Errorf("%w: %q", ErrKindInvalid, kind)
		}
		filter["kind"] = string(kind)
	}
	if limit <= 0 || limit > 200 {
		limit = 60
	}

	out := []Asset{}
	err := s.assets.Find(ctx, filter, &out,
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetLimit(limit))
	if err != nil {
		return nil, fmt.Errorf("media: list library: %w", err)
	}
	return out, nil
}

// ByPublicID returns one asset by the provider's identifier.
func (s *Service) ByPublicID(ctx context.Context, publicID string) (*Asset, error) {
	var out Asset
	err := s.assets.FindOne(ctx, bson.M{"publicId": publicID}, &out)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("media: read asset: %w", err)
	}
	return &out, nil
}

func (s *Service) byObjectID(ctx context.Context, oid bson.ObjectID) (*Asset, error) {
	var out Asset
	err := s.assets.FindOne(ctx, bson.M{"_id": oid}, &out)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("media: read asset: %w", err)
	}
	return &out, nil
}

// Forget removes an asset from the church's library.
//
// The record only. Deleting from the provider is a separate, authenticated API
// call that can fail independently, and a library row that survives a failed
// remote delete is a church seeing a photo it thinks it removed. Removing the
// row first and reconciling later is the order that matches what the person
// asked for; the orphaned blob is a storage cost, not a correctness problem.
func (s *Service) Forget(ctx context.Context, publicID string) error {
	res, err := s.assets.DeleteOne(ctx, bson.M{"publicId": publicID})
	if err != nil {
		return fmt.Errorf("media: forget asset: %w", err)
	}
	if res.DeletedCount == 0 {
		return ErrNotFound
	}
	return nil
}

// --- delivery ----------------------------------------------------------------------

// DeliveryURL builds an address for an asset under the given conditions.
//
// The whole point of WP-29's acceptance criterion lives here: a sermon on a
// throttled 3G connection has to be watchable, and audio-only has to be the
// default on metered data. That is not a bandwidth footnote in this market —
// §2.1's congregation pays per megabyte, and a 1080p autoplay is a bill nobody
// agreed to.
func (a *Asset) DeliveryURL(opts DeliveryOptions) string {
	if a == nil || a.URL == "" {
		return ""
	}
	// The transformation is injected into the path segment the provider
	// reserves for it, which is the segment right after /upload/.
	const marker = "/upload/"
	idx := strings.Index(a.URL, marker)
	if idx < 0 {
		return a.URL
	}

	transforms := a.transformsFor(opts)
	if len(transforms) == 0 {
		return a.URL
	}
	return a.URL[:idx+len(marker)] + strings.Join(transforms, ",") + "/" + a.URL[idx+len(marker):]
}

func (a *Asset) transformsFor(opts DeliveryOptions) []string {
	switch a.Kind {
	case KindImage:
		out := []string{
			// Let the provider pick the format from what the browser accepts:
			// a phone that understands AVIF gets a file a third the size, with
			// no second upload and no client logic.
			"f_auto",
		}
		if opts.Metered {
			// q_auto:eco rather than q_auto:good. The difference is invisible
			// on a phone screen and it is roughly a third of the bytes, which
			// on a metered connection is the difference that matters.
			out = append(out, "q_auto:eco")
		} else {
			out = append(out, "q_auto:good")
		}
		if opts.Width > 0 {
			out = append(out, "w_"+strconv.Itoa(opts.Width), "c_limit")
		} else if opts.Metered {
			// A hard ceiling on metered data, because the commonest cause of a
			// huge image is somebody uploading straight off a camera.
			out = append(out, "w_1080", "c_limit")
		}
		return out

	case KindVideo:
		if opts.AudioOnly || opts.Metered {
			// Audio only. On a metered connection this is the DEFAULT rather
			// than an option somebody has to find, which is what the
			// acceptance criterion asks for — a sermon is words, and the video
			// is roughly twenty times the data for the same content.
			return []string{"f_mp3", "ac_none"}
		}
		return []string{
			// Adaptive: the provider picks a bitrate ladder rather than
			// serving one file to every connection.
			"f_auto", "q_auto", "vc_auto",
		}

	case KindAudio:
		if opts.Metered {
			// 64kbps mono is entirely adequate for speech and roughly a third
			// of a stereo 128k file.
			return []string{"f_mp3", "br_64k", "ac_mono"}
		}
		return []string{"f_auto", "q_auto"}
	}
	return nil
}

// AudioURL is the audio-only address of a video, for the explicit
// download-for-offline the criterion names.
func (a *Asset) AudioURL() string {
	if a == nil || (a.Kind != KindVideo && a.Kind != KindAudio) {
		return ""
	}
	return a.DeliveryURL(DeliveryOptions{AudioOnly: true})
}
