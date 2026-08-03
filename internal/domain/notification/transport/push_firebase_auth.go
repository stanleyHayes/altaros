package transport

import (
	"context"
	"crypto/rsa"
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
)

const firebaseMessagingScope = "https://www.googleapis.com/auth/firebase.messaging"

type firebaseServiceAccount struct {
	ProjectID    string `json:"project_id"`
	ClientEmail  string `json:"client_email"`
	PrivateKey   string `json:"private_key"`
	PrivateKeyID string `json:"private_key_id"`
	TokenURI     string `json:"token_uri"`
}

// GoogleServiceAccountTokenSource exchanges a short-lived signed assertion
// for the OAuth bearer required by FCM v1 and refreshes before expiry.
type GoogleServiceAccountTokenSource struct {
	account firebaseServiceAccount
	key     *rsa.PrivateKey
	http    *http.Client
	now     func() time.Time
	mu      sync.Mutex
	token   string
	expires time.Time
}

func NewGoogleServiceAccountTokenSource(raw string, client *http.Client) (*GoogleServiceAccountTokenSource, error) {
	var account firebaseServiceAccount
	if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &account); err != nil {
		return nil, fmt.Errorf("firebase credentials: decode service account: %w", err)
	}
	if strings.TrimSpace(account.ProjectID) == "" || strings.TrimSpace(account.ClientEmail) == "" || strings.TrimSpace(account.TokenURI) == "" {
		return nil, errors.New("firebase credentials: incomplete service account")
	}
	block, _ := pem.Decode([]byte(account.PrivateKey))
	if block == nil {
		return nil, errors.New("firebase credentials: private key is not PEM")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("firebase credentials: parse private key: %w", err)
	}
	key, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("firebase credentials: private key is not RSA")
	}
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	return &GoogleServiceAccountTokenSource{account: account, key: key, http: client, now: time.Now}, nil
}

func (s *GoogleServiceAccountTokenSource) ProjectID() string { return s.account.ProjectID }

func (s *GoogleServiceAccountTokenSource) Token(ctx context.Context) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now().UTC()
	if s.token != "" && now.Add(2*time.Minute).Before(s.expires) {
		return s.token, nil
	}
	claims := jwt.MapClaims{
		"iss":   s.account.ClientEmail,
		"scope": firebaseMessagingScope,
		"aud":   s.account.TokenURI,
		"iat":   now.Unix(),
		"exp":   now.Add(time.Hour).Unix(),
	}
	assertion := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	if s.account.PrivateKeyID != "" {
		assertion.Header["kid"] = s.account.PrivateKeyID
	}
	signed, err := assertion.SignedString(s.key)
	if err != nil {
		return "", fmt.Errorf("firebase credentials: sign assertion: %w", err)
	}
	form := url.Values{
		"grant_type": {"urn:ietf:params:oauth:grant-type:jwt-bearer"},
		"assertion":  {signed},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.account.TokenURI, strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("firebase credentials: build token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := s.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("firebase credentials: token exchange: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	rawResponse, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", fmt.Errorf("firebase credentials: read token response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("firebase credentials: token exchange HTTP %d", resp.StatusCode)
	}
	var result struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
		TokenType   string `json:"token_type"`
	}
	if err := json.Unmarshal(rawResponse, &result); err != nil {
		return "", fmt.Errorf("firebase credentials: decode token response: %w", err)
	}
	if strings.TrimSpace(result.AccessToken) == "" || result.ExpiresIn <= 0 || !strings.EqualFold(result.TokenType, "Bearer") {
		return "", errors.New("firebase credentials: invalid token response")
	}
	s.token = strings.TrimSpace(result.AccessToken)
	s.expires = now.Add(time.Duration(result.ExpiresIn) * time.Second)
	return s.token, nil
}

var _ TokenSource = (*GoogleServiceAccountTokenSource)(nil)
