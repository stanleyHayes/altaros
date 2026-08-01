// Package transport holds the real delivery adapters for notifications.
//
// Every adapter here is written so that a missing credential produces a
// refusing transport rather than a silently succeeding one. The predecessor's
// payment stub returned success unconditionally, and the same mistake in
// messaging is worse in one specific way: nobody notices. A payment that did
// not happen gets a phone call from the giver; an SMS that was never sent is
// indistinguishable from one the member ignored.
package transport

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/hayfordstanley/altar-os/internal/domain/notification"
)

// AfricasTalkingURL is the live SMS endpoint.
const AfricasTalkingURL = "https://api.africastalking.com/version1/messaging"

// SMSConfig configures the Africa's Talking transport.
type SMSConfig struct {
	APIKey   string
	Username string
	// SenderID is the alphanumeric sender shown on the handset. Without one,
	// messages arrive from a shortcode the member does not recognise, which is
	// the difference between a church notice and a suspected scam.
	SenderID   string
	BaseURL    string
	HTTPClient *http.Client
}

// SMS delivers via Africa's Talking.
type SMS struct {
	apiKey     string
	username   string
	senderID   string
	baseURL    string
	http       *http.Client
	configured bool
}

var _ notification.Transport = (*SMS)(nil)

// NewSMS builds the SMS transport.
func NewSMS(cfg SMSConfig) *SMS {
	t := &SMS{
		apiKey:   strings.TrimSpace(cfg.APIKey),
		username: strings.TrimSpace(cfg.Username),
		senderID: strings.TrimSpace(cfg.SenderID),
		baseURL:  strings.TrimSpace(cfg.BaseURL),
		http:     cfg.HTTPClient,
	}
	if t.baseURL == "" {
		t.baseURL = AfricasTalkingURL
	}
	if t.http == nil {
		t.http = &http.Client{Timeout: 20 * time.Second}
	}
	t.configured = t.apiKey != "" && t.username != ""
	return t
}

// Channel identifies this transport.
func (t *SMS) Channel() notification.Channel { return notification.ChannelSMS }

// Send delivers one SMS.
func (t *SMS) Send(ctx context.Context, to string, msg notification.Message) (string, error) {
	if !t.configured {
		return "", errors.New("sms: AT_API_KEY and AT_USERNAME are not configured")
	}
	if strings.TrimSpace(to) == "" {
		return "", errors.New("sms: no recipient number")
	}

	form := url.Values{}
	form.Set("username", t.username)
	form.Set("to", to)
	form.Set("message", msg.Body)
	if t.senderID != "" {
		form.Set("from", t.senderID)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.baseURL,
		strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("sms: build request: %w", err)
	}
	req.Header.Set("apiKey", t.apiKey)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := t.http.Do(req)
	if err != nil {
		// The network is the classic transient failure; worth retrying.
		return "", notification.Retryable(fmt.Errorf("sms: %w", err))
	}
	defer func() { _ = resp.Body.Close() }()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", notification.Retryable(fmt.Errorf("sms: read response: %w", err))
	}

	if resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests {
		return "", notification.Retryable(fmt.Errorf("sms: HTTP %d: %s", resp.StatusCode, truncate(raw)))
	}
	if resp.StatusCode >= 400 {
		// A rejected request will be rejected identically next time.
		return "", fmt.Errorf("sms: HTTP %d: %s", resp.StatusCode, truncate(raw))
	}

	var out struct {
		SMSMessageData struct {
			Message    string `json:"Message"`
			Recipients []struct {
				Number     string `json:"number"`
				Status     string `json:"status"`
				MessageID  string `json:"messageId"`
				StatusCode int    `json:"statusCode"`
			} `json:"Recipients"`
		} `json:"SMSMessageData"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("sms: decode response: %w", err)
	}

	if len(out.SMSMessageData.Recipients) == 0 {
		// A 200 with no recipients means the message was accepted by the API
		// and delivered to nobody. Reporting that as sent would be the exact
		// silent failure this package exists to avoid.
		return "", fmt.Errorf("sms: accepted but no recipient was queued: %s",
			out.SMSMessageData.Message)
	}

	recipient := out.SMSMessageData.Recipients[0]
	if !strings.EqualFold(recipient.Status, "Success") {
		// Africa's Talking uses 4xx status codes for per-recipient problems.
		// 405 (insufficient balance) is retryable once topped up; an invalid
		// number never will be.
		if recipient.StatusCode == 405 || recipient.StatusCode >= 500 {
			return "", notification.Retryable(fmt.Errorf("sms: %s (%d)", recipient.Status, recipient.StatusCode))
		}
		return "", fmt.Errorf("sms: %s (%d)", recipient.Status, recipient.StatusCode)
	}
	return recipient.MessageID, nil
}

func truncate(b []byte) string {
	const limit = 300
	s := strings.TrimSpace(string(b))
	if len(s) > limit {
		return s[:limit] + "…"
	}
	return s
}
