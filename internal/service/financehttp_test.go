package service

import (
	"encoding/json"
	"testing"

	"github.com/hayfordstanley/altar-os/internal/domain/finance"
	"github.com/hayfordstanley/altar-os/internal/platform/money"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

func TestGivingRequiresTheExactQuotedTotal(t *testing.T) {
	quote := money.QuoteELevy(
		money.MustNew(15000, "GHS"),
		money.ChannelMobileMoney,
		0,
	)
	if acceptedQuoteTotal(0, quote) {
		t.Fatal("a missing acceptance must not initialise a charge")
	}
	if acceptedQuoteTotal(15000, quote) {
		t.Fatal("accepting only the gift amount must not omit the levy")
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
