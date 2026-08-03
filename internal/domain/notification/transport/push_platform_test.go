package transport

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/hayfordstanley/altar-os/internal/domain/notification"
)

type platformSender struct {
	token string
	calls int
}

func (s *platformSender) Send(_ context.Context, token string, _ notification.Message) (string, error) {
	s.token, s.calls = token, s.calls+1
	return "provider-id", nil
}

func TestPushAddressRequiresAndPreservesPlatform(t *testing.T) {
	token := strings.Repeat("a", 64)
	address, err := notification.PushAddress("ios", token)
	if err != nil {
		t.Fatalf("PushAddress: %v", err)
	}
	platform, decoded, err := notification.ParsePushAddress(address)
	if err != nil || platform != "ios" || decoded != token {
		t.Fatalf("decoded = %q %q %v", platform, decoded, err)
	}
	for _, invalid := range []string{token, "web:" + token, "ios:short"} {
		if _, _, err := notification.ParsePushAddress(invalid); !errors.Is(err, notification.ErrInvalidDevice) {
			t.Errorf("%q should be rejected, got %v", invalid, err)
		}
	}
}

func TestPushRouterSelectsProviderWithoutGuessingTokenShape(t *testing.T) {
	android, ios := &platformSender{}, &platformSender{}
	router := NewPushRouter(android, ios)
	sharedShape := strings.Repeat("f", 64)
	for _, platform := range []string{"android", "ios"} {
		address, _ := notification.PushAddress(platform, sharedShape)
		if _, err := router.Send(context.Background(), address, notification.Message{Body: "Update"}); err != nil {
			t.Fatalf("route %s: %v", platform, err)
		}
	}
	if android.calls != 1 || ios.calls != 1 || android.token != sharedShape || ios.token != sharedShape {
		t.Fatalf("wrong routing: android=%+v ios=%+v", android, ios)
	}
}

func testECPrivateKey(t *testing.T) string {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: raw}))
}

func TestAPNSSendsAlertWithProviderHeadersAndDeepLink(t *testing.T) {
	var requestBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/3/device/"+strings.Repeat("a", 64) {
			t.Errorf("path = %q", r.URL.Path)
		}
		if !strings.HasPrefix(r.Header.Get("Authorization"), "bearer ") || r.Header.Get("apns-topic") != "com.altaros.app" || r.Header.Get("apns-push-type") != "alert" {
			t.Errorf("missing APNs headers: %v", r.Header)
		}
		raw, _ := io.ReadAll(r.Body)
		requestBody = string(raw)
		w.Header().Set("apns-id", "apns-message-1")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	apns := NewAPNS(APNSConfig{
		TeamID: "TEAM123", KeyID: "KEY123", BundleID: "com.altaros.app",
		PrivateKey: testECPrivateKey(t), BaseURL: srv.URL,
		Now: func() time.Time { return time.Unix(1_800_000_000, 0) },
	})
	id, err := apns.Send(context.Background(), strings.Repeat("a", 64), notification.Message{
		Subject: "Grace Chapel", Body: "Service starts soon", Kind: notification.KindAnnouncement,
		DeepLink: "altaros://events/event_1",
	})
	if err != nil || id != "apns-message-1" {
		t.Fatalf("Send = %q, %v", id, err)
	}
	if !strings.Contains(requestBody, `"deepLink":"altaros://events/event_1"`) || !strings.Contains(requestBody, `"sound":"default"`) {
		t.Fatalf("unexpected APNs payload: %s", requestBody)
	}
}

func TestAPNSClassifiesDeadAndTransientDevices(t *testing.T) {
	key := testECPrivateKey(t)
	for _, tc := range []struct {
		status    int
		body      string
		wantDead  bool
		wantRetry bool
	}{
		{http.StatusGone, `{"reason":"Unregistered"}`, true, false},
		{http.StatusInternalServerError, `{"reason":"InternalServerError"}`, false, true},
	} {
		client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: tc.status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(tc.body))}, nil
		})}
		apns := NewAPNS(APNSConfig{TeamID: "T", KeyID: "K", BundleID: "com.altaros.app", PrivateKey: key, BaseURL: "https://apns.invalid", HTTPClient: client})
		_, err := apns.Send(context.Background(), strings.Repeat("b", 64), notification.Message{Body: "x"})
		if errors.Is(err, notification.ErrUnregisteredDevice) != tc.wantDead || notification.IsRetryable(err) != tc.wantRetry {
			t.Errorf("status %d classification: %v", tc.status, err)
		}
	}
}

func testRSAServiceAccount(t *testing.T, tokenURI string) string {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(map[string]string{
		"project_id": "altar-project", "client_email": "push@altar.invalid",
		"private_key_id": "key-1", "private_key": string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: raw})),
		"token_uri": tokenURI,
	})
	return string(encoded)
}

func TestFirebaseServiceAccountMintsAndCachesBearer(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if err := r.ParseForm(); err != nil || r.Form.Get("assertion") == "" || !strings.Contains(r.Form.Get("grant_type"), "jwt-bearer") {
			t.Errorf("invalid OAuth assertion: %v %v", r.Form, err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"fcm-bearer","expires_in":3600,"token_type":"Bearer"}`))
	}))
	defer srv.Close()
	source, err := NewGoogleServiceAccountTokenSource(testRSAServiceAccount(t, srv.URL), srv.Client())
	if err != nil || source.ProjectID() != "altar-project" {
		t.Fatalf("source = %#v, %v", source, err)
	}
	first, err := source.Token(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	second, err := source.Token(context.Background())
	if err != nil || first != "fcm-bearer" || second != first || calls != 1 {
		t.Fatalf("tokens = %q %q, calls=%d, err=%v", first, second, calls, err)
	}
}
