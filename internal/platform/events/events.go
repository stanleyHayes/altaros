// Package events is the Kafka event bus (§6).
//
// Until now every domain declared a Publisher interface and topic constants,
// and every wiring site passed nil. The interfaces were real, the tests used
// fakes, and nothing was ever published — so `giving.completed` was emitted by
// no one and consumed by no one, and the receipt half of WP-15 could not fire
// however correct both halves were in isolation.
//
// The conventions here come from §6 and are not negotiable per-call:
//
//   - Topics are altar.<domain>.<event>.v<n>.
//   - The message KEY is the church id. Kafka orders within a partition, so
//     keying by church guarantees one church's events arrive in the order they
//     happened — which is what makes "created then status_changed" safe to act
//     on. Keying by anything else, or leaving it empty, silently reorders them.
//   - The envelope is CloudEvents-shaped, so a consumer can route on type and
//     dedupe on id without parsing the domain payload.
//   - Payloads carry IDs and state transitions, NEVER sensitive bodies. A
//     consumer that needs prayer request text calls the service and passes an
//     authorisation check. Kafka retains messages for days on disk with no
//     tenant enforcement of its own; a payload is the one place in this system
//     where the tenant wrapper cannot help.
package events

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	// ErrNoBroker means the bus was built without brokers configured.
	ErrNoBroker = errors.New("events: no Kafka brokers configured")
	// ErrNoTopic means a publish was attempted with no topic.
	ErrNoTopic = errors.New("events: topic is required")
	// ErrNoKey means a publish was attempted with no church id.
	ErrNoKey = errors.New("events: a church id is required as the partition key")
)

// SpecVersion is the CloudEvents version the envelope follows.
const SpecVersion = "1.0"

// Envelope wraps every message on the bus.
//
// CloudEvents-shaped rather than actually importing the CloudEvents SDK: the
// fields that matter here are id, type, source, time and subject, and the SDK
// brings a transport abstraction this does not need. The JSON names match the
// spec so a future migration is a type swap, not a re-encoding.
type Envelope struct {
	// ID is unique per event and is what consumers dedupe on. Generated at
	// publish time, so a retried publish of the same domain fact produces two
	// ids — which is correct: they are two deliveries, and the consumer's
	// own idempotency key (a transaction id, say) is what collapses them.
	ID string `json:"id"`
	// Source identifies the emitting service.
	Source string `json:"source"`
	// Type is the topic, repeated in the body so a consumer reading from
	// several topics does not need the Kafka metadata to route.
	Type string `json:"type"`
	// SpecVersion is the CloudEvents version.
	SpecVersion string `json:"specversion"`
	// Time is when the event happened, not when it was published.
	Time time.Time `json:"time"`
	// Subject is the church id — the same value used as the partition key.
	Subject string `json:"subject"`
	// Data is the domain payload.
	Data any `json:"data"`
}

// NewEnvelope builds an envelope for a domain payload.
func NewEnvelope(source, topic, churchID string, payload any) (*Envelope, error) {
	if strings.TrimSpace(topic) == "" {
		return nil, ErrNoTopic
	}
	if strings.TrimSpace(churchID) == "" {
		// Refusing rather than defaulting: an unkeyed message is spread across
		// partitions at random, so one church's events stop being ordered
		// relative to each other. That failure is invisible until a consumer
		// acts on a status change before the creation it belongs to.
		return nil, ErrNoKey
	}

	id, err := newEventID()
	if err != nil {
		return nil, err
	}
	return &Envelope{
		ID:          id,
		Source:      source,
		Type:        topic,
		SpecVersion: SpecVersion,
		Time:        time.Now().UTC(),
		Subject:     churchID,
		Data:        payload,
	}, nil
}

func newEventID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("events: generate id: %w", err)
	}
	return "evt_" + hex.EncodeToString(buf), nil
}

// Publisher emits domain events.
//
// This matches the Publisher interface every domain already declares, so the
// bus drops straight into the nil arguments without touching a single domain
// package.
type Publisher interface {
	Publish(ctx context.Context, topic, key string, payload any) error
}

// Handler processes one event.
//
// Returning an error means the message is NOT acknowledged and will be
// redelivered. Returning nil commits the offset. Handlers must therefore be
// idempotent, which is what §6 requires of every consumer.
type Handler func(ctx context.Context, e *Envelope, raw []byte) error

// Topics defined in code today. Kept here as well as in the domains so the
// provisioner has one list to create, and so a topic nobody publishes to yet
// is still visible.
const (
	TopicMemberCreated       = "altar.member.created.v1"
	TopicMemberStatusChanged = "altar.member.status_changed.v1"
	TopicGivingCompleted     = "altar.giving.completed.v1"
	TopicGivingFailed        = "altar.giving.failed.v1"
	TopicConsentChanged      = "altar.consent.changed.v1"
)

// KnownTopics is every topic the platform currently publishes.
//
// Auto-creation is disabled on the broker (correctly — it turns a typo into a
// silently-created topic nobody consumes), so these are provisioned explicitly
// at startup.
var KnownTopics = []string{
	TopicMemberCreated,
	TopicMemberStatusChanged,
	TopicGivingCompleted,
	TopicGivingFailed,
	TopicConsentChanged,
}
