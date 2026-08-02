// Package notification delivers messages to members (WP-15).
//
// Two constraints shape this package, and both are the kind that must be
// structural rather than remembered:
//
//   - Consent is checked here, at the point of send, not by callers. WP-06
//     made communications consent fail closed (no record means no consent);
//     if the check lived in each caller, one caller forgetting it is a
//     regulatory incident under Ghana's Act 843 and Nigeria's NDPA.
//   - Delivery is recorded before it is attempted. A church that cannot tell
//     whether a member was told about a service change will not trust the
//     platform to run its communications.
package notification

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/domain/consent"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// Collections.
const (
	Collection            = "notifications"
	PreferenceCollection  = "notification_preferences"
	DeviceCollection      = "notification_devices"
	DefaultQuietHoursFrom = 21 // 21:00
	DefaultQuietHoursTo   = 7  // 07:00
)

// Channel is a delivery route.
type Channel string

const (
	ChannelSMS      Channel = "sms"
	ChannelEmail    Channel = "email"
	ChannelPush     Channel = "push"
	ChannelWhatsApp Channel = "whatsapp"
)

// AllChannels is every route, for building preference UIs.
var AllChannels = []Channel{ChannelSMS, ChannelEmail, ChannelPush, ChannelWhatsApp}

// Valid reports whether a channel is recognised.
func (c Channel) Valid() bool {
	for _, known := range AllChannels {
		if c == known {
			return true
		}
	}
	return false
}

// Kind is why a message is being sent. It decides whether quiet hours apply
// and whether the member may opt out.
type Kind string

const (
	// KindTransactional is a message the member's own action asked for: a
	// giving receipt, an OTP, a password reset. These are not marketing and a
	// member cannot be left unable to receive them — a receipt suppressed by
	// quiet hours is a member who thinks their tithe vanished.
	KindTransactional Kind = "transactional"
	// KindAnnouncement is church-initiated broadcast: service changes, event
	// reminders, prayer requests. Consent-gated and quiet-hours-bound.
	KindAnnouncement Kind = "announcement"
	// KindPastoral is one-to-one from a leader — a follow-up after a first
	// visit, a welfare check.
	KindPastoral Kind = "pastoral"
)

// Valid reports whether a kind is recognised.
func (k Kind) Valid() bool {
	switch k {
	case KindTransactional, KindAnnouncement, KindPastoral:
		return true
	}
	return false
}

// RequiresConsent reports whether this kind may only be sent with explicit
// communications consent.
//
// Transactional messages are excluded deliberately: they are necessary to
// perform the service the member asked for, which is the same lawful basis
// WP-06 gives membership and giving. Treating an OTP as marketing would lock
// a member out of their own account for having declined a newsletter.
func (k Kind) RequiresConsent() bool { return k != KindTransactional }

// Status is where a message got to.
type Status string

const (
	StatusQueued    Status = "queued"
	StatusSent      Status = "sent"
	StatusDelivered Status = "delivered"
	StatusFailed    Status = "failed"
	// StatusSuppressed means the message was never sent, and why is recorded.
	// This is distinct from failed: nothing went wrong, the system correctly
	// declined to send.
	StatusSuppressed Status = "suppressed"
)

// Suppression reasons, stored so a church can answer "why didn't they get it?"
const (
	ReasonNoConsent    = "no_communications_consent"
	ReasonChannelOff   = "channel_disabled_by_member"
	ReasonQuietHours   = "deferred_for_quiet_hours"
	ReasonNoAddress    = "no_address_for_channel"
	ReasonUnsubscribed = "member_unsubscribed"
)

var (
	// ErrNotFound means no notification matched.
	ErrNotFound = errors.New("notification: not found")
	// ErrInvalidChannel means an unrecognised channel.
	ErrInvalidChannel = errors.New("notification: unrecognised channel")
	// ErrInvalidKind means an unrecognised message kind.
	ErrInvalidKind = errors.New("notification: unrecognised kind")
	// ErrNoBody means a message with nothing to say.
	ErrNoBody = errors.New("notification: body is required")
	// ErrNoRecipient means no member to send to.
	ErrNoRecipient = errors.New("notification: recipient is required")
	// ErrInvalidDevice means a native push registration is malformed.
	ErrInvalidDevice = errors.New("notification: invalid device registration")
	// ErrUnregisteredDevice means the push provider has authoritatively retired
	// a native token. It is permanent and the registration must be pruned.
	ErrUnregisteredDevice = errors.New("notification: device is no longer registered")
	// ErrNoTransport means no adapter is registered for the channel.
	ErrNoTransport = errors.New("notification: no transport registered for channel")
)

