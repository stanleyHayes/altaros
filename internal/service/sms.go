package service

import (
	"context"
	"errors"
	"log/slog"

	"github.com/hayfordstanley/altar-os/internal/domain/auth"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
)

// smsSenderFor returns the SMS transport for this environment.
//
// The real Africa's Talking / Hubtel transport lands in WP-15. Until then
// development logs the message so the OTP flow is usable locally, and any
// non-development environment refuses to send rather than pretending to.
//
// That refusal is deliberate. The TypeScript API this replaces shipped a
// StubSmsService that logged to console and returned success, which is exactly
// how a "we sent you a code" screen ends up in front of a member who will
// never receive one.
func smsSenderFor(d *deps.Deps) auth.SMSSender {
	if d.Config.Env.RequiresRealSecrets() {
		return &unconfiguredSMS{}
	}
	return &logSMS{log: d.Log}
}

// logSMS prints the message. Development only.
type logSMS struct{ log *slog.Logger }

func (s *logSMS) Send(_ context.Context, to, message string) error {
	// WARNING level, not INFO: this is a login code in plaintext in the log,
	// and it should be obvious in the output that this is not a real send.
	s.log.Warn("SMS NOT SENT — development transport",
		slog.String("to", to),
		slog.String("message", message),
	)
	return nil
}

// ErrSMSNotConfigured is returned when a non-development environment has no
// real SMS transport.
var ErrSMSNotConfigured = errors.New("sms: no transport configured for this environment")

// unconfiguredSMS fails loudly rather than silently dropping messages.
type unconfiguredSMS struct{}

func (s *unconfiguredSMS) Send(context.Context, string, string) error {
	return ErrSMSNotConfigured
}
