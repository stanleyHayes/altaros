package service

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/pion/webrtc/v4"

	"github.com/hayfordstanley/altar-os/internal/domain/live"
	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/media"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// sfuMediaServer adapts the SFU to the domain's MediaServer port.
//
// The adapter exists so the live domain never learns what is carrying the
// media. That is what lets the SFU move out of this process later — to its own
// deployable, or to a vendor — without the domain, its tests, or a single
// handler changing.

type sfuMediaServer struct {
	sfu    *media.SFU
	signer *media.GrantSigner
	ttl    time.Duration
	ice    []live.ICEServer
}

func (m *sfuMediaServer) OpenRoom(ctx context.Context, sessionID string, kind live.Kind) (string, error) {
	return m.sfu.OpenRoom(ctx, sessionID, string(kind))
}

func (m *sfuMediaServer) CloseRoom(ctx context.Context, roomID string) error {
	return m.sfu.CloseRoom(ctx, roomID)
}

// Grant issues a credential for one room, in one role.
//
// The CHURCH is stamped into the grant from the caller's scope, not taken from
// a parameter. It is what stops a grant for one church's service being
// presented against another's room id — the signalling endpoint compares it
// before connecting anything.
func (m *sfuMediaServer) Grant(ctx context.Context, roomID, identity string, role live.Role) (*live.Grant, error) {
	scope, err := tenancy.FromContext(ctx)
	if err != nil {
		return nil, err
	}
	expires := time.Now().Add(m.ttl)
	token, err := m.signer.Sign(media.GrantClaims{
		RoomID: roomID, Identity: identity, Role: string(role),
		ChurchID: scope.ChurchID, ExpiresAt: expires.Unix(),
	})
	if err != nil {
		return nil, err
	}
	return &live.Grant{
		RoomID: roomID, Token: token, Role: role,
		ICEServers: m.ice, ExpiresAt: expires,
	}, nil
}

var (
	sfuOnce   sync.Once
	sharedSFU *media.SFU
	sharedMS  live.MediaServer
)

// mediaServerFor builds the media server this deployment will use.
//
// One SFU per process, shared by every request: the rooms live in its memory,
// so a second instance would be a second set of rooms and a viewer would reach
// whichever one their request happened to land on.
//
// With no signing key it returns live.NotConfigured, which REFUSES every room
// with a named reason. The alternative — accepting rooms and issuing unsigned
// grants — is a live endpoint anyone can join by guessing a room id, and it
// would pass every test that did not specifically look for it.
func mediaServerFor(d *deps.Deps) live.MediaServer {
	sfuOnce.Do(func() {
		if d.Config == nil || !d.Config.Live.Enabled() {
			slog.Warn("live streaming is off: no LIVE_SIGNING_KEY is set")
			sharedMS = live.NotConfigured{}
			return
		}
		signer, err := media.NewGrantSigner(d.Config.Live.SigningKey)
		if err != nil {
			slog.Error("live streaming is off: could not build the grant signer",
				"error", err)
			sharedMS = live.NotConfigured{}
			return
		}

		ice := iceServersFrom(d.Config.Live)
		sfu, err := media.New(media.Config{
			ICEServers: ice,
			GrantTTL:   media.DefaultGrantTTL,
			Logger:     slog.Default(),
		})
		if err != nil {
			slog.Error("live streaming is off: could not start the media server",
				"error", err)
			sharedMS = live.NotConfigured{}
			return
		}

		if !d.Config.Live.HasRelay() {
			// A warning rather than a refusal: streaming without TURN works on
			// wifi and fails for most of a congregation on mobile data. That
			// is worth shipping in a pilot and worth shouting about, because
			// the failure otherwise arrives as "the app does not work on MTN"
			// with nothing in the logs to connect it to a missing relay.
			slog.Warn("live streaming has NO TURN relay — viewers behind " +
				"carrier-grade NAT (most Ghanaian mobile data) will not connect")
		}

		sharedSFU = sfu
		sharedMS = &sfuMediaServer{
			sfu: sfu, signer: signer,
			ttl: media.DefaultGrantTTL, ice: domainICE(ice),
		}
		slog.Info("live streaming ready",
			"turn", d.Config.Live.HasRelay(), "stun", len(d.Config.Live.STUNURLs))
	})
	return sharedMS
}

// runningSFU is the live media server, or nil when streaming is off.
//
// The signalling route needs the SFU itself rather than the port: it moves
// packets, which is precisely what the port abstracts away.
func runningSFU() *media.SFU { return sharedSFU }

// iceServersFrom builds the ICE list handed to every client.
func iceServersFrom(cfg config.LiveConfig) []webrtc.ICEServer {
	servers := []webrtc.ICEServer{}
	if len(cfg.STUNURLs) > 0 {
		servers = append(servers, webrtc.ICEServer{URLs: cfg.STUNURLs})
	}
	if len(cfg.TURNURLs) > 0 {
		servers = append(servers, webrtc.ICEServer{
			URLs:       cfg.TURNURLs,
			Username:   cfg.TURNUsername,
			Credential: cfg.TURNCredential,
		})
	}
	return servers
}

// domainICE converts to the shape the client is given.
func domainICE(servers []webrtc.ICEServer) []live.ICEServer {
	out := make([]live.ICEServer, 0, len(servers))
	for _, s := range servers {
		credential, _ := s.Credential.(string)
		out = append(out, live.ICEServer{
			URLs: s.URLs, Username: s.Username, Credential: credential,
		})
	}
	return out
}
