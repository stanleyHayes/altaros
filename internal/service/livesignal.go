package service

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/hayfordstanley/altar-os/internal/domain/live"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/media"
)

// The signalling endpoint.
//
// Outside the normal auth middleware, because a browser cannot set an
// Authorization header when opening a WebSocket. Its credential is the room
// GRANT in the query string — a token that buys media for one service, in one
// role, for a few hours, and nothing else. The account's own access token must
// never be used here: query strings reach proxy logs and browser history, and a
// session token in one is an account takeover from a log file.
//
// Everything a grant asserts was already checked when it was issued: that the
// caller is a member of that church, that the church's tier includes streaming,
// and that a seat was available under the cap. This endpoint re-checks ONE
// thing — that we signed it.
//
// That is sufficient, and worth being precise about rather than adding a
// reassuring-looking check that does nothing. The room id is INSIDE the
// signature, and a grant is only ever issued after a tenant-scoped lookup
// found that session in the caller's own church. So a grant cannot be
// re-pointed at another church's room without breaking the signature, and
// there is no separate ownership question left for this handler to ask.

// wsConn adapts a WebSocket to the signalling transport.
type wsConn struct {
	c *websocket.Conn
}

func (w *wsConn) Read(ctx context.Context) (media.Message, error) {
	var msg media.Message
	if err := wsjson.Read(ctx, w.c, &msg); err != nil {
		if websocket.CloseStatus(err) != -1 {
			return media.Message{}, media.ErrConnClosed
		}
		return media.Message{}, err
	}
	return msg, nil
}

func (w *wsConn) Write(ctx context.Context, msg media.Message) error {
	// Every write is bounded. A phone that lost signal without closing its
	// socket accepts data into a buffer that never drains, and an unbounded
	// write to one of those holds the goroutine — and, for a renegotiation
	// offer, the publisher's track handler — indefinitely.
	ctx, cancel := context.WithTimeout(ctx, writeTimeout)
	defer cancel()
	return wsjson.Write(ctx, w.c, msg)
}

func (w *wsConn) Close(reason string) error {
	return w.c.Close(websocket.StatusNormalClosure, reason)
}

const (
	// writeTimeout bounds a single frame to a stalled client.
	writeTimeout = 10 * time.Second
	// sessionTimeout bounds one signalling connection.
	//
	// Longer than any real service, because a connection that is cut mid-sermon
	// is a congregation ejected. The grant expiring is the shorter leash.
	sessionTimeout = 6 * time.Hour
)

// handleLiveSignal upgrades to a WebSocket and runs the signalling loop.
func handleLiveSignal(d *deps.Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sfu := runningSFU()
		if sfu == nil {
			httpx.Error(w, http.StatusServiceUnavailable,
				"Live streaming is not switched on for this server yet.")
			return
		}
		signer, err := media.NewGrantSigner(d.Config.Live.SigningKey)
		if err != nil {
			httpx.Error(w, http.StatusServiceUnavailable,
				"Live streaming is not switched on for this server yet.")
			return
		}

		claims, err := signer.Verify(r.URL.Query().Get("grant"))
		if err != nil {
			// One message for both causes. Telling a caller their grant is
			// expired rather than invalid confirms it was one we issued, which
			// is a small thing to hand someone probing room ids.
			httpx.Error(w, http.StatusUnauthorized,
				"That live session credential is not valid. Please rejoin.")
			return
		}

		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			// The browser dashboard and the church's public site are separate
			// origins from the API, so the configured CORS list is the
			// authority here too — Accept's default is same-origin only,
			// which would refuse every legitimate client.
			OriginPatterns: d.Config.CORSOrigins,
		})
		if err != nil {
			// Accept has already written a response.
			return
		}
		defer func() { _ = conn.CloseNow() }()

		// Bounded, and detached from the request context: the HTTP request
		// finishes at the upgrade, and a loop tied to it would end the moment
		// the handler returned.
		ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), sessionTimeout)
		defer cancel()

		transport := &wsConn{c: conn}
		if live.Role(claims.Role) == live.RolePublisher {
			err = sfu.ServePublisher(ctx, transport, claims.RoomID, claims.Identity)
		} else {
			err = sfu.ServeViewer(ctx, transport, claims.RoomID, claims.Identity)
		}
		if err != nil && !errors.Is(err, media.ErrConnClosed) &&
			!errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
			slog.Debug("live signalling ended",
				"room", claims.RoomID, "participant", claims.Identity, "error", err)
		}
	}
}
