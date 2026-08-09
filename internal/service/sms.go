package service

import (
	"context"
	"errors"
	"log/slog"

	"github.com/hayfordstanley/altar-os/internal/domain/auth"
	"github.com/hayfordstanley/altar-os/internal/domain/notification"
	"github.com/hayfordstanley/altar-os/internal/domain/notification/transport"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
)

// smsTransportFor returns the configured SMS transport, or nil.
//
// The provider is chosen by SMS_PROVIDER rather than inferred from which
// credentials happen to be present. Inference reads well until a deployment
// holds keys for both — during a provider switch, which is exactly when it
// matters — and then the transport that sends is whichever branch was written
// first, silently.
//
// Arkesel is the only provider (9 Aug 2026). A second one was carried behind
// the same notification.Transport port for a while; it was removed once it was
// clear nothing selected it, because an unused branch is a branch nobody tests.
func smsTransportFor(d *deps.Deps) notification.Transport {
	if d.Config.SMS.Arkesel.APIKey != "" && d.Config.SMS.Arkesel.SenderID != "" {
		return transport.NewArkesel(transport.ArkeselConfig{
			APIKey:   d.Config.SMS.Arkesel.APIKey,
			SenderID: d.Config.SMS.Arkesel.SenderID,
		})
	}
	return nil
}

// smsSenderFor returns the SMS transport for this environment.
//
// The real transport landed in WP-15 but was never connected here, so OTP
// delivery still went through a development stub — meaning a production
// deployment WITH valid credentials would still have refused to send a login
// code. Configured credentials are now used.
//
// The fallbacks are unchanged and deliberate. Development logs the code so the
// OTP flow is usable locally. A non-development environment with no credentials
// refuses rather than pretending, because the TypeScript API this replaces
// shipped a StubSmsService that logged to console and returned success — which
// is exactly how a "we sent you a code" screen ends up in front of a member who
// will never receive one.
func smsSenderFor(d *deps.Deps) auth.SMSSender {
	if sender := smsTransportFor(d); sender != nil {
		return &realSMS{transport: sender, log: d.Log}
	}

	if d.Config.Env.RequiresRealSecrets() {
		// WP-05 already fails the boot when a service that requires these is
		// missing them, so reaching here means a service that does not list
		// them as required. Refuse anyway rather than degrade to logging.
		return &unconfiguredSMS{}
	}
	return &logSMS{log: d.Log}
}

// realSMS adapts the notification transport to the auth SMSSender port.
//
// The two interfaces differ because they were built for different callers:
// notification sends a Message, auth sends a string. Adapting here keeps auth
// from importing the notification package, which would couple the login path to
// the whole messaging domain.
type realSMS struct {
	transport notification.Transport
	log       *slog.Logger
}

func (s *realSMS) Send(ctx context.Context, to, message string) error {
	// KindTransactional: a login code is not marketing. It must not be gated on
	// communications consent or held by quiet hours — someone signing in at
	// 23:00 needs their code at 23:00.
	_, err := s.transport.Send(ctx, to, notification.Message{
		Channel: notification.ChannelSMS,
		Kind:    notification.KindTransactional,
		Body:    message,
	})
	if err != nil {
		// The number is deliberately not logged: an OTP failure paired with
		// its recipient puts a phone number in the logs for every failed login.
		s.log.Error("could not send an SMS", slog.String("error", err.Error()))
		return err
	}
	return nil
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
