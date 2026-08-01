package ratelimit

import (
	"context"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

func newTestLimiter(t *testing.T) *Limiter {
	t.Helper()

	addr := os.Getenv("REDIS_ADDR")
	if addr == "" {
		addr = "127.0.0.1:6379"
	}
	rdb := redis.NewClient(&redis.Options{Addr: addr, DB: 11})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		testsupport.SkipOrFail(t, "Redis", err)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = rdb.FlushDB(c).Err()
		_ = rdb.Close()
	})

	return New(rdb)
}

// The headline behaviour: the limit is a ceiling, not a suggestion.
func TestRequestsAreAllowedUpToTheLimitThenRefused(t *testing.T) {
	l := newTestLimiter(t)
	rule := Rule{Name: "t_basic", Limit: 3, Window: time.Minute}
	ctx := context.Background()

	for i := 1; i <= 3; i++ {
		d, err := l.Allow(ctx, rule, "1.2.3.4")
		if err != nil {
			t.Fatalf("attempt %d: %v", i, err)
		}
		if !d.Allowed {
			t.Fatalf("attempt %d was refused; the limit is 3", i)
		}
		if want := int64(3 - i); d.Remaining != want {
			t.Errorf("attempt %d: remaining = %d, want %d", i, d.Remaining, want)
		}
	}

	d, err := l.Allow(ctx, rule, "1.2.3.4")
	if err != nil {
		t.Fatalf("Allow: %v", err)
	}
	if d.Allowed {
		t.Fatal("the fourth attempt should have been refused")
	}
	if d.Remaining != 0 {
		t.Errorf("remaining = %d, want 0", d.Remaining)
	}
	// A refusal has to say when to come back, or the client guesses and
	// hammers.
	if d.RetryAfter <= 0 || d.RetryAfter > time.Minute {
		t.Errorf("retryAfter = %v, want something inside the window", d.RetryAfter)
	}
}

// One caller tripping a limit must not affect anyone else — otherwise a single
// abusive IP locks out every church on the platform.
func TestCallersAreLimitedIndependently(t *testing.T) {
	l := newTestLimiter(t)
	rule := Rule{Name: "t_isolated", Limit: 2, Window: time.Minute}
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		_, _ = l.Allow(ctx, rule, "abuser")
	}
	if d, _ := l.Allow(ctx, rule, "abuser"); d.Allowed {
		t.Fatal("the abusive caller should be refused")
	}

	d, err := l.Allow(ctx, rule, "someone-else")
	if err != nil {
		t.Fatalf("Allow: %v", err)
	}
	if !d.Allowed {
		t.Fatal("an unrelated caller must not be affected")
	}
}

// Two rules on the same caller must not share a counter, or the login limit
// would be consumed by OTP requests.
func TestRulesDoNotShareACounter(t *testing.T) {
	l := newTestLimiter(t)
	ctx := context.Background()
	first := Rule{Name: "t_a", Limit: 1, Window: time.Minute}
	second := Rule{Name: "t_b", Limit: 1, Window: time.Minute}

	if d, _ := l.Allow(ctx, first, "same-caller"); !d.Allowed {
		t.Fatal("the first rule's only request should be allowed")
	}
	if d, _ := l.Allow(ctx, first, "same-caller"); d.Allowed {
		t.Fatal("the first rule should now be exhausted")
	}
	if d, _ := l.Allow(ctx, second, "same-caller"); !d.Allowed {
		t.Fatal("a different rule must have its own allowance")
	}
}

// The allowance has to come back, or a limit is a permanent ban.
func TestTheWindowExpires(t *testing.T) {
	l := newTestLimiter(t)
	rule := Rule{Name: "t_window", Limit: 1, Window: 900 * time.Millisecond}
	ctx := context.Background()

	if d, _ := l.Allow(ctx, rule, "caller"); !d.Allowed {
		t.Fatal("the first request should be allowed")
	}
	if d, _ := l.Allow(ctx, rule, "caller"); d.Allowed {
		t.Fatal("the second should be refused inside the window")
	}

	time.Sleep(1100 * time.Millisecond)

	if d, _ := l.Allow(ctx, rule, "caller"); !d.Allowed {
		t.Fatal("the allowance should return once the window has passed")
	}
}

// The counter and its expiry are set in one script for a reason: INCR then
// EXPIRE is two commands, and dying between them leaves a key with no TTL,
// which turns the limiter into a permanent ban for that caller.
func TestTheCounterAlwaysGetsATTL(t *testing.T) {
	l := newTestLimiter(t)
	rule := Rule{Name: "t_ttl", Limit: 5, Window: 30 * time.Second}
	ctx := context.Background()

	d, err := l.Allow(ctx, rule, "caller")
	if err != nil {
		t.Fatalf("Allow: %v", err)
	}
	if d.RetryAfter <= 0 {
		t.Fatal("the very first request must already have set an expiry")
	}
	if d.RetryAfter > 30*time.Second {
		t.Errorf("retryAfter = %v, longer than the window", d.RetryAfter)
	}
}

