package service

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/media"
	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// buildMedia mounts uploads and the media library (WP-29).
func buildMedia(d *deps.Deps) http.Handler { return standalone(mediaRoutes(d)) }

func newMediaService(d *deps.Deps) *media.Service {
	cfg := media.Config{}
	if d.Config != nil {
		cfg = media.Config{
			CloudName: d.Config.Cloudinary.CloudName,
			APIKey:    d.Config.Cloudinary.APIKey,
			APISecret: d.Config.Cloudinary.APISecret,
		}
	}
	return media.NewService(d.Mongo, cfg)
}

// mediaRoutes registers uploads and the library.
//
// Guarded by `settings` permissions, the same authority as the CMS. Media is
// what appears on a church's public site, so whoever may change the site may
// change what is on it — and nobody else should be able to put a file into the
// church's storage account.
func mediaRoutes(d *deps.Deps) routeSet {
	svc := newMediaService(d)

	return func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(authenticated(d))
			r.Use(resolvePermissions(d))

			// A signature is a CAPABILITY to upload into this church's folder.
			// It is create rather than read for that reason: obtaining one is
			// the act of being allowed to add a file.
			r.With(requirePermission(rbac.ResourceSettings, rbac.ActionCreate)).
				Post("/media/sign", handleSignUpload(svc))
			r.With(requirePermission(rbac.ResourceSettings, rbac.ActionCreate)).
				Post("/media/confirm", handleConfirmUpload(svc))

			r.With(requirePermission(rbac.ResourceSettings, rbac.ActionRead)).
				Get("/media", handleMediaLibrary(svc))
			r.With(requirePermission(rbac.ResourceSettings, rbac.ActionDelete)).
				Delete("/media/*", handleForgetMedia(svc))
		})
	}
}

func handleSignUpload(svc *media.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Kind string `json:"kind"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		sig, err := svc.SignUpload(r.Context(), media.Kind(body.Kind))
		if err != nil {
			writeMediaError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, sig)
	}
}

func handleConfirmUpload(svc *media.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			PublicID string `json:"publicId"`
			Kind     string `json:"kind"`
			Format   string `json:"format"`
			Bytes    int64  `json:"bytes"`
			URL      string `json:"url"`
			Width    int    `json:"width"`
			Height   int    `json:"height"`
			Duration int    `json:"duration"`
			Title    string `json:"title"`
			AltText  string `json:"altText"`
			SignedAt int64  `json:"signedAt"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}

		asset, err := svc.Confirm(r.Context(), media.ConfirmInput{
			PublicID: body.PublicID, Kind: media.Kind(body.Kind),
			Format: body.Format, Bytes: body.Bytes, URL: body.URL,
			Width: body.Width, Height: body.Height, Duration: body.Duration,
			Title: body.Title, AltText: body.AltText, SignedAt: body.SignedAt,
		})
		if err != nil {
			writeMediaError(w, err)
			return
		}
		httpx.JSON(w, http.StatusCreated, mediaView(asset, meteredFrom(r)))
	}
}

// meteredFrom reads whether the caller is on a metered connection.
//
// From the Save-Data header first, which is what a browser sends when the user
// has asked for reduced data — an explicit preference, and the one worth
// honouring above any guess. A query parameter overrides it for clients that
// know better, such as the mobile app reading the OS connection type.
func meteredFrom(r *http.Request) bool {
	if strings.EqualFold(r.Header.Get("Save-Data"), "on") {
		return true
	}
	return r.URL.Query().Get("metered") == "true"
}

// assetView is an asset with the addresses a client should actually fetch.
//
// The delivery URLs are computed HERE rather than left to the client, because
// getting them wrong is silent: a transformation in the wrong place serves the
// original at full size and looks like it worked.
type assetView struct {
	*media.Asset
	// DeliveryURL is the address to use, already adapted to the connection.
	DeliveryURL string `json:"deliveryUrl"`
	// ThumbnailURL is a small variant for a library grid, so browsing the
	// media library does not cost a megabyte per tile.
	ThumbnailURL string `json:"thumbnailUrl,omitempty"`
	// AudioURL is the audio-only variant of a sermon, for the explicit
	// download-for-offline WP-29 asks for.
	AudioURL string `json:"audioUrl,omitempty"`
	// Metered echoes what was assumed, so a client can tell whether it was
	// served the reduced variant.
	Metered bool `json:"metered"`
}

func mediaView(a *media.Asset, metered bool) assetView {
	view := assetView{
		Asset:       a,
		DeliveryURL: a.DeliveryURL(media.DeliveryOptions{Metered: metered}),
		Metered:     metered,
	}
	if a.Kind == media.KindImage {
		view.ThumbnailURL = a.DeliveryURL(media.DeliveryOptions{Width: 320, Metered: true})
	}
	view.AudioURL = a.AudioURL()
	return view
}

func handleMediaLibrary(svc *media.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit, _ := strconv.ParseInt(r.URL.Query().Get("limit"), 10, 64)
		assets, err := svc.Library(r.Context(), media.Kind(r.URL.Query().Get("kind")), limit)
		if err != nil {
			writeMediaError(w, err)
			return
		}
		metered := meteredFrom(r)
		out := make([]assetView, 0, len(assets))
		for i := range assets {
			out = append(out, mediaView(&assets[i], metered))
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"assets": out,
			// The allowlists, so a composer can refuse a file before somebody
			// waits through an upload that will be rejected.
			"allowed": map[string]any{
				"image":    media.AllowedFormats(media.KindImage),
				"video":    media.AllowedFormats(media.KindVideo),
				"audio":    media.AllowedFormats(media.KindAudio),
				"document": media.AllowedFormats(media.KindDocument),
			},
		})
	}
}

func handleForgetMedia(svc *media.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// A wildcard route, because a provider public id contains slashes
		// ("altaros/<church>/<file>") and a path parameter would truncate at
		// the first one — deleting nothing, or worse, the wrong thing.
		publicID := strings.TrimPrefix(chi.URLParam(r, "*"), "/")
		if publicID == "" {
			httpx.Error(w, http.StatusBadRequest, "Say which file to remove.")
			return
		}
		if err := svc.Forget(r.Context(), publicID); err != nil {
			writeMediaError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"removed": true})
	}
}

func writeMediaError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, media.ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "That file is not in your library.")
	case errors.Is(err, media.ErrNotConfigured):
		// 503, not 500: nothing is broken, the platform simply has no storage
		// account set up, and that is an operator's job rather than a bug.
		httpx.Error(w, http.StatusServiceUnavailable,
			"Uploads are not available yet — no media storage is configured.")
	case errors.Is(err, media.ErrKindInvalid):
		httpx.Error(w, http.StatusBadRequest,
			"Choose image, video, audio or document.")
	case errors.Is(err, media.ErrDeliveryAddress):
		httpx.Error(w, http.StatusBadRequest,
			"That file's address is not one we serve media from.")
	case errors.Is(err, media.ErrFormatRefused):
		httpx.Error(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, media.ErrTooLarge):
		httpx.Error(w, http.StatusRequestEntityTooLarge,
			"That file is larger than we can accept for this kind of upload.")
	case errors.Is(err, media.ErrSignatureExpired):
		httpx.Error(w, http.StatusConflict,
			"That upload took too long to confirm. Please try again.")
	case errors.Is(err, tenancy.ErrNoTenant):
		httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
	default:
		httpx.Error(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
	}
}
