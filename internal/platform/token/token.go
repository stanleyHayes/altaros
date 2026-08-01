// Package token issues and verifies JWTs, with revocation (WP-10).
//
// Two things the TypeScript implementation this replaces did not do, both
// required by WP-10's acceptance ("expired and revoked tokens rejected"):
//
//  1. Revocation. The old refreshToken() re-issued a pair from any valid
//     refresh token and had no way to invalidate one, so a stolen token
//     worked until it expired — up to 30 days. Every token here carries a
//     JTI and is checked against a Redis denylist.
//
//  2. Refresh rotation. Refreshing now issues a new refresh token and revokes
//     the one presented, so a refresh token is single-use. If an old one is
//     presented again that is evidence of theft, and the whole family is
//     revoked rather than just the replayed token.
package token

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
)

// Kind distinguishes an access token from a refresh token. Without it, an
// access token could be presented to the refresh endpoint and vice versa.
type Kind string

const (
	KindAccess  Kind = "access"
	KindRefresh Kind = "refresh"
)

var (
	// ErrInvalid covers malformed, wrongly-signed, and expired tokens. The
	// distinction is deliberately not surfaced to callers: telling an attacker
	// "correct signature but expired" is more information than they need.
	ErrInvalid = errors.New("token: invalid or expired")
	// ErrRevoked means the token was valid but has been explicitly revoked.
	ErrRevoked = errors.New("token: revoked")
	// ErrWrongKind means an access token was used where a refresh token was
	// required, or vice versa.
	ErrWrongKind = errors.New("token: wrong token kind")
)

// Claims is the payload carried in every token.
type Claims struct {
	UserID   string `json:"uid"`
	ChurchID string `json:"cid"`
	// OrganizationID lets an org-level admin act across branches without a
	// second lookup on every request.
	OrganizationID string `json:"oid,omitempty"`
	Role           string `json:"role"`
	Kind           Kind   `json:"knd"`
	// Family ties a refresh token to the login it descended from, so detecting
	// a replayed token can revoke every descendant rather than just that one.
	Family string `json:"fam,omitempty"`

	jwt.RegisteredClaims
}

// Pair is an access + refresh token issued together.
type Pair struct {
	AccessToken  string    `json:"accessToken"`
	RefreshToken string    `json:"refreshToken"`
	ExpiresAt    time.Time `json:"expiresAt"`
}

// Issuer mints and validates tokens.
type Issuer struct {
	secret     []byte
	issuer     string
	accessTTL  time.Duration
	refreshTTL time.Duration
	redis      *redis.Client
	now        func() time.Time
}

// Options configures an Issuer.
type Options struct {
	Secret     string
	Issuer     string
	AccessTTL  time.Duration
	RefreshTTL time.Duration
	Redis      *redis.Client
	// Now is injectable so expiry can be tested without sleeping.
	Now func() time.Time
}

