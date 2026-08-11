package media

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// A grant is permission to connect to one room, in one role, for a while.
//
// Deliberately NOT the account's access token. The signalling endpoint is a
// WebSocket, and browsers cannot set an Authorization header on one — the token
// therefore travels in the query string, where it lands in proxy logs, browser
// history and anything watching a URL. A session token there would be an
// account takeover from a log file. This one buys exactly one thing: media for
// one service, for a few hours.
//
// It is also why the grant is issued by the API, which has already checked
// membership, tier entitlement and the viewer cap. By the time the SFU sees a
// grant, every one of those questions has been answered — the SFU's only job is
// to confirm we signed it.

// GrantClaims is what a grant asserts.
type GrantClaims struct {
	RoomID   string `json:"room"`
	Identity string `json:"sub"`
	Role     string `json:"role"`
	// ChurchID is carried so the signalling endpoint can confirm the room
	// belongs to the caller's church without a database read. A grant for
	// another church's service must not connect even if the room id is
	// guessed.
	ChurchID  string `json:"church"`
	ExpiresAt int64  `json:"exp"`
}

var (
	// ErrGrantInvalid means the token was not issued by us, or was altered.
	ErrGrantInvalid = errors.New("media: that grant is not valid")
	// ErrGrantExpired means the grant has run out.
	ErrGrantExpired = errors.New("media: that grant has expired")
	// ErrNoSigningKey means no key was configured to sign grants with.
	ErrNoSigningKey = errors.New("media: no signing key is configured for live grants")
)

// GrantSigner issues and verifies room grants.
type GrantSigner struct {
	key []byte
	now func() time.Time
}

// NewGrantSigner builds a signer.
//
// An empty key is an ERROR rather than a signer that produces unsigned tokens.
// The alternative — degrading quietly — is a live endpoint anyone can connect
// to by inventing a room id, and it would look exactly like a working system.
func NewGrantSigner(key string) (*GrantSigner, error) {
	if strings.TrimSpace(key) == "" {
		return nil, ErrNoSigningKey
	}
	sum := sha256.Sum256([]byte(key))
	return &GrantSigner{key: sum[:], now: time.Now}, nil
}

// Sign issues a grant.
func (g *GrantSigner) Sign(claims GrantClaims) (string, error) {
	body, err := json.Marshal(claims)
	if err != nil {
		return "", fmt.Errorf("media: encode grant: %w", err)
	}
	payload := base64.RawURLEncoding.EncodeToString(body)
	return payload + "." + g.mac(payload), nil
}

// Verify checks a grant and returns what it asserts.
func (g *GrantSigner) Verify(token string) (*GrantClaims, error) {
	payload, sig, found := strings.Cut(token, ".")
	if !found || payload == "" || sig == "" {
		return nil, ErrGrantInvalid
	}
	// Constant time: a byte-by-byte comparison leaks how much of a forged
	// signature was right, which is enough to construct one given attempts.
	if !hmac.Equal([]byte(sig), []byte(g.mac(payload))) {
		return nil, ErrGrantInvalid
	}

	body, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return nil, ErrGrantInvalid
	}
	var claims GrantClaims
	if err := json.Unmarshal(body, &claims); err != nil {
		return nil, ErrGrantInvalid
	}

	// Expiry is checked AFTER the signature. Checking it first would answer
	// "is this expired" for tokens we never issued, which tells a forger their
	// payload parsed.
	if claims.ExpiresAt > 0 && g.now().Unix() >= claims.ExpiresAt {
		return nil, ErrGrantExpired
	}
	if claims.RoomID == "" || claims.Identity == "" {
		return nil, ErrGrantInvalid
	}
	return &claims, nil
}

func (g *GrantSigner) mac(payload string) string {
	m := hmac.New(sha256.New, g.key)
	m.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}
