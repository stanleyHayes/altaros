// Package ratelimit throttles requests across replicas.
//
// Nothing on the HTTP layer was throttled at all, which left three distinct
// exposures:
//
//   - Password login had no limit. Unlimited attempts against a platform
//     holding giving records is credential stuffing with no ceiling — and
//     bcrypt makes it worse rather than better. Each attempt costs ~100ms of
//     CPU by design, so unthrottled login is also a cheap denial of service:
//     a few hundred concurrent attempts saturate the pod before any of them
//     succeed.
//   - request-otp is throttled per phone number (60s, WP-10) but not per
//     caller, so one attacker cycling through numbers sends unlimited SMS.
//     Every one of those costs real money at Africa's Talking.
//   - The public church-slug lookup can be dictionary-attacked to enumerate
//     every church on the platform — the exact concern §11.2 raises about the
//     login form, on an endpoint that needs no credentials at all.
//
// The counter lives in Redis rather than in memory because the deployment runs
// several replicas (WP-18 sets replicas: 3). An in-memory limiter divides the
// effective limit by the replica count and resets on every deploy, which is
// the kind of protection that reads as present and is not.
package ratelimit

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// keyPrefix follows the codebase's Redis convention of namespace:purpose:id,
// matching otp:code:<phone> and revoked:jti:<jti>.
const keyPrefix = "ratelimit:"

// ErrNoLimiter means the limiter was built without Redis.
var ErrNoLimiter = errors.New("ratelimit: no redis client")

// Rule is one limit.
type Rule struct {
	// Name identifies the bucket, so two rules on the same caller do not share
	// a counter.
	Name string
	// Limit is how many requests are allowed per window.
	Limit int64
	// Window is how long the allowance lasts.
	Window time.Duration
}

// Decision is the outcome of a check.
type Decision struct {
	Allowed bool
	// Remaining is how many requests are left in this window.
	Remaining int64
	// RetryAfter is how long until the window resets. Only meaningful when
	// the request was denied.
	RetryAfter time.Duration
}

// Limiter counts requests in Redis.
type Limiter struct {
	redis *redis.Client
}

// New builds a limiter.
func New(rdb *redis.Client) *Limiter { return &Limiter{redis: rdb} }

// incrementAndExpire counts one hit and sets the expiry in a single round trip.
//
// A Lua script rather than INCR followed by EXPIRE: those are two commands,
// and a process that dies between them leaves a key with no TTL — which then
// blocks that caller forever, turning a rate limiter into a permanent ban.
// The script also returns the remaining TTL, so a denied caller can be told
// when to come back rather than guessing.
var incrementAndExpire = redis.NewScript(`
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return {current, redis.call("PTTL", KEYS[1])}
`)

// Allow records one request against a rule and reports whether it may proceed.
//
// A Redis failure ALLOWS the request. That is deliberate and it is the same
// call the deduper makes: refusing every login because the rate-limit cache is
// unreachable would lock every church out of the platform over a cache outage,
// which is a worse outcome than temporarily losing the ceiling. The caller
// logs it so the gap is visible rather than assumed.
func (l *Limiter) Allow(ctx context.Context, rule Rule, identity string) (Decision, error) {
	if l == nil || l.redis == nil {
		return Decision{Allowed: true}, ErrNoLimiter
	}
	if rule.Limit <= 0 || rule.Window <= 0 {
		return Decision{Allowed: true}, nil
	}

	key := keyPrefix + rule.Name + ":" + identity
	res, err := incrementAndExpire.Run(ctx, l.redis, []string{key},
		rule.Window.Milliseconds()).Slice()
	if err != nil {
		return Decision{Allowed: true}, fmt.Errorf("ratelimit: %w", err)
	}
	if len(res) != 2 {
		return Decision{Allowed: true}, fmt.Errorf("ratelimit: unexpected script result")
	}

	count, _ := res[0].(int64)
	ttlMillis, _ := res[1].(int64)

	retryAfter := time.Duration(ttlMillis) * time.Millisecond
	if ttlMillis < 0 {
		// No TTL yet, which should not happen given the script — fall back to
		// the full window rather than telling the caller to retry immediately.
		retryAfter = rule.Window
	}

	remaining := rule.Limit - count
	if remaining < 0 {
		remaining = 0
	}

	return Decision{
		Allowed:    count <= rule.Limit,
		Remaining:  remaining,
		RetryAfter: retryAfter,
	}, nil
}

// Reset clears a caller's counter. For tests, and for an operator unblocking
// someone who tripped a limit legitimately.
func (l *Limiter) Reset(ctx context.Context, rule Rule, identity string) error {
	if l == nil || l.redis == nil {
		return ErrNoLimiter
	}
	return l.redis.Del(ctx, keyPrefix+rule.Name+":"+identity).Err()
}

// The rules the platform applies. Named here rather than at each call site so
// the whole policy is readable in one place.
var (
	// Login is deliberately tight. A person signs in a handful of times a day;
	// ten attempts in fifteen minutes is generous for someone who has forgotten
	// which password they used and useless for working through a credential
	// dump. It is keyed by IP AND separately by account, because either alone
	// is trivially evaded: per-IP misses a distributed attack on one account,
	// per-account misses one host spraying many accounts.
	Login = Rule{Name: "login", Limit: 10, Window: 15 * time.Minute}

	// LoginPerAccount is the second half of that pair.
	LoginPerAccount = Rule{Name: "login_account", Limit: 10, Window: 15 * time.Minute}

	// RequestOTP costs real money per call. The domain already throttles one
	// phone number to a code a minute (WP-10); this stops one caller cycling
	// through many numbers, which that throttle cannot see.
	RequestOTP = Rule{Name: "request_otp", Limit: 5, Window: 10 * time.Minute}

	// VerifyOTP guards against brute-forcing a six-digit code from many
	// addresses. The domain counts attempts per phone (5, WP-10); this is the
	// per-caller half.
	VerifyOTP = Rule{Name: "verify_otp", Limit: 15, Window: 10 * time.Minute}

	// PublicLookup covers unauthenticated endpoints that resolve a name to an
	// id — currently the church-slug lookup. Generous enough for a person
	// mistyping their church code, tight enough that enumerating the customer
	// list by dictionary attack is not free.
	PublicLookup = Rule{Name: "public_lookup", Limit: 30, Window: time.Minute}

	// Register creates accounts. Unlimited registration is how a church's
	// member list fills with junk and how an attacker maps which emails are
	// already taken.
	Register = Rule{Name: "register", Limit: 5, Window: time.Hour}

	// Write covers authenticated mutations. Not a security boundary so much as
	// a guard against a runaway client loop taking the database with it.
	Write = Rule{Name: "write", Limit: 120, Window: time.Minute}
)

// IdentityFromAddr reduces a remote address to a rate-limit identity.
//
// The port is stripped, because every request from one host arrives on a
// different one — keying on host:port gives each request its own bucket and
// limits nothing.
func IdentityFromAddr(addr string) string {
	if addr == "" {
		return "unknown"
	}
	// IPv6 addresses are bracketed, so cut at the LAST colon.
	if i := strings.LastIndex(addr, ":"); i != -1 {
		host := addr[:i]
		if strings.HasPrefix(host, "[") && strings.HasSuffix(host, "]") {
			host = host[1 : len(host)-1]
		}
		if host != "" {
			return host
		}
	}
	return addr
}
