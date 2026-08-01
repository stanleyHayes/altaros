package token

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func newIssuer(t *testing.T, mutate func(*Options)) *Issuer {
	t.Helper()

	addr := os.Getenv("REDIS_ADDR")
	if addr == "" {
		addr = "127.0.0.1:6379"
	}

	// A dedicated Redis DB so tests never touch development sessions.
	rdb := redis.NewClient(&redis.Options{Addr: addr, DB: 15})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Skipf("Redis unavailable at %s (run `make infra-up`): %v", addr, err)
	}
	if err := rdb.FlushDB(ctx).Err(); err != nil {
		t.Fatalf("flush test db: %v", err)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = rdb.FlushDB(c)
		_ = rdb.Close()
	})

	opts := Options{
		Secret:     "test-secret-not-for-deployment",
		Issuer:     "altar-os-test",
		AccessTTL:  15 * time.Minute,
		RefreshTTL: 30 * 24 * time.Hour,
		Redis:      rdb,
	}
	if mutate != nil {
		mutate(&opts)
	}

	iss, err := NewIssuer(opts)
	if err != nil {
		t.Fatalf("NewIssuer: %v", err)
	}
	return iss
}

var testIdentity = Identity{
	UserID:         "user_1",
	ChurchID:       "church_1",
	OrganizationID: "org_1",
	Role:           "CHURCH_ADMIN",
}

func TestIssueAndVerify(t *testing.T) {
	iss := newIssuer(t, nil)
	ctx := context.Background()

	pair, err := iss.Issue(ctx, testIdentity)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}

	claims, err := iss.Verify(ctx, pair.AccessToken, KindAccess)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if claims.UserID != "user_1" || claims.ChurchID != "church_1" {
		t.Errorf("claims did not round-trip: %+v", claims)
	}
	if claims.OrganizationID != "org_1" {
		t.Error("organization should be carried so org admins need no extra lookup")
	}
	if claims.Role != "CHURCH_ADMIN" {
		t.Errorf("role: got %s", claims.Role)
	}
}

// An access token must not be usable where a refresh token is required, or
// a 15-minute credential would work for 30 days.
func TestAccessTokenRejectedAsRefresh(t *testing.T) {
	iss := newIssuer(t, nil)
	ctx := context.Background()

	pair, _ := iss.Issue(ctx, testIdentity)

	if _, err := iss.Verify(ctx, pair.AccessToken, KindRefresh); !errors.Is(err, ErrWrongKind) {
		t.Fatalf("want ErrWrongKind, got %v", err)
	}
	if _, err := iss.Verify(ctx, pair.RefreshToken, KindAccess); !errors.Is(err, ErrWrongKind) {
		t.Fatalf("refresh token must not work as an access token, got %v", err)
	}
}

// WP-10 acceptance: expired tokens rejected.
func TestExpiredTokenRejected(t *testing.T) {
	past := time.Now().Add(-2 * time.Hour)
	iss := newIssuer(t, func(o *Options) {
		o.AccessTTL = time.Minute
		o.Now = func() time.Time { return past } // issued two hours ago
	})
	ctx := context.Background()

	pair, err := iss.Issue(ctx, testIdentity)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}

	if _, err := iss.Verify(ctx, pair.AccessToken, KindAccess); !errors.Is(err, ErrInvalid) {
		t.Fatalf("an expired token must be rejected, got %v", err)
	}
}

// WP-10 acceptance: revoked tokens rejected.
func TestRevokedTokenRejected(t *testing.T) {
	iss := newIssuer(t, nil)
	ctx := context.Background()

	pair, _ := iss.Issue(ctx, testIdentity)

	if _, err := iss.Verify(ctx, pair.AccessToken, KindAccess); err != nil {
		t.Fatalf("token should be valid before revocation: %v", err)
	}

	if err := iss.Revoke(ctx, pair.AccessToken); err != nil {
		t.Fatalf("Revoke: %v", err)
	}

	if _, err := iss.Verify(ctx, pair.AccessToken, KindAccess); !errors.Is(err, ErrRevoked) {
		t.Fatalf("want ErrRevoked, got %v", err)
	}
}

// Refresh must rotate: the presented token becomes unusable.
func TestRefreshRotatesToken(t *testing.T) {
	iss := newIssuer(t, nil)
	ctx := context.Background()

	first, _ := iss.Issue(ctx, testIdentity)

	second, err := iss.Refresh(ctx, first.RefreshToken, testIdentity)
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	if second.RefreshToken == first.RefreshToken {
		t.Fatal("refresh must issue a new refresh token, not return the same one")
	}

	// The new one works.
	if _, err := iss.Verify(ctx, second.AccessToken, KindAccess); err != nil {
		t.Errorf("rotated access token should be valid: %v", err)
	}
}

// Replaying a rotated refresh token is evidence of theft: the whole family is
// revoked, not just the replayed token.
func TestRefreshReplayRevokesWholeFamily(t *testing.T) {
	iss := newIssuer(t, nil)
	ctx := context.Background()

	first, _ := iss.Issue(ctx, testIdentity)
	second, err := iss.Refresh(ctx, first.RefreshToken, testIdentity)
	if err != nil {
		t.Fatalf("first refresh: %v", err)
	}

	// An attacker replays the original refresh token.
	if _, err := iss.Refresh(ctx, first.RefreshToken, testIdentity); !errors.Is(err, ErrRevoked) {
		t.Fatalf("replayed refresh token must be refused, got %v", err)
	}

	// The legitimate user's current tokens are revoked too — they are logged
	// out everywhere rather than sharing a session with the attacker.
	if _, err := iss.Verify(ctx, second.AccessToken, KindAccess); !errors.Is(err, ErrRevoked) {
		t.Fatalf("family revocation should invalidate the current token, got %v", err)
	}
}

