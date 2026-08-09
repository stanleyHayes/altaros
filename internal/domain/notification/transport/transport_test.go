package transport

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/hayfordstanley/altar-os/internal/domain/notification"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

func serve(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return srv
}

// An unconfigured transport must refuse rather than pretend. An SMS that was
// never sent is indistinguishable from one the member ignored.
func TestUnconfiguredTransportsRefuse(t *testing.T) {
	// SMS is covered by TestArkeselRefusesWhenUnconfigured, which exercises the
	// transport that actually ships.
	if _, err := NewEmail(EmailConfig{}).Send(context.Background(), "a@b.c",
		notification.Message{Body: "x"}); err == nil {
		t.Error("email with no credentials must refuse")
	}
	if _, err := NewPush(PushConfig{}).Send(context.Background(), "token",
		notification.Message{Body: "x"}); err == nil {
		t.Error("push with no credentials must refuse")
	}
}

func TestEmailSendsAndReturnsID(t *testing.T) {
	var body string
	srv := serve(t, func(w http.ResponseWriter, r *http.Request) {
		raw := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(raw)
		body = string(raw)
		if r.Header.Get("Authorization") != "Bearer re_key" {
			t.Error("the API key must be sent")
		}
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"id":"email_123"}`))
	})

	email := NewEmail(EmailConfig{APIKey: "re_key", From: "no-reply@church.app", BaseURL: srv.URL})
	id, err := email.Send(context.Background(), "ama@example.com",
		notification.Message{Subject: "Giving receipt", Body: "Thank you."})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if id != "email_123" {
		t.Errorf("id = %q", id)
	}
	if !strings.Contains(body, "Giving receipt") {
		t.Errorf("subject missing from request: %s", body)
	}
}

// A 200 with no id means the provider accepted nothing identifiable, so
// delivery reports could never reconcile.
func TestEmailAcceptedWithoutIDIsNotSuccess(t *testing.T) {
	srv := serve(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{}`))
	})
	email := NewEmail(EmailConfig{APIKey: "k", From: "a@b.c", BaseURL: srv.URL})
	if _, err := email.Send(context.Background(), "x@y.z",
		notification.Message{Body: "x"}); err == nil {
		t.Fatal("a response with no message id must not report success")
	}
}

// A dead device token must be pruned, not retried forever. A congregation
// that has reinstalled the app accumulates them.
func TestPushMarksUnregisteredTokensForPruning(t *testing.T) {
	httpClient := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusNotFound,
			Body: io.NopCloser(strings.NewReader(`{"error":{"status":"NOT_FOUND","message":"Requested entity was not found.",
				"details":[{"errorCode":"UNREGISTERED"}]}}`)),
			Header: make(http.Header),
		}, nil
	})}
	push := NewPush(PushConfig{
		ProjectID: "altar", TokenSource: StaticToken("tok"), BaseURL: "https://fcm.invalid", HTTPClient: httpClient,
	})
	_, err := push.Send(context.Background(), "dead_device_token", notification.Message{Body: "x"})
	if err == nil {
		t.Fatal("want an error")
	}
	if notification.IsRetryable(err) {
		t.Error("an unregistered device must not be retried")
	}
	if !errors.Is(err, notification.ErrUnregisteredDevice) {
		t.Fatalf("error = %v, want ErrUnregisteredDevice", err)
	}

	invalid := push.InvalidTokens()
	if len(invalid) != 1 || invalid[0] != "dead_device_token" {
		t.Fatalf("the dead token should be reported for pruning, got %v", invalid)
	}
}

// FCM v1 tokens expire hourly; a failure to mint one now may well succeed in a
// minute, so it must not be treated as permanent.
func TestPushTokenFailureIsRetryable(t *testing.T) {
	push := NewPush(PushConfig{ProjectID: "altar", TokenSource: StaticToken(""), BaseURL: "http://unused"})
	_, err := push.Send(context.Background(), "device", notification.Message{Body: "x"})
	if !notification.IsRetryable(err) {
		t.Fatalf("a token minting failure should be retryable, got %v", err)
	}
}

func TestPushSuccessReturnsMessageName(t *testing.T) {
	srv := serve(t, func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Path, "/v1/projects/altar/messages:send") {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		raw, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(raw), `"deepLink":"altaros://events/event_1"`) {
			t.Errorf("push omitted deep link data: %s", raw)
		}
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"name":"projects/altar/messages/0:1234"}`))
	})

	push := NewPush(PushConfig{ProjectID: "altar", TokenSource: StaticToken("tok"), BaseURL: srv.URL})
	name, err := push.Send(context.Background(), "device", notification.Message{
		Subject: "Grace Chapel", Body: "Service moves to 9am.", DeepLink: "altaros://events/event_1",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if name != "projects/altar/messages/0:1234" {
		t.Errorf("name = %q", name)
	}
}

// Every transport must report the channel it serves, or the service cannot
// route to it.
func TestTransportsDeclareTheirChannel(t *testing.T) {
	// SMS is covered by TestArkeselDeclaresTheSMSChannel.
	if got := NewEmail(EmailConfig{}).Channel(); got != notification.ChannelEmail {
		t.Errorf("email channel = %q", got)
	}
	if got := NewPush(PushConfig{}).Channel(); got != notification.ChannelPush {
		t.Errorf("push channel = %q", got)
	}
}
