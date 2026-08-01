package notification

import (
	"context"
	"fmt"
	"strings"

	"github.com/hayfordstanley/altar-os/internal/platform/money"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// GivingCompleted is the payload of altar.giving.completed.v1, which the
// finance service emits on settlement.
type GivingCompleted struct {
	TransactionID string
	ChurchID      string
	MemberID      string
	Type          string
	Channel       string
	GrossMinor    int64
	LevyMinor     int64
	NetMinor      int64
	Currency      string
	ChurchName    string
}

// ReceiptFor renders a giving receipt.
//
// It leads with what the giver was DEBITED, not what the church received. The
// church's net is smaller by the fees, and a receipt showing the smaller number
// reads as money going missing. The E-Levy is stated separately for the same
// reason: the member's own MoMo statement will show the larger figure, and a
// receipt that disagrees with their statement is the one they bring to the
// church office.
func ReceiptFor(e GivingCompleted) string {
	currency := e.Currency
	if currency == "" {
		currency = "GHS"
	}
	gift := money.Amount{Minor: e.GrossMinor, Currency: currency}

	church := strings.TrimSpace(e.ChurchName)
	if church == "" {
		church = "your church"
	}

	var b strings.Builder
	fmt.Fprintf(&b, "Thank you for your %s of %s to %s.", givingWord(e.Type), gift, church)

	if e.LevyMinor > 0 {
		levy := money.Amount{Minor: e.LevyMinor, Currency: currency}
		total := money.Amount{Minor: e.GrossMinor + e.LevyMinor, Currency: currency}
		fmt.Fprintf(&b, " Your total debit was %s, including %s E-Levy.", total, levy)
	}

	if ref := shortRef(e.TransactionID); ref != "" {
		fmt.Fprintf(&b, " Ref: %s", ref)
	}
	return b.String()
}

func givingWord(t string) string {
	switch t {
	case "tithe":
		return "tithe"
	case "offering":
		return "offering"
	case "campaign":
		return "campaign gift"
	case "pledge_payment":
		return "pledge payment"
	default:
		return "gift"
	}
}

// shortRef gives the member something quotable without printing a full
// ObjectId at them.
func shortRef(id string) string {
	if len(id) <= 8 {
		return strings.ToUpper(id)
	}
	return strings.ToUpper(id[len(id)-8:])
}

// SendGivingReceipt is the consumer of altar.giving.completed.v1.
//
// The dedupe key is the transaction id, so a redelivered event produces one
// receipt however many times Kafka replays it. At-least-once delivery is the
// contract; a duplicate must not send two receipts.
//
// A receipt is transactional: the member's own act of giving asked for it, so
// it is not gated on marketing consent and is not held by quiet hours. Someone
// who gives at 22:00 gets their receipt at 22:00.
func (s *Service) SendGivingReceipt(ctx context.Context, e GivingCompleted) (*Notification, error) {
	if e.MemberID == "" {
		// Anonymous giving has nobody to receipt. Not an error — anonymous
		// giving is a supported flow, not a missing member id.
		return nil, nil
	}
	if e.ChurchID == "" {
		return nil, fmt.Errorf("notification: giving event has no church")
	}

	// The event arrives from Kafka with no session, so the church comes from
	// the event itself and every write happens inside its scope.
	scoped := ctx
	if _, err := tenancy.MustChurchID(ctx); err != nil {
		scoped = tenancy.WithScope(ctx, tenancy.Scope{
			ChurchID: e.ChurchID,
			UserID:   "system:giving-receipt",
			Role:     "SYSTEM",
		})
	}

	return s.Send(scoped, Message{
		MemberID:  e.MemberID,
		Channel:   ChannelSMS,
		Kind:      KindTransactional,
		Subject:   "Giving receipt",
		Body:      ReceiptFor(e),
		DedupeKey: "receipt:" + e.TransactionID,
	})
}