// Logout-everywhere and password change rely on family revocation.
func TestRevokeFamilyInvalidatesAllDescendants(t *testing.T) {
	iss := newIssuer(t, nil)
	ctx := context.Background()

	pair, _ := iss.Issue(ctx, testIdentity)
	claims, err := iss.Verify(ctx, pair.AccessToken, KindAccess)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}

	if err := iss.RevokeFamily(ctx, claims.Family, time.Hour); err != nil {
		t.Fatalf("RevokeFamily: %v", err)
	}

	if _, err := iss.Verify(ctx, pair.AccessToken, KindAccess); !errors.Is(err, ErrRevoked) {
		t.Errorf("access token should be revoked with its family, got %v", err)
	}
	if _, err := iss.Verify(ctx, pair.RefreshToken, KindRefresh); !errors.Is(err, ErrRevoked) {
		t.Errorf("refresh token should be revoked with its family, got %v", err)
	}
}

// A token signed with a different secret must never verify.
func TestForeignSignatureRejected(t *testing.T) {
	iss := newIssuer(t, nil)
	other := newIssuer(t, func(o *Options) { o.Secret = "a-completely-different-secret" })
	ctx := context.Background()

	pair, _ := other.Issue(ctx, testIdentity)

	if _, err := iss.Verify(ctx, pair.AccessToken, KindAccess); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a token signed with another secret must be rejected, got %v", err)
	}
}

// alg=none is the classic JWT bypass; it must not be accepted.
func TestUnsignedTokenRejected(t *testing.T) {
	iss := newIssuer(t, nil)
	ctx := context.Background()

	// header {"alg":"none","typ":"JWT"} . payload . (empty signature)
	unsigned := "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0." +
		"eyJ1aWQiOiJ1c2VyXzEiLCJjaWQiOiJjaHVyY2hfMSIsInJvbGUiOiJTVVBFUl9BRE1JTiIsImtuZCI6ImFjY2VzcyJ9."

	if _, err := iss.Verify(ctx, unsigned, KindAccess); err == nil {
		t.Fatal("an alg=none token must never be accepted")
	}
}

func TestGarbageTokenRejected(t *testing.T) {
	iss := newIssuer(t, nil)
	ctx := context.Background()

	for _, raw := range []string{"", "not-a-jwt", "a.b.c"} {
		if _, err := iss.Verify(ctx, raw, KindAccess); !errors.Is(err, ErrInvalid) {
			t.Errorf("%q should be ErrInvalid, got %v", raw, err)
		}
	}
}

// An Issuer without Redis cannot revoke, so it must not be constructible —
// a system that silently cannot revoke is worse than one that refuses to boot.
func TestIssuerRequiresRedis(t *testing.T) {
	if _, err := NewIssuer(Options{Secret: "s"}); err == nil {
		t.Fatal("NewIssuer must refuse to build without Redis")
	}
	if _, err := NewIssuer(Options{Redis: redis.NewClient(&redis.Options{})}); err == nil {
		t.Fatal("NewIssuer must refuse to build without a secret")
	}
}

// The migration shim: while the gateway forwards unported routes to the
// TypeScript API, one token must authenticate against both. The TypeScript
// middleware reads `id` and `churchId`, so an access token has to carry them
// alongside Go's own `uid` and `cid`.
func TestAccessTokenCarriesLegacyClaims(t *testing.T) {
	issuer := newIssuer(t, nil)

	pair, err := issuer.Issue(context.Background(), Identity{
		UserID:   "user_1",
		ChurchID: "church_1",
		Role:     "CHURCH_ADMIN",
	})
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}

	claims, err := issuer.Verify(context.Background(), pair.AccessToken, KindAccess)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if claims.LegacyUserID != "user_1" {
		t.Errorf("legacy id = %q, want user_1; the TypeScript middleware reads this",
			claims.LegacyUserID)
	}
	if claims.LegacyChurchID != "church_1" {
		t.Errorf("legacy churchId = %q, want church_1", claims.LegacyChurchID)
	}
	// They must agree with the canonical claims, or the two APIs would
	// disagree about who is calling.
	if claims.LegacyUserID != claims.UserID || claims.LegacyChurchID != claims.ChurchID {
		t.Error("the legacy claims must mirror the canonical ones exactly")
	}
}

// A refresh token must NOT carry them. The TypeScript API never sees one, and
// putting identity into it would widen what a stolen refresh token can do.
func TestRefreshTokenOmitsLegacyClaims(t *testing.T) {
	issuer := newIssuer(t, nil)

	pair, err := issuer.Issue(context.Background(), Identity{
		UserID: "user_1", ChurchID: "church_1", Role: "MEMBER",
	})
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}

	claims, err := issuer.Verify(context.Background(), pair.RefreshToken, KindRefresh)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if claims.LegacyUserID != "" || claims.LegacyChurchID != "" {
		t.Errorf("a refresh token must not carry legacy identity claims, got id=%q churchId=%q",
			claims.LegacyUserID, claims.LegacyChurchID)
	}
	// The canonical claims are still there — the refresh token still knows
	// whose it is, it just does not advertise it to the legacy API.
	if claims.UserID != "user_1" {
		t.Errorf("uid = %q, want user_1", claims.UserID)
	}
}
