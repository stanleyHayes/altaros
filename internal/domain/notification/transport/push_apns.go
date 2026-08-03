package transport

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/hayfordstanley/altar-os/internal/domain/notification"
)

const (
	apnsProductionURL = "https://api.push.apple.com"
	apnsSandboxURL    = "https://api.sandbox.push.apple.com"
)

// APNSConfig configures Apple token-based provider authentication.
type APNSConfig struct {
	TeamID     string
	KeyID      string
	BundleID   string
	PrivateKey string
	Sandbox    bool
	BaseURL    string
	HTTPClient *http.Client
	Now        func() time.Time
}

// APNS sends directly to Apple's HTTP/2 provider API.
type APNS struct {
	teamID     string
	keyID      string
	bundleID   string
	privateKey *ecdsa.PrivateKey
	baseURL    string
	http       *http.Client
	now        func() time.Time
	configured bool
	mu         sync.Mutex
	jwt        string
	jwtAt      time.Time
}

func NewAPNS(cfg APNSConfig) *APNS {
	baseURL := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		if cfg.Sandbox {
			baseURL = apnsSandboxURL
		} else {
			baseURL = apnsProductionURL
		}
	}
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	key, _ := parseAPNSPrivateKey(cfg.PrivateKey)
	a := &APNS{
		teamID: strings.TrimSpace(cfg.TeamID), keyID: strings.TrimSpace(cfg.KeyID),
		bundleID: strings.TrimSpace(cfg.BundleID), privateKey: key, baseURL: baseURL,
		http: client, now: now,
	}
	a.configured = a.teamID != "" && a.keyID != "" && a.bundleID != "" && a.privateKey != nil
	return a
}

func parseAPNSPrivateKey(value string) (*ecdsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(strings.TrimSpace(value)))
	if block == nil {
		return nil, errors.New("APNs private key is not PEM")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse APNs private key: %w", err)
	}
	key, ok := parsed.(*ecdsa.PrivateKey)
	if !ok {
		return nil, errors.New("APNs private key is not EC")
	}
	return key, nil
}

func (a *APNS) providerJWT() (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.now().UTC()
	// Apple accepts a provider token for one hour. Rotate at 50 minutes so a
	// request never races the expiry boundary in transit.
	if a.jwt != "" && now.Sub(a.jwtAt) < 50*time.Minute {
		return a.jwt, nil
	}
	claims := jwt.MapClaims{"iss": a.teamID, "iat": now.Unix()}
	token := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
	token.Header["kid"] = a.keyID
	signed, err := token.SignedString(a.privateKey)
	if err != nil {
		return "", fmt.Errorf("sign APNs provider token: %w", err)
	}
	a.jwt, a.jwtAt = signed, now
	return signed, nil
}

func (a *APNS) Send(ctx context.Context, deviceToken string, msg notification.Message) (string, error) {
	if !a.configured {
		return "", errors.New("push: APNs team, key, topic and private key are not configured")
	}
	deviceToken = strings.TrimSpace(deviceToken)
	if len(deviceToken) < 32 || len(deviceToken) > 4096 {
		return "", notification.ErrInvalidDevice
	}
	bearer, err := a.providerJWT()
	if err != nil {
		return "", notification.Retryable(fmt.Errorf("push: obtain APNs token: %w", err))
	}
	title := msg.Subject
	if title == "" {
		title = "Your church"
	}
	payload := map[string]any{
		"aps": map[string]any{
			"alert": map[string]string{"title": title, "body": msg.Body},
			"sound": "default",
		},
		"kind": string(msg.Kind),
	}
	if msg.DeepLink != "" {
		payload["deepLink"] = msg.DeepLink
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("push: encode APNs request: %w", err)
	}
	endpoint := a.baseURL + "/3/device/" + url.PathEscape(deviceToken)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("push: build APNs request: %w", err)
	}
	req.Header.Set("Authorization", "bearer "+bearer)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("apns-topic", a.bundleID)
	req.Header.Set("apns-push-type", "alert")
	req.Header.Set("apns-priority", "10")

	resp, err := a.http.Do(req)
	if err != nil {
		return "", notification.Retryable(fmt.Errorf("push: APNs: %w", err))
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", notification.Retryable(fmt.Errorf("push: read APNs response: %w", err))
	}
	if resp.StatusCode == http.StatusOK {
		providerID := strings.TrimSpace(resp.Header.Get("apns-id"))
		if providerID == "" {
			return "", errors.New("push: APNs accepted without apns-id")
		}
		return providerID, nil
	}
	var failure struct {
		Reason string `json:"reason"`
	}
	_ = json.Unmarshal(raw, &failure)
	reason := strings.TrimSpace(failure.Reason)
	if reason == "" {
		reason = strings.TrimSpace(string(raw))
	}
	if resp.StatusCode == http.StatusGone || reason == "BadDeviceToken" || reason == "Unregistered" {
		return "", fmt.Errorf("push: APNs %s: %w", reason, notification.ErrUnregisteredDevice)
	}
	if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
		return "", notification.Retryable(fmt.Errorf("push: APNs HTTP %d: %s", resp.StatusCode, reason))
	}
	return "", fmt.Errorf("push: APNs HTTP %d: %s", resp.StatusCode, reason)
}

var _ PushSender = (*APNS)(nil)
