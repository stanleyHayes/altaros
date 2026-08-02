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

// Arkesel is the SMS transport for Ghana (chosen 2 Aug 2026).
//
// It sits alongside the Africa's Talking transport rather than replacing it,
// behind the same notification.Transport port — the same shape ADR-002 uses for
// payments, and for the same reason: a messaging provider is a commercial
// relationship as much as a technical one, and the one that is cheapest or most
// reliable in Ghana today may not be in a year.
//
// # What is verified and what is not
//
// The endpoint, the `api-key` header, the request body and the HTTP error codes
// below come from Arkesel's published API. The exact shape of the `data` field
// in a success response is NOT pinned down by the public documentation, so this
// decodes it permissively and never depends on it: a message id is nice to have
// for support, and its absence is not a failure. What this does depend on — and
// checks strictly — is the `status` field, because a 200 carrying
// `status: "error"` is precisely the silent failure this package exists to
// avoid. See the package comment.
type Arkesel struct {
	apiKey     string
	senderID   string
	baseURL    string
	http       *http.Client
	configured bool
}

// ArkeselURL is the live v2 send endpoint.
//
// v2 with a header key rather than the older query-string form on purpose: an
// API key in a URL is written to every access log, proxy log and error report
// between here and Accra.
const ArkeselURL = "https://sms.arkesel.com/api/v2/sms/send"

// ArkeselConfig configures the Arkesel transport.
type ArkeselConfig struct {
	APIKey string
	// SenderID is the alphanumeric sender shown on the handset, and it must be
	// REGISTERED with Arkesel before it will send. An unregistered one is a 403
	// rather than a message from an unfamiliar shortcode, which is the better
	// failure — but it is also the most likely thing to be wrong on a first
	// deployment, so it is named explicitly in the error.
	SenderID   string
	BaseURL    string
	HTTPClient *http.Client
}

var _ notification.Transport = (*Arkesel)(nil)

// NewArkesel builds the Arkesel transport.
func NewArkesel(cfg ArkeselConfig) *Arkesel {
	t := &Arkesel{
		apiKey:   strings.TrimSpace(cfg.APIKey),
		senderID: strings.TrimSpace(cfg.SenderID),
		baseURL:  strings.TrimSpace(cfg.BaseURL),
		http:     cfg.HTTPClient,
	}
	if t.baseURL == "" {
		t.baseURL = ArkeselURL
	}
	if t.http == nil {
		t.http = &http.Client{Timeout: 20 * time.Second}
	}
	// The sender id is part of being configured, not an optional extra: without
	// a registered one every send is a 403, and a transport that is "configured"
	// but rejects everything is worse than one that refuses at boot.
	t.configured = t.apiKey != "" && t.senderID != ""
	return t
}

// Channel identifies this transport.
func (t *Arkesel) Channel() notification.Channel { return notification.ChannelSMS }

