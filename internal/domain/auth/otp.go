package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// OTP is the primary login method for this market: mobile money is the default
// payment rail, phone numbers are the identity most members actually have, and
// many will never set a password.
//
// The TypeScript implementation returned 501 for both requestOTP and verifyOTP,
// so this is new rather than a port.
//
// Security properties, each of which matters for a 6-digit secret:
//
//   - Codes are stored as a SHA-256 hash. A dump of Redis must not hand an
//     attacker every in-flight login code.
//   - Comparison is constant-time, so response timing does not leak a prefix.
//   - Attempts are capped. 6 digits is a million combinations; without a cap
//     an attacker walks that space in minutes.
//   - Codes are single-use and short-lived, and requests are rate-limited per
//     phone number so the endpoint cannot be used to bulk-send SMS at the
//     church's expense.
const (
	otpLength      = 6
	otpTTL         = 5 * time.Minute
	otpMaxAttempts = 5
	// otpResendWindow throttles how often a new code can be requested for the
	// same number. SMS costs real money on every provider.
	otpResendWindow = 60 * time.Second
)

var (
	// ErrOTPNotFound means no code is outstanding: never requested, already
	// used, or expired.
	ErrOTPNotFound = errors.New("auth: no verification code outstanding")
	// ErrOTPIncorrect means the code did not match.
	ErrOTPIncorrect = errors.New("auth: incorrect verification code")
	// ErrOTPTooManyAttempts means the code was burned by repeated failures.
	ErrOTPTooManyAttempts = errors.New("auth: too many incorrect attempts, request a new code")
	// ErrOTPTooSoon means a code was requested again inside the resend window.
	ErrOTPTooSoon = errors.New("auth: a code was just sent, please wait before requesting another")
)

// otpStore keeps pending codes in Redis.
type otpStore struct {
	redis *redis.Client
}

// Keys are namespaced by CHURCH as well as by number (WP-35).
//
// One person may hold an account in two churches with the same phone number.
// Keyed on the number alone, they have one outstanding code between them, a
// second request inside the resend window is refused as a duplicate, and a code
// issued for one church verifies a sign-in to the other. The namespace is what
// keeps the two sign-ins separate.
//
// An empty churchID keeps the old key shape, so codes already in flight during
// a deploy still verify instead of every member in the middle of signing in
// being told their code is wrong.
func otpNamespace(churchID, phone string) string {
	if churchID == "" {
		return phone
	}
	return churchID + ":" + phone
}

func otpKey(churchID, phone string) string {
	return "otp:code:" + otpNamespace(churchID, phone)
}

func otpAttemptKey(churchID, phone string) string {
	return "otp:attempts:" + otpNamespace(churchID, phone)
}

func otpResendKey(churchID, phone string) string {
	return "otp:resend:" + otpNamespace(churchID, phone)
}

// generateCode returns a cryptographically random numeric code.
//
// math/rand would make codes predictable from one observed code; for a
// credential that grants account access that is not acceptable.
func generateCode() (string, error) {
	max := big.NewInt(1)
	for i := 0; i < otpLength; i++ {
		max.Mul(max, big.NewInt(10))
	}
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		return "", fmt.Errorf("auth: generate code: %w", err)
	}
	// Zero-pad so every code is exactly otpLength digits; "042931" must not
	// become "42931".
	return fmt.Sprintf("%0*d", otpLength, n), nil
}

func hashCode(code string) string {
	sum := sha256.Sum256([]byte(code))
	return hex.EncodeToString(sum[:])
}

// issue creates and stores a new code, returning the plaintext for delivery.
// The plaintext is never persisted.
func (s *otpStore) issue(ctx context.Context, churchID, phone string) (string, error) {
	// Throttle resends before doing any work.
	ok, err := s.redis.SetNX(ctx, otpResendKey(churchID, phone), "1", otpResendWindow).Result()
	if err != nil {
		return "", fmt.Errorf("auth: otp resend check: %w", err)
	}
	if !ok {
		return "", ErrOTPTooSoon
	}

	code, err := generateCode()
	if err != nil {
		return "", err
	}

	pipe := s.redis.TxPipeline()
	pipe.Set(ctx, otpKey(churchID, phone), hashCode(code), otpTTL)
	// Reset the attempt counter so a previous failed code does not burn the
	// new one.
	pipe.Del(ctx, otpAttemptKey(churchID, phone))
	if _, err := pipe.Exec(ctx); err != nil {
		return "", fmt.Errorf("auth: store otp: %w", err)
	}

	return code, nil
}

// verify checks a submitted code, consuming it on success.
func (s *otpStore) verify(ctx context.Context, churchID, phone, submitted string) error {
	stored, err := s.redis.Get(ctx, otpKey(churchID, phone)).Result()
	if errors.Is(err, redis.Nil) {
		return ErrOTPNotFound
	}
	if err != nil {
		return fmt.Errorf("auth: read otp: %w", err)
	}

	// Count the attempt before comparing, so a crash mid-verify cannot be used
	// to get free guesses.
	attempts, err := s.redis.Incr(ctx, otpAttemptKey(churchID, phone)).Result()
	if err != nil {
		return fmt.Errorf("auth: count otp attempt: %w", err)
	}
	if attempts == 1 {
		// Expire the counter with the code so it cannot outlive it.
		s.redis.Expire(ctx, otpAttemptKey(churchID, phone), otpTTL)
	}
	if attempts > otpMaxAttempts {
		s.clear(ctx, churchID, phone)
		return ErrOTPTooManyAttempts
	}

	// Constant-time: a byte-by-byte comparison leaks how much of the code was
	// correct through response timing.
	if subtle.ConstantTimeCompare([]byte(stored), []byte(hashCode(submitted))) != 1 {
		return ErrOTPIncorrect
	}

	// Single use.
	s.clear(ctx, churchID, phone)
	return nil
}

func (s *otpStore) clear(ctx context.Context, churchID, phone string) {
	s.redis.Del(ctx, otpKey(churchID, phone), otpAttemptKey(churchID, phone))
}

// remainingAttempts is exposed for surfacing "2 attempts left" in the UI.
func (s *otpStore) remainingAttempts(ctx context.Context, churchID, phone string) int {
	used, err := s.redis.Get(ctx, otpAttemptKey(churchID, phone)).Result()
	if err != nil {
		return otpMaxAttempts
	}
	n, err := strconv.Atoi(used)
	if err != nil {
		return otpMaxAttempts
	}
	if remaining := otpMaxAttempts - n; remaining > 0 {
		return remaining
	}
	return 0
}
