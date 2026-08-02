package transport

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/hayfordstanley/altar-os/internal/domain/notification"
)

// The headline case. Arkesel answers HTTP 200 with `status: "error"` for
// conditions it considers the caller's fault, and treating a 200 as a send puts
// a "we sent you a code" screen in front of somebody who will never receive one.
func TestArkeselTwoHundredWithAnErrorStatusIsNotASend(t *testing.T) {
	srv := serve(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"status":"error","message":"Sender ID not approved"}`))
	})

	client := NewArkesel(ArkeselConfig{APIKey: "k", SenderID: "GRACE", BaseURL: srv.URL})
	if _, err := client.Send(context.Background(), "+233241234567",
		notification.Message{Body: "Your code is 123456"}); err == nil {
		t.Fatal("a 200 carrying status=error was reported as a successful send")
	} else if !strings.Contains(err.Error(), "Sender ID not approved") {
		t.Fatalf("the provider's reason was lost: %v", err)
	}
}

func TestArkeselSendsTheDocumentedRequest(t *testing.T) {
	var apiKey, contentType string
	var body []byte
	srv := serve(t, func(w http.ResponseWriter, r *http.Request) {
		apiKey = r.Header.Get("api-key")
		contentType = r.Header.Get("Content-Type")
		body, _ = io.ReadAll(r.Body)
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"status":"success","data":{"id":"msg_1"}}`))
	})

	client := NewArkesel(ArkeselConfig{APIKey: "secret", SenderID: "GRACE", BaseURL: srv.URL})
	id, err := client.Send(context.Background(), "+233 24-123 4567",
		notification.Message{Body: "Sunday service at 9am"})
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	if id != "msg_1" {
		t.Errorf("message id = %q, want msg_1", id)
	}

	// The key travels in a HEADER, never a query string: a key in a URL is
	// written to every access log between here and Accra.
	if apiKey != "secret" {
		t.Errorf("api-key header = %q", apiKey)
	}
	if contentType != "application/json" {
		t.Errorf("Content-Type = %q", contentType)
	}

	var req struct {
		Sender     string   `json:"sender"`
		Message    string   `json:"message"`
		Recipients []string `json:"recipients"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		t.Fatalf("request body was not JSON: %v", err)
	}
	if req.Sender != "GRACE" {
		t.Errorf("sender = %q", req.Sender)
	}
	if req.Message != "Sunday service at 9am" {
		t.Errorf("message = %q", req.Message)
	}
	// E.164 carries a leading "+", Arkesel's format does not. Sending the "+"
	// is a 422 on every message from an otherwise working account.
	if len(req.Recipients) != 1 || req.Recipients[0] != "233241234567" {
		t.Errorf("recipients = %v, want [233241234567]", req.Recipients)
	}
}

func TestArkeselAcceptsEitherShapeOfSuccessData(t *testing.T) {
	// The success `data` shape is not pinned down by the public documentation,
	// so both forms are accepted — and neither is required, because a missing
	// message id is a support inconvenience, not a failed send.
	for name, body := range map[string]string{
		"object": `{"status":"success","data":{"id":"a1"}}`,
		"array":  `{"status":"success","data":[{"id":"a1"}]}`,
		"absent": `{"status":"success"}`,
		"other":  `{"status":"success","data":{"message_id":"a1"}}`,
	} {
		t.Run(name, func(t *testing.T) {
			srv := serve(t, func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(200)
				_, _ = w.Write([]byte(body))
			})
			client := NewArkesel(ArkeselConfig{APIKey: "k", SenderID: "S", BaseURL: srv.URL})
			if _, err := client.Send(context.Background(), "233241234567",
				notification.Message{Body: "hello"}); err != nil {
				t.Fatalf("a documented success shape was refused: %v", err)
			}
		})
	}
}

func TestArkeselSeparatesRetryableFailuresFromPermanentOnes(t *testing.T) {
	cases := []struct {
		name      string
		status    int
		body      string
		retryable bool
	}{
		{"rate limited", 429, `{"status":"error","message":"too many"}`, true},
		{"provider down", 503, `service unavailable`, true},
		{"insufficient balance", 200,
			`{"status":"error","message":"Insufficient balance"}`, true},
		{"unregistered sender", 403, `{"message":"forbidden"}`, false},
		{"bad api key", 401, `{"message":"unauthorized"}`, false},
		{"malformed number", 422, `{"message":"invalid recipient"}`, false},
		{"bad request", 400, `{"message":"missing field"}`, false},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			srv := serve(t, func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(c.status)
				_, _ = w.Write([]byte(c.body))
			})
			client := NewArkesel(ArkeselConfig{APIKey: "k", SenderID: "S", BaseURL: srv.URL})
			_, err := client.Send(context.Background(), "233241234567",
				notification.Message{Body: "hello"})
			if err == nil {
				t.Fatal("expected a failure")
			}
			if got := notification.IsRetryable(err); got != c.retryable {
				t.Errorf("retryable = %v, want %v (%v)", got, c.retryable, err)
			}
		})
	}
}

func TestArkeselNamesTheUnregisteredSenderExplicitly(t *testing.T) {
	// The most likely thing to be wrong on a first deployment, and the fix is
	// not in this codebase — somebody has to register the sender and wait for
	// approval. A generic "HTTP 403" sends them looking in the wrong place.
	srv := serve(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(403)
		_, _ = w.Write([]byte(`{"message":"forbidden"}`))
	})
	client := NewArkesel(ArkeselConfig{APIKey: "k", SenderID: "S", BaseURL: srv.URL})
	_, err := client.Send(context.Background(), "233241234567",
		notification.Message{Body: "hello"})
	if err == nil || !strings.Contains(err.Error(), "sender ID is not registered") {
		t.Fatalf("a 403 did not name the sender registration: %v", err)
	}
}

func TestArkeselRefusesWhenUnconfigured(t *testing.T) {
	// A sender id is part of being configured, not an optional extra: without a
	// registered one every send is a 403, and a transport that is "configured"
	// but rejects everything is worse than one that refuses up front.
	for name, cfg := range map[string]ArkeselConfig{
		"no key":    {SenderID: "S"},
		"no sender": {APIKey: "k"},
		"neither":   {},
	} {
		t.Run(name, func(t *testing.T) {
			client := NewArkesel(cfg)
			if _, err := client.Send(context.Background(), "233241234567",
				notification.Message{Body: "hello"}); err == nil {
				t.Fatal("an unconfigured transport reported a successful send")
			}
		})
	}
}

func TestArkeselRefusesAnEmptyMessageBeforeSpendingARequest(t *testing.T) {
	called := false
	srv := serve(t, func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(200)
	})
	client := NewArkesel(ArkeselConfig{APIKey: "k", SenderID: "S", BaseURL: srv.URL})
	if _, err := client.Send(context.Background(), "233241234567",
		notification.Message{Body: "   "}); err == nil {
		t.Fatal("an empty message was sent")
	}
	if called {
		t.Error("the provider was called for a message with no body")
	}
}

func TestArkeselDeclaresTheSMSChannel(t *testing.T) {
	if got := NewArkesel(ArkeselConfig{}).Channel(); got != notification.ChannelSMS {
		t.Errorf("Channel() = %q, want %q", got, notification.ChannelSMS)
	}
}