// Notification is one message to one member on one channel.
type Notification struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`
	MemberID mongodb.ID    `bson:"memberId"      json:"memberId"`
	Channel  Channel       `bson:"channel"       json:"channel"`
	Kind     Kind          `bson:"kind"          json:"kind"`
	// Address is where it was actually sent: the E.164 number, the email.
	// Recorded because a member may change theirs, and the delivery record
	// must say where the message went, not where it would go today.
	Address string `bson:"address,omitempty" json:"address,omitempty"`
	Subject string `bson:"subject,omitempty" json:"subject,omitempty"`
	Body    string `bson:"body"              json:"body"`
	Status  Status `bson:"status"            json:"status"`
	// Reason explains a suppression or a failure in words a church admin can
	// act on.
	Reason string `bson:"reason,omitempty" json:"reason,omitempty"`
	// ProviderRef is the transport's own message id, for reconciling delivery
	// reports that arrive later.
	ProviderRef string `bson:"providerRef,omitempty" json:"providerRef,omitempty"`
	// DedupeKey makes a redelivered domain event produce one message. A
	// duplicate giving.completed must not send two receipts.
	DedupeKey string `bson:"dedupeKey,omitempty" json:"dedupeKey,omitempty"`
	// Attempts counts transport attempts, for backoff.
	Attempts int `bson:"attempts" json:"attempts"`
	// NextAttemptAt schedules a retry, and also carries a message deferred
	// past quiet hours.
	NextAttemptAt *time.Time `bson:"nextAttemptAt,omitempty" json:"nextAttemptAt,omitempty"`
	SentAt        *time.Time `bson:"sentAt,omitempty"        json:"sentAt,omitempty"`
	CreatedAt     time.Time  `bson:"createdAt"               json:"createdAt"`
	UpdatedAt     time.Time  `bson:"updatedAt"               json:"updatedAt"`
	ReadAt        *time.Time `bson:"readAt,omitempty"        json:"readAt,omitempty"`
}

// DeviceRegistration binds one native APNs/FCM token to one signed-in session
// family and platform. That slot is updated when the operating system rotates
// its token, so stale addresses cannot accumulate.
type DeviceRegistration struct {
	ID        bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID  mongodb.ID    `bson:"churchId"      json:"churchId"`
	MemberID  string        `bson:"memberId"      json:"memberId"`
	Family    string        `bson:"family"        json:"-"`
	Token     string        `bson:"token"         json:"token"`
	Platform  string        `bson:"platform"      json:"platform"`
	CreatedAt time.Time     `bson:"createdAt"     json:"createdAt"`
	UpdatedAt time.Time     `bson:"updatedAt"     json:"updatedAt"`
}

// Preference is a member's per-channel opt-in state and quiet hours.
//
// Separate from consent on purpose. Consent is the lawful basis for
// communicating at all; preference is how the member wants it done. Revoking
// consent stops everything; disabling the SMS channel still allows push.
type Preference struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`
	MemberID mongodb.ID    `bson:"memberId"      json:"memberId"`
	// Disabled lists channels the member has turned off.
	Disabled []Channel `bson:"disabled,omitempty" json:"disabled,omitempty"`
	// QuietFromHour and QuietToHour bound the local hours during which
	// announcements are held. Stored as hours in the church's timezone.
	QuietFromHour *int `bson:"quietFromHour,omitempty" json:"quietFromHour,omitempty"`
	QuietToHour   *int `bson:"quietToHour,omitempty"   json:"quietToHour,omitempty"`
	// Unsubscribed stops everything except transactional messages, without
	// touching the consent record — a member who replies STOP has expressed a
	// preference, and mapping that onto a consent revocation would lose the
	// distinction between "stop texting me" and "delete my lawful basis".
	Unsubscribed bool      `bson:"unsubscribed" json:"unsubscribed"`
	CreatedAt    time.Time `bson:"createdAt"    json:"createdAt"`
	UpdatedAt    time.Time `bson:"updatedAt"    json:"updatedAt"`
}

// ChannelEnabled reports whether a channel is on for this member.
func (p *Preference) ChannelEnabled(c Channel) bool {
	if p == nil {
		return true
	}
	for _, off := range p.Disabled {
		if off == c {
			return false
		}
	}
	return true
}

