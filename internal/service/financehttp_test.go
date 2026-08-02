package service

import (
	"encoding/json"
	"testing"

	"github.com/hayfordstanley/altar-os/internal/domain/finance"
	"github.com/hayfordstanley/altar-os/internal/platform/money"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

func TestGivingRequiresTheExactQuotedTotal(t *testing.T) {
	// A GHS 150 gift on mobile money, with the giver bearing a 1.95% provider
	// fee — Q-4's default, and the case that makes the gift, the levy total
	// and the real debit three different numbers.
	quote := money.QuoteGiving(
		money.MustNew(15000, "GHS"),
		money.ChannelMobileMoney,
		0,
		money.FeeSchedule{BasisPoints: 195},
		money.BearerGiver,
	)

	if acceptedQuoteTotal(0, quote) {
		t.Fatal("a missing acceptance must not initialise a charge")
	}
	if acceptedQuoteTotal(15000, quote) {
		t.Fatal("accepting only the gift amount must not omit the fee and levy")
	}
	// The specific regression this guards. This check used to compare against
	// a levy quoted on the GIFT alone, which omits the provider fee — so a
	// giver could accept that figure and be debited the fee on top, silently,
	// because every other number on the screen would still be right.
	levyOnGiftAlone := money.QuoteELevy(
		money.MustNew(15000, "GHS"), money.ChannelMobileMoney, 0)
	if levyOnGiftAlone.Total.Minor == quote.Total.Minor {
		t.Fatal("this fixture no longer distinguishes the old total from the real debit")
	}
	if acceptedQuoteTotal(levyOnGiftAlone.Total.Minor, quote) {
		t.Fatal("accepting the pre-fee total must not authorise a larger debit")
	}
	if !acceptedQuoteTotal(quote.Total.Minor, quote) {
		t.Fatal("the exact displayed total should be accepted")
	}
}

func TestTransactionOwnerUsesPrivateInitiatorForAnonymousGiving(t *testing.T) {
	tx := &finance.Transaction{
		MemberID:    mongodb.ID(""),
		InitiatedBy: mongodb.ID("member_1"),
	}
	if got := transactionOwnerID(tx); got != "member_1" {
		t.Fatalf("owner = %q, want private initiator", got)
	}

	encoded, err := json.Marshal(tx)
	if err != nil {
		t.Fatal(err)
	}
	if string(encoded) == "" || containsJSONKey(encoded, "initiatedBy") {
		t.Fatalf("private initiator leaked into transaction JSON: %s", encoded)
	}
}

func containsJSONKey(encoded []byte, key string) bool {
	var doc map[string]any
	if json.Unmarshal(encoded, &doc) != nil {
		return false
	}
	_, ok := doc[key]
	return ok
}
