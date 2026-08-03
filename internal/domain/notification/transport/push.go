package transport

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/hayfordstanley/altar-os/internal/domain/notification"
)

// PushConfig configures Firebase Cloud Messaging.
type PushConfig struct {
	// ProjectID is the Firebase project. FCM v1 endpoints are project-scoped.
	ProjectID string
	// TokenSource yields an OAuth2 bearer token for the service account. It is
	// an interface rather than a raw credential so the caller owns the
	// refresh: FCM v1 tokens expire hourly, and a transport that cached one
	// forever would stop delivering push exactly one hour after every deploy,
	// which looks like an app bug rather than a credential problem.
	TokenSource TokenSource
	BaseURL     string
	HTTPClient  *http.Client
}

// TokenSource yields a bearer token for FCM.
type TokenSource interface {
	Token(ctx context.Context) (string, error)
}

// StaticToken is a TokenSource for tests and short-lived local runs.
type StaticToken string

// Token returns the fixed token.
func (s StaticToken) Token(context.Context) (string, error) {
	if s == "" {
		return "", errors.New("push: no token")
	}
	return string(s), nil
}

// Push delivers via Firebase Cloud Messaging.
type Push struct {
	projectID  string
	tokens     TokenSource
	baseURL    string
	http       *http.Client
	configured bool

	// invalidMu guards the set of tokens FCM has told us are dead.
	invalidMu sync.RWMutex
	invalid   map[string]bool
}

var _ notification.Transport = (*Push)(nil)

// NewPush builds the push transport.
func NewPush(cfg PushConfig) *Push {
	t := &Push{
		projectID: strings.TrimSpace(cfg.ProjectID),
		tokens:    cfg.TokenSource,
		baseURL:   strings.TrimSpace(cfg.BaseURL),
		http:      cfg.HTTPClient,
		invalid:   map[string]bool{},
	}
	if t.baseURL == "" {
		t.baseURL = "https://fcm.googleapis.com"
	}
	if t.http == nil {
		t.http = &http.Client{Timeout: 20 * time.Second}
	}
	t.configured = t.projectID != "" && t.tokens != nil
	return t
}

// Channel identifies this transport.
func (t *Push) Channel() notification.Channel { return notification.ChannelPush }

// InvalidTokens returns device tokens FCM has rejected as unregistered, so the
// member service can prune them. A stale token is retried forever otherwise,
// and a congregation that has reinstalled the app accumulates them.
func (t *Push) InvalidTokens() []string {
	t.invalidMu.RLock()
	defer t.invalidMu.RUnlock()
	out := make([]string, 0, len(t.invalid))
	for token := range t.invalid {
		out = append(out, token)
	}
	return out
}

// Send delivers one push notification.
func (t *Push) Send(ctx context.Context, to string, msg notification.Message) (string, error) {
	if !t.configured {
		return "", errors.New("push: FIREBASE project and credentials are not configured")
	}
	if strings.TrimSpace(to) == "" {
		return "", errors.New("push: no device token")
	}

	bearer, err := t.tokens.Token(ctx)
	if err != nil {
		// A credential that cannot be minted now may well mint in a minute.
		return "", notification.Retryable(fmt.Errorf("push: obtain token: %w", err))
	}

	title := msg.Subject
	if title == "" {
		title = "Your church"
	}
	data := map[string]string{"kind": string(msg.Kind)}
	if msg.DeepLink != "" {
		data["deepLink"] = msg.DeepLink
	}
	body, err := json.Marshal(map[string]any{
		"message": map[string]any{
			"token": to,
			"notification": map[string]any{
				"title": title,
				"body":  msg.Body,
			},
			"data": data,
		},
	})
	if err != nil {
		return "", fmt.Errorf("push: encode request: %w", err)
	}

	endpoint := fmt.Sprintf("%s/v1/projects/%s/messages:send", t.baseURL, t.projectID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("push: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Content-Type", "application/json")

	resp, err := t.http.Do(req)
	if err != nil {
		return "", notification.Retryable(fmt.Errorf("push: %w", err))
	}
	defer func() { _ = resp.Body.Close() }()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", notification.Retryable(fmt.Errorf("push: read response: %w", err))
	}

	if resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests {
		return "", notification.Retryable(fmt.Errorf("push: HTTP %d: %s", resp.StatusCode, truncate(raw)))
	}
	if resp.StatusCode >= 400 {
		if isUnregistered(raw) {
			t.markInvalid(to)
			return "", fmt.Errorf("push: %w", notification.ErrUnregisteredDevice)
		}
		return "", fmt.Errorf("push: HTTP %d: %s", resp.StatusCode, truncate(raw))
	}

	var out struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("push: decode response: %w", err)
	}
	return out.Name, nil
}

func (t *Push) markInvalid(token string) {
	t.invalidMu.Lock()
	defer t.invalidMu.Unlock()
	t.invalid[token] = true
}

// isUnregistered detects FCM's "this device is gone" errors, which mean the
// token should be pruned rather than retried.
func isUnregistered(raw []byte) bool {
	var out struct {
		Error struct {
			Status  string `json:"status"`
			Message string `json:"message"`
			Details []struct {
				ErrorCode string `json:"errorCode"`
			} `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return false
	}
	for _, d := range out.Error.Details {
		if d.ErrorCode == "UNREGISTERED" || d.ErrorCode == "INVALID_ARGUMENT" {
			return true
		}
	}
	return out.Error.Status == "NOT_FOUND" ||
		strings.Contains(strings.ToUpper(out.Error.Message), "UNREGISTERED")
}