// quietWindow returns the member's quiet hours, falling back to the default.
func (p *Preference) quietWindow() (from, to int) {
	from, to = DefaultQuietHoursFrom, DefaultQuietHoursTo
	if p != nil && p.QuietFromHour != nil {
		from = *p.QuietFromHour
	}
	if p != nil && p.QuietToHour != nil {
		to = *p.QuietToHour
	}
	return from, to
}

// InQuietHours reports whether a time falls inside the member's quiet window.
//
// The window normally wraps midnight (21:00 to 07:00), so the comparison is
// not a simple range check — treating it as one would make every hour of the
// day quiet.
func (p *Preference) InQuietHours(t time.Time) bool {
	from, to := p.quietWindow()
	if from == to {
		return false
	}
	hour := t.Hour()
	if from < to {
		return hour >= from && hour < to
	}
	return hour >= from || hour < to
}

// NextSendableTime returns when a deferred message may go out.
func (p *Preference) NextSendableTime(t time.Time) time.Time {
	if !p.InQuietHours(t) {
		return t
	}
	_, to := p.quietWindow()
	next := time.Date(t.Year(), t.Month(), t.Day(), to, 0, 0, 0, t.Location())
	if !next.After(t) {
		next = next.Add(24 * time.Hour)
	}
	return next
}

// Message is a request to notify one member.
type Message struct {
	MemberID string
	Channel  Channel
	Kind     Kind
	Subject  string
	Body     string
	// Address overrides the member's stored address. Used by OTP delivery,
	// where the number is known before any member record exists.
	Address string
	// DedupeKey makes redelivery of a domain event produce one message.
	DedupeKey string
}

// Recipient is what a transport needs to reach a member.
type Recipient struct {
	MemberID string
	Name     string
	// PhoneE164 and Email are the addresses. Empty means unreachable on that
	// channel, which is a suppression rather than a failure.
	PhoneE164 string
	Email     string
	// PushTokens are device registrations.
	PushTokens []string
}

// AddressFor returns the member's address on a channel.
func (r *Recipient) AddressFor(c Channel) string {
	switch c {
	case ChannelSMS, ChannelWhatsApp:
		return r.PhoneE164
	case ChannelEmail:
		return r.Email
	case ChannelPush:
		if len(r.PushTokens) > 0 {
			return r.PushTokens[0]
		}
	}
	return ""
}

// Directory resolves a member into their contact details.
type Directory interface {
	RecipientFor(ctx context.Context, memberID string) (*Recipient, error)
}

// ConsentChecker is the subset of the consent service this package needs.
// Narrow on purpose: notification can read whether communication is permitted
// and nothing else.
type ConsentChecker interface {
	IsGranted(ctx context.Context, memberID string, p consent.Purpose) (bool, error)
}

// Transport delivers on one channel.
type Transport interface {
	// Channel is the route this transport serves.
	Channel() Channel
	// Send delivers a message, returning the provider's reference.
	Send(ctx context.Context, to string, msg Message) (providerRef string, err error)
}

// RetryableError marks a transport failure worth retrying. A rejected
// recipient is not retryable; a provider outage is.
type RetryableError struct{ Err error }

func (e *RetryableError) Error() string { return e.Err.Error() }
func (e *RetryableError) Unwrap() error { return e.Err }

// Retryable wraps an error as worth retrying.
func Retryable(err error) error { return &RetryableError{Err: err} }

// IsRetryable reports whether an error should be retried.
func IsRetryable(err error) bool {
	var r *RetryableError
	return errors.As(err, &r)
}

// backoffFor returns how long to wait before attempt n.
//
// Exponential with a ceiling. The ceiling matters more than the curve: an SMS
// receipt that arrives two days late is worse than one that never arrives,
// because the member has already contacted the church about it.
func backoffFor(attempt int) time.Duration {
	const (
		base = 30 * time.Second
		max  = 30 * time.Minute
	)
	d := base
	for i := 1; i < attempt; i++ {
		d *= 3
		if d >= max {
			return max
		}
	}
	return d
}

// MaxAttempts is how many times a message is retried before it is abandoned.
const MaxAttempts = 5

func mustValid(msg Message) error {
	if msg.MemberID == "" {
		return ErrNoRecipient
	}
	if !msg.Channel.Valid() {
		return fmt.Errorf("%w: %q", ErrInvalidChannel, msg.Channel)
	}
	if !msg.Kind.Valid() {
		return fmt.Errorf("%w: %q", ErrInvalidKind, msg.Kind)
	}
	if msg.Body == "" {
		return ErrNoBody
	}
	return nil
}
