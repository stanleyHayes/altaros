package communication

import (
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/money"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/sms"
)

// Collections.
const (
	CampaignCollection = "campaigns"
	TemplateCollection = "message_templates"
)

// State is where a campaign got to.
type State string

const (
	// StateDraft is being composed. Nothing has been sent.
	StateDraft State = "draft"
	// StateScheduled will send at a set time.
	StateScheduled State = "scheduled"
	// StateSending is in progress.
	StateSending State = "sending"
	// StateSent finished.
	StateSent State = "sent"
	// StateCancelled was stopped before sending.
	StateCancelled State = "cancelled"
	// StateFailed could not be sent at all.
	StateFailed State = "failed"
)

// Valid reports whether a state is recognised.
func (s State) Valid() bool {
	switch s {
	case StateDraft, StateScheduled, StateSending, StateSent, StateCancelled, StateFailed:
		return true
	}
	return false
}

// Campaign is one broadcast: an audience, a message, and where it got to.
type Campaign struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`

	// Name is what the church calls it internally. Never sent.
	Name string `bson:"name" json:"name"`
	// Channel is how it goes out.
	Channel string `bson:"channel" json:"channel"`
	// Subject is used by email only.
	Subject string `bson:"subject,omitempty" json:"subject,omitempty"`
	Body    string `bson:"body"              json:"body"`

	// Filter is stored rather than the resolved recipient list, so a scheduled
	// message reaches the congregation as it is when it sends. See Filter.
	Filter Filter `bson:"filter" json:"filter"`

	State State `bson:"state" json:"state"`
	// ScheduledFor is when it should go. Nil means immediately on send.
	ScheduledFor *time.Time `bson:"scheduledFor,omitempty" json:"scheduledFor,omitempty"`

	// ApprovedCostMinor is the estimate the sender agreed to.
	//
	// Stored because the audience is resolved at SEND time, not compose time —
	// so a scheduled message to a growing congregation can cost more than the
	// preview said. The send compares against this and refuses a material
	// overrun rather than spending money nobody approved.
	ApprovedCostMinor int64  `bson:"approvedCostMinor,omitempty" json:"approvedCostMinor,omitempty"`
	ApprovedCurrency  string `bson:"approvedCurrency,omitempty"  json:"approvedCurrency,omitempty"`

	// Outcome is filled in as the send proceeds.
	Recipients int `bson:"recipients" json:"recipients"`
	Sent       int `bson:"sent"       json:"sent"`
	Suppressed int `bson:"suppressed" json:"suppressed"`
	Failed     int `bson:"failed"     json:"failed"`
	// ActualCostMinor is what it really cost, which differs from the estimate
	// whenever somebody was suppressed for consent or quiet hours.
	ActualCostMinor int64 `bson:"actualCostMinor,omitempty" json:"actualCostMinor,omitempty"`

	// LastError explains a failed campaign, so a church is not left with a
	// status and no reason.
	LastError string `bson:"lastError,omitempty" json:"lastError,omitempty"`

	CreatedBy mongodb.ID `bson:"createdBy,omitempty" json:"createdBy,omitempty"`
	SentAt    *time.Time `bson:"sentAt,omitempty"    json:"sentAt,omitempty"`
	CreatedAt time.Time  `bson:"createdAt" json:"createdAt"`
	UpdatedAt time.Time  `bson:"updatedAt" json:"updatedAt"`
}

// Template is a reusable message.
type Template struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`

	Name    string `bson:"name"    json:"name"`
	Channel string `bson:"channel" json:"channel"`
	Subject string `bson:"subject,omitempty" json:"subject,omitempty"`
	Body    string `bson:"body"    json:"body"`

	CreatedBy mongodb.ID `bson:"createdBy,omitempty" json:"createdBy,omitempty"`
	CreatedAt time.Time  `bson:"createdAt" json:"createdAt"`
	UpdatedAt time.Time  `bson:"updatedAt" json:"updatedAt"`
}

// CostPreview is what a broadcast will cost, said before send.
//
// The point of every field here is that "247 recipients × 1 SMS" is not a
// preview — it is the answer a church would have guessed. What they cannot
// guess, and what shows up on the invoice, is that the message is three
// segments because of a character they cannot see, and that forty of the
// recipients have no phone number on file.
type CostPreview struct {
	// Audience is who the filter selected, and in words.
	Audience string `json:"audience"`
	// Total is everybody the filter selected.
	Total int `json:"total"`
	// Reachable is how many of them have an address on this channel.
	Reachable int `json:"reachable"`
	// Unreachable is the rest, named so a church can go and fix the records
	// rather than wonder why the count is short.
	Unreachable int `json:"unreachable"`

	// Message is the segmentation of the body. Empty for channels that are
	// not billed per segment.
	Message *sms.Estimate `json:"message,omitempty"`
	// Segments is the total billed units across everybody.
	Segments int `json:"segments"`

	// Cost is the estimate. Zero when no rate has been entered, which is a
	// missing figure rather than a free send — see Estimated.
	Cost money.Amount `json:"cost"`
	// RateConfigured is false when the platform has no rate for this channel,
	// so the UI can say "we cannot price this" instead of showing GHS 0.00 and
	// being believed.
	RateConfigured bool `json:"rateConfigured"`

	// Warning is the sentence worth putting beside the send button. Empty when
	// there is nothing to say.
	Warning string `json:"warning,omitempty"`
	// RequiresConfirmation is true for a send large or expensive enough that
	// the count should be typed rather than clicked past.
	RequiresConfirmation bool `json:"requiresConfirmation"`
}