// Send delivers one SMS.
func (t *Arkesel) Send(ctx context.Context, to string, msg notification.Message) (string, error) {
	if !t.configured {
		return "", errors.New("sms: ARKESEL_API_KEY and ARKESEL_SENDER_ID are not configured")
	}
	recipient := arkeselNumber(to)
	if recipient == "" {
		return "", errors.New("sms: no recipient number")
	}
	if strings.TrimSpace(msg.Body) == "" {
		// Arkesel answers 422 for this. Refusing here saves a round trip and,
		// more usefully, keeps the empty-message bug attached to the caller
		// that produced it rather than to a provider error code.
		return "", errors.New("sms: message body is empty")
	}

	body, err := json.Marshal(map[string]any{
		"sender":     t.senderID,
		"message":    msg.Body,
		"recipients": []string{recipient},
	})
	if err != nil {
		return "", fmt.Errorf("sms: build request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.baseURL, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("sms: build request: %w", err)
	}
	req.Header.Set("api-key", t.apiKey)
	req.Header.Set("Content-Type", "application/json")
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

	if err := arkeselHTTPError(resp.StatusCode, raw); err != nil {
		return "", err
	}

	var out struct {
		Status  string          `json:"status"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("sms: decode response: %w", err)
	}

	// A 200 is not a send. Arkesel returns 200 with `status: "error"` for
	// conditions it considers the caller's fault, and treating that as success
	// puts a "we sent you a code" screen in front of somebody who will never
	// receive one.
	if !strings.EqualFold(out.Status, "success") {
		reason := strings.TrimSpace(out.Message)
		if reason == "" {
			reason = truncate(raw)
		}
		// Balance is the one 200-level failure that fixes itself: a topped-up
		// account will accept the identical request.
		if strings.Contains(strings.ToLower(reason), "balance") ||
			strings.Contains(strings.ToLower(reason), "credit") {
			return "", notification.Retryable(fmt.Errorf("sms: %s", reason))
		}
		return "", fmt.Errorf("sms: %s", reason)
	}

	// The message id is for support ("did this member get their code"), not for
	// correctness. Its absence is not a failure, and the shape it arrives in
	// has varied between Arkesel's own examples — an object for one message, an
	// array for several — so both are accepted and neither is required.
	return arkeselMessageID(out.Data), nil
}

// arkeselHTTPError maps a status code to an error, distinguishing the ones
// worth retrying from the ones that will fail identically forever.
func arkeselHTTPError(status int, raw []byte) error {
	switch {
	case status == http.StatusTooManyRequests, status >= 500:
		return notification.Retryable(fmt.Errorf("sms: HTTP %d: %s", status, truncate(raw)))

	case status == http.StatusForbidden:
		// Named rather than left as a generic 403, because this is the single
		// most likely thing to be wrong on a first deployment and the fix is
		// not in this codebase — somebody has to register the sender with
		// Arkesel and wait for approval.
		return fmt.Errorf("sms: HTTP 403 — the sender ID is not registered with "+
			"Arkesel, or the account lacks permission to send: %s", truncate(raw))

	case status == http.StatusUnauthorized:
		return fmt.Errorf("sms: HTTP 401 — ARKESEL_API_KEY is not valid: %s", truncate(raw))

	case status >= 400:
		// A rejected request will be rejected identically next time.
		return fmt.Errorf("sms: HTTP %d: %s", status, truncate(raw))
	}
	return nil
}

// arkeselNumber renders an E.164 number the way Arkesel expects it.
//
// E.164 carries a leading "+"; Arkesel's examples do not ("233244123456").
// Sending the "+" is the kind of mismatch that produces a 422 for every message
// on a working account, so it is stripped here rather than assumed away at the
// call site — every other part of this codebase stores E.164 deliberately, and
// this is the one place that has to differ.
func arkeselNumber(to string) string {
	trimmed := strings.TrimSpace(to)
	trimmed = strings.TrimPrefix(trimmed, "+")
	// Separators survive copy-paste from a spreadsheet and are never
	// significant in a dialable number.
	for _, sep := range []string{" ", "-", "(", ")"} {
		trimmed = strings.ReplaceAll(trimmed, sep, "")
	}
	return trimmed
}

// arkeselMessageID pulls an id out of whichever shape `data` arrived in.
func arkeselMessageID(data json.RawMessage) string {
	if len(data) == 0 {
		return ""
	}

	var single struct {
		ID        string `json:"id"`
		MessageID string `json:"message_id"`
	}
	if err := json.Unmarshal(data, &single); err == nil {
		if single.ID != "" {
			return single.ID
		}
		if single.MessageID != "" {
			return single.MessageID
		}
	}

	var many []struct {
		ID        string `json:"id"`
		MessageID string `json:"message_id"`
	}
	if err := json.Unmarshal(data, &many); err == nil && len(many) > 0 {
		if many[0].ID != "" {
			return many[0].ID
		}
		return many[0].MessageID
	}
	return ""
}
