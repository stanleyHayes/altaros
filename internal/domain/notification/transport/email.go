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
	"time"

	"github.com/hayfordstanley/altar-os/internal/domain/notification"
)

// ResendURL is the live email endpoint.
const ResendURL = "https://api.resend.com/emails"

// EmailConfig configures the Resend transport.
type EmailConfig struct {
	APIKey string
	// From is the verified sender. Resend rejects anything else, which is the
	// correct behaviour — an unverified sender lands in spam and the church
	// concludes the platform does not work.
	From       string
	BaseURL    string
	HTTPClient *http.Client
}

// Email delivers via Resend.
type Email struct {
	apiKey     string
	from       string
	baseURL    string
	http       *http.Client
	configured bool
}

var _ notification.Transport = (*Email)(nil)

// NewEmail builds the email transport.
func NewEmail(cfg EmailConfig) *Email {
	t := &Email{
		apiKey:  strings.TrimSpace(cfg.APIKey),
		from:    strings.TrimSpace(cfg.From),
		baseURL: strings.TrimSpace(cfg.BaseURL),
		http:    cfg.HTTPClient,
	}
	if t.baseURL == "" {
		t.baseURL = ResendURL
	}
	if t.http == nil {
		t.http = &http.Client{Timeout: 20 * time.Second}
	}
	t.configured = t.apiKey != "" && t.from != ""
	return t
}

// Channel identifies this transport.
func (t *Email) Channel() notification.Channel { return notification.ChannelEmail }

// Send delivers one email.
func (t *Email) Send(ctx context.Context, to string, msg notification.Message) (string, error) {
	if !t.configured {
		return "", errors.New("email: RESEND_API_KEY and RESEND_FROM_EMAIL are not configured")
	}
	if strings.TrimSpace(to) == "" {
		return "", errors.New("email: no recipient address")
	}

	subject := msg.Subject
	if subject == "" {
		subject = "A message from your church"
	}

	body, err := json.Marshal(map[string]any{
		"from":    t.from,
		"to":      []string{to},
		"subject": subject,
		"text":    msg.Body,
	})
	if err != nil {
		return "", fmt.Errorf("email: encode request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.baseURL, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("email: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+t.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := t.http.Do(req)
	if err != nil {
		return "", notification.Retryable(fmt.Errorf("email: %w", err))
	}
	defer func() { _ = resp.Body.Close() }()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", notification.Retryable(fmt.Errorf("email: read response: %w", err))
	}

	if resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests {
		return "", notification.Retryable(fmt.Errorf("email: HTTP %d: %s", resp.StatusCode, truncate(raw)))
	}
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("email: HTTP %d: %s", resp.StatusCode, truncate(raw))
	}

	var out struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("email: decode response: %w", err)
	}
	if out.ID == "" {
		return "", fmt.Errorf("email: accepted without a message id: %s", truncate(raw))
	}
	return out.ID, nil
}