// Concurrent requests must not slip past the ceiling. This is why the counter
// is in Redis and incremented atomically rather than read-then-written.
func TestConcurrentRequestsRespectTheLimit(t *testing.T) {
	l := newTestLimiter(t)
	rule := Rule{Name: "t_race", Limit: 10, Window: time.Minute}
	ctx := context.Background()

	const attempts = 50
	var mu sync.Mutex
	allowed := 0

	var wg sync.WaitGroup
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if d, err := l.Allow(ctx, rule, "racer"); err == nil && d.Allowed {
				mu.Lock()
				allowed++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()

	if allowed != 10 {
		t.Fatalf("%d of %d concurrent requests were allowed, want exactly the limit of 10",
			allowed, attempts)
	}
}

// A Redis outage must not lock every church out of the platform. Losing the
// ceiling temporarily is the lesser failure.
func TestRedisOutageAllowsTheRequest(t *testing.T) {
	unreachable := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1"})
	t.Cleanup(func() { _ = unreachable.Close() })
	l := New(unreachable)

	d, err := l.Allow(context.Background(),
		Rule{Name: "t_down", Limit: 1, Window: time.Minute}, "caller")
	if err == nil {
		t.Error("the outage should be reported so it can be logged")
	}
	if !d.Allowed {
		t.Fatal("a rate-limit cache outage must not refuse the request")
	}
}

// A limiter with no Redis at all behaves the same way.
func TestNilLimiterAllows(t *testing.T) {
	var l *Limiter
	d, err := l.Allow(context.Background(), Login, "caller")
	if err == nil {
		t.Error("want ErrNoLimiter so the caller can log it")
	}
	if !d.Allowed {
		t.Fatal("a nil limiter must not refuse requests")
	}
}

// A zero rule is a misconfiguration, not a block-everything.
func TestZeroRuleAllows(t *testing.T) {
	l := newTestLimiter(t)
	d, err := l.Allow(context.Background(), Rule{Name: "t_zero"}, "caller")
	if err != nil {
		t.Fatalf("Allow: %v", err)
	}
	if !d.Allowed {
		t.Fatal("an unconfigured rule must not refuse everything")
	}
}

func TestResetClearsTheCounter(t *testing.T) {
	l := newTestLimiter(t)
	rule := Rule{Name: "t_reset", Limit: 1, Window: time.Minute}
	ctx := context.Background()

	_, _ = l.Allow(ctx, rule, "caller")
	if d, _ := l.Allow(ctx, rule, "caller"); d.Allowed {
		t.Fatal("the caller should be exhausted")
	}
	if err := l.Reset(ctx, rule, "caller"); err != nil {
		t.Fatalf("Reset: %v", err)
	}
	if d, _ := l.Allow(ctx, rule, "caller"); !d.Allowed {
		t.Fatal("Reset should restore the allowance")
	}
}

// Every request from one host arrives on a different port, so keying on
// host:port gives each request its own bucket and limits nothing at all.
func TestIdentityDropsThePort(t *testing.T) {
	cases := []struct{ addr, want string }{
		{"1.2.3.4:54321", "1.2.3.4"},
		{"1.2.3.4:12345", "1.2.3.4"},
		{"[2001:db8::1]:443", "2001:db8::1"},
		{"1.2.3.4", "1.2.3.4"},
		{"", "unknown"},
	}
	for _, c := range cases {
		if got := IdentityFromAddr(c.addr); got != c.want {
			t.Errorf("IdentityFromAddr(%q) = %q, want %q", c.addr, got, c.want)
		}
	}
}

// Two requests from the same host on different ports must land in one bucket.
func TestSameHostDifferentPortsShareABucket(t *testing.T) {
	l := newTestLimiter(t)
	rule := Rule{Name: "t_ports", Limit: 1, Window: time.Minute}
	ctx := context.Background()

	if d, _ := l.Allow(ctx, rule, IdentityFromAddr("9.9.9.9:1111")); !d.Allowed {
		t.Fatal("the first request should be allowed")
	}
	if d, _ := l.Allow(ctx, rule, IdentityFromAddr("9.9.9.9:2222")); d.Allowed {
		t.Fatal("the same host on another port must share the bucket, or the " +
			"limiter counts nothing")
	}
}

// The configured policy should be sane rather than accidentally permissive.
func TestConfiguredRulesAreTight(t *testing.T) {
	for _, rule := range []Rule{Login, LoginPerAccount, RequestOTP, VerifyOTP, Register} {
		if rule.Limit <= 0 || rule.Window <= 0 {
			t.Errorf("%s is unconfigured: %+v", rule.Name, rule)
		}
		// An auth limit generous enough to work through a credential dump is
		// not a limit.
		if rule.Limit > 50 {
			t.Errorf("%s allows %d per window, which is not a meaningful ceiling "+
				"for an auth endpoint", rule.Name, rule.Limit)
		}
	}
	if Login.Name == LoginPerAccount.Name {
		t.Error("the per-IP and per-account login rules must not share a bucket")
	}
}

func BenchmarkAllow(b *testing.B) {
	addr := os.Getenv("REDIS_ADDR")
	if addr == "" {
		addr = "127.0.0.1:6379"
	}
	rdb := redis.NewClient(&redis.Options{Addr: addr, DB: 11})
	defer func() { _ = rdb.Close() }()

	l := New(rdb)
	rule := Rule{Name: "bench", Limit: 1 << 30, Window: time.Minute}
	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = l.Allow(ctx, rule, fmt.Sprintf("caller-%d", i%100))
	}
}