// NewIssuer builds an Issuer. Redis is required: without it there is no
// revocation, and a system that cannot revoke a token should not pretend to.
func NewIssuer(opts Options) (*Issuer, error) {
	if opts.Secret == "" {
		return nil, errors.New("token: secret is required")
	}
	if opts.Redis == nil {
		return nil, errors.New("token: redis is required for revocation")
	}
	if opts.AccessTTL <= 0 {
		opts.AccessTTL = 15 * time.Minute
	}
	if opts.RefreshTTL <= 0 {
		opts.RefreshTTL = 30 * 24 * time.Hour
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	return &Issuer{
		secret:     []byte(opts.Secret),
		issuer:     opts.Issuer,
		accessTTL:  opts.AccessTTL,
		refreshTTL: opts.RefreshTTL,
		redis:      opts.Redis,
		now:        opts.Now,
	}, nil
}

// Identity is who a token is being issued for.
type Identity struct {
	UserID         string
	ChurchID       string
	OrganizationID string
	Role           string
}

// Issue mints a fresh access/refresh pair for a new login.
func (i *Issuer) Issue(ctx context.Context, id Identity) (*Pair, error) {
	return i.issuePair(ctx, id, newID())
}

func (i *Issuer) issuePair(ctx context.Context, id Identity, family string) (*Pair, error) {
	now := i.now().UTC()

	access, err := i.sign(id, KindAccess, family, now, i.accessTTL)
	if err != nil {
		return nil, err
	}
	refresh, err := i.sign(id, KindRefresh, family, now, i.refreshTTL)
	if err != nil {
		return nil, err
	}

	return &Pair{
		AccessToken:  access,
		RefreshToken: refresh,
		ExpiresAt:    now.Add(i.accessTTL),
	}, nil
}

func (i *Issuer) sign(id Identity, kind Kind, family string, now time.Time, ttl time.Duration) (string, error) {
	claims := Claims{
		UserID:         id.UserID,
		ChurchID:       id.ChurchID,
		OrganizationID: id.OrganizationID,
		Role:           id.Role,
		Kind:           kind,
		Family:         family,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        newID(),
			Issuer:    i.issuer,
			Subject:   id.UserID,
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
	}

	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(i.secret)
	if err != nil {
		return "", fmt.Errorf("token: sign %s: %w", kind, err)
	}
	return signed, nil
}

// Verify parses a token, checks its signature and expiry, confirms it is the
// expected kind, and rejects it if it or its family has been revoked.
func (i *Issuer) Verify(ctx context.Context, raw string, want Kind) (*Claims, error) {
	var claims Claims

	_, err := jwt.ParseWithClaims(raw, &claims, func(t *jwt.Token) (any, error) {
		// Reject anything not signed with the expected algorithm. Without
		// this check a token with alg=none would be accepted.
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method %v", t.Header["alg"])
		}
		return i.secret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	if err != nil {
		return nil, ErrInvalid
	}

	if claims.Kind != want {
		return nil, ErrWrongKind
	}

	revoked, err := i.isRevoked(ctx, &claims)
	if err != nil {
		// Fail closed: if the denylist cannot be reached, treat the token as
		// unusable rather than assume it is fine. An outage must not silently
		// re-enable revoked credentials.
		return nil, fmt.Errorf("token: revocation check failed: %w", err)
	}
	if revoked {
		return nil, ErrRevoked
	}

	return &claims, nil
}

// ConsumeRefresh validates and burns a refresh token, returning its claims.
//
// Split from issuing deliberately. A caller needs the claims to re-read the
// user (so a role change or deactivation takes effect at refresh) before
// minting new tokens — but if the caller verifies the token itself first, the
// replay-detection below never runs. That exact mistake made theft detection
// dead code in the HTTP path: the service called Verify(), got ErrRevoked, and
// returned before reaching the family revocation.
//
// Presenting an already-burned refresh token means a replay or a stolen token,
// so the whole family is revoked — the legitimate user is logged out
// everywhere rather than sharing a live session with an attacker.
func (i *Issuer) ConsumeRefresh(ctx context.Context, raw string) (*Claims, error) {
	var claims Claims
	_, parseErr := jwt.ParseWithClaims(raw, &claims, func(t *jwt.Token) (any, error) {
		return i.secret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	if parseErr != nil {
		return nil, ErrInvalid
	}
	if claims.Kind != KindRefresh {
		return nil, ErrWrongKind
	}

	revoked, err := i.isRevoked(ctx, &claims)
	if err != nil {
		return nil, fmt.Errorf("token: revocation check failed: %w", err)
	}
	if revoked {
		if ferr := i.RevokeFamily(ctx, claims.Family, i.refreshTTL); ferr != nil {
			return nil, fmt.Errorf("token: revoke family after replay: %w", ferr)
		}
		return nil, ErrRevoked
	}

	// Burn it: a refresh token is single-use.
	if err := i.revokeJTI(ctx, claims.ID, i.refreshTTL); err != nil {
		return nil, fmt.Errorf("token: rotate: %w", err)
	}
	return &claims, nil
}

// IssueInFamily mints a new pair that continues an existing login, so a
// session's whole token lineage can still be revoked in one operation.
func (i *Issuer) IssueInFamily(ctx context.Context, id Identity, family string) (*Pair, error) {
	if family == "" {
		family = newID()
	}
	return i.issuePair(ctx, id, family)
}

// Refresh rotates a refresh token in one step, for callers that do not need to
// re-read the user in between.
func (i *Issuer) Refresh(ctx context.Context, raw string, id Identity) (*Pair, error) {
	claims, err := i.ConsumeRefresh(ctx, raw)
	if err != nil {
		return nil, err
	}
	return i.issuePair(ctx, id, claims.Family)
}

// Revoke invalidates a single token.
func (i *Issuer) Revoke(ctx context.Context, raw string) error {
	var claims Claims
	if _, err := jwt.ParseWithClaims(raw, &claims, func(t *jwt.Token) (any, error) {
		return i.secret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()})); err != nil {
		// An unparseable token cannot be revoked, but it also cannot be used,
		// so this is not an error worth propagating to a logout handler.
		return nil
	}

	ttl := i.refreshTTL
	if claims.ExpiresAt != nil {
		if remaining := time.Until(claims.ExpiresAt.Time); remaining > 0 {
			// Only need to remember the revocation until it would expire.
			ttl = remaining
		}
	}
	return i.revokeJTI(ctx, claims.ID, ttl)
}

// RevokeFamily invalidates every token descended from one login. Used on
// logout-everywhere, password change, and detected refresh replay.
func (i *Issuer) RevokeFamily(ctx context.Context, family string, ttl time.Duration) error {
	if family == "" {
		return nil
	}
	if err := i.redis.Set(ctx, familyKey(family), "1", ttl).Err(); err != nil {
		return fmt.Errorf("token: revoke family: %w", err)
	}
	return nil
}

func (i *Issuer) revokeJTI(ctx context.Context, jti string, ttl time.Duration) error {
	if jti == "" {
		return errors.New("token: cannot revoke a token with no id")
	}
	if ttl <= 0 {
		ttl = time.Minute
	}
	return i.redis.Set(ctx, jtiKey(jti), "1", ttl).Err()
}

func (i *Issuer) isRevoked(ctx context.Context, c *Claims) (bool, error) {
	keys := []string{jtiKey(c.ID)}
	if c.Family != "" {
		keys = append(keys, familyKey(c.Family))
	}
	n, err := i.redis.Exists(ctx, keys...).Result()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

func jtiKey(jti string) string       { return "revoked:jti:" + jti }
func familyKey(family string) string { return "revoked:fam:" + family }
