package finance

import (
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/money"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// The arithmetic is covered in pledge_test.go against constructed values. What
// is covered HERE is the half that has already been wrong once in this
// codebase: reading real settled giving back out of the ledger. A status
// literal that matches nothing produces a tracker where every faithful giver is
// in arrears, and it looks perfectly healthy in a unit test.

// giveAs settles a real gift for a named member, optionally against a campaign.
func (h *harness) giveAs(t *testing.T, memberID string, amountMinor int64, campaignID string) {
	t.Helper()
	result, err := h.svc.StartGiving(h.ctx, GiveRequest{
		MemberID:   memberID,
		Type:       TypePledgePayment,
		CampaignID: campaignID,
		Amount:     money.MustNew(amountMinor, "GHS"),
		Channel:    money.ChannelMobileMoney,
		Email:      "giver@example.com",
	})
	if err != nil {
		t.Fatalf("StartGiving: %v", err)
	}
	ref := result.Transaction.IdempotencyKey
	h.gw.willSucceed(ref, amountMinor, 195, amountMinor*150/10000)
	if _, err := h.svc.Settle(h.ctx, ref); err != nil {
		t.Fatalf("Settle: %v", err)
	}
}

// WP-26 acceptance: "a pledge of GHS 1,000 over 10 months tracks partial
// fulfilment and flags arrears" — end to end, over the real ledger.
func TestAPledgeTracksRealGivingAndFlagsArrears(t *testing.T) {
	h := newHarness(t)
	if err := h.svc.EnsurePledgeIndexes(h.ctx); err != nil {
		t.Fatalf("EnsurePledgeIndexes: %v", err)
	}

	// Started six months ago, so six instalments are due today.
	start := time.Now().AddDate(0, -6, 0)
	made, err := h.svc.MakePledge(h.ctx, PledgeInput{
		MemberID: "member_pledger", TotalMinor: 100_000, Currency: "GHS",
		Frequency: FrequencyMonthly, Instalments: 10, StartDate: start,
	})
	if err != nil {
		t.Fatalf("MakePledge: %v", err)
	}
	if made.DueMinor != 70_000 {
		// Six months elapsed means seven instalments have fallen due,
		// counting the one on the start date itself.
		t.Fatalf("due at creation = %d, want 70000", made.DueMinor)
	}
	if !made.Behind || made.ArrearsMinor != 70_000 {
		t.Fatalf("a pledge with nothing paid reads behind=%v arrears=%d",
			made.Behind, made.ArrearsMinor)
	}

	// Three instalments actually given, through the real giving path.
	for i := 0; i < 3; i++ {
		h.giveAs(t, "member_pledger", 10_000, "")
	}

	got, err := h.svc.PledgeByID(h.ctx, made.Pledge.ID.Hex())
	if err != nil {
		t.Fatalf("PledgeByID: %v", err)
	}
	if got.PaidMinor != 30_000 {
		t.Fatalf("paid = %d, want the 30000 actually given — the ledger read is wrong",
			got.PaidMinor)
	}
	if got.ArrearsMinor != 40_000 {
		t.Errorf("arrears = %d, want 40000", got.ArrearsMinor)
	}
	if !got.Behind {
		t.Error("a member four instalments short is not flagged")
	}
	if got.Percent != 30 {
		t.Errorf("percent = %d, want 30", got.Percent)
	}
	if got.RemainingMinor != 70_000 {
		t.Errorf("remaining = %d, want 70000", got.RemainingMinor)
	}

	// The rest of the promise, and the flag must clear.
	for i := 0; i < 7; i++ {
		h.giveAs(t, "member_pledger", 10_000, "")
	}
	done, err := h.svc.PledgeByID(h.ctx, made.Pledge.ID.Hex())
	if err != nil {
		t.Fatalf("PledgeByID: %v", err)
	}
	if !done.Complete || done.Behind || done.ArrearsMinor != 0 {
		t.Fatalf("a fully-paid pledge reads complete=%v behind=%v arrears=%d",
			done.Complete, done.Behind, done.ArrearsMinor)
	}
	if done.Percent != 100 {
		t.Errorf("percent = %d on a completed pledge", done.Percent)
	}
}

// A pending gift is not fulfilment. Somebody who started a payment and
// abandoned it has not given, and a tracker that counts it tells the church a
// pledge is met when no money arrived.
func TestOnlySettledGivingCountsTowardsAPledge(t *testing.T) {
	h := newHarness(t)
	if err := h.svc.EnsurePledgeIndexes(h.ctx); err != nil {
		t.Fatalf("EnsurePledgeIndexes: %v", err)
	}

	made, err := h.svc.MakePledge(h.ctx, PledgeInput{
		MemberID: "member_abandoner", TotalMinor: 50_000, Currency: "GHS",
		Frequency: FrequencyMonthly, Instalments: 5,
		StartDate: time.Now().AddDate(0, -2, 0),
	})
	if err != nil {
		t.Fatalf("MakePledge: %v", err)
	}

	// Started, never settled.
	if _, err := h.svc.StartGiving(h.ctx, GiveRequest{
		MemberID: "member_abandoner", Type: TypePledgePayment,
		Amount: money.MustNew(50_000, "GHS"), Channel: money.ChannelMobileMoney,
		Email: "abandon@example.com",
	}); err != nil {
		t.Fatalf("StartGiving: %v", err)
	}

	got, err := h.svc.PledgeByID(h.ctx, made.Pledge.ID.Hex())
	if err != nil {
		t.Fatalf("PledgeByID: %v", err)
	}
	if got.PaidMinor != 0 {
		t.Fatalf("an abandoned payment counted %d towards the pledge", got.PaidMinor)
	}
	if !got.Behind {
		t.Error("a member who gave nothing is not flagged as behind")
	}
}

// A pledge against a campaign counts giving to that campaign, and a general
// pledge counts giving that carries no campaign. Crossing the two would let a
// member's building-fund gifts silently satisfy a general promise as well.
func TestGivingToOneCampaignDoesNotSatisfyAPledgeToAnother(t *testing.T) {
	h := newHarness(t)
	if err := h.svc.EnsurePledgeIndexes(h.ctx); err != nil {
		t.Fatalf("EnsurePledgeIndexes: %v", err)
	}

	building, err := h.svc.CreateCampaign(h.ctx, CampaignInput{
		Title: "Building Fund", TargetAmount: 1_000_000, Currency: "GHS",
	})
	if err != nil {
		t.Fatalf("CreateCampaign: %v", err)
	}

	// A pledge to the building fund.
	pledged, err := h.svc.MakePledge(h.ctx, PledgeInput{
		MemberID: "member_split", CampaignID: building.ID.Hex(),
		TotalMinor: 100_000, Currency: "GHS",
		Frequency: FrequencyMonthly, Instalments: 10,
		StartDate: time.Now().AddDate(0, -3, 0),
	})
	if err != nil {
		t.Fatalf("MakePledge: %v", err)
	}

	// Giving that carries NO campaign must not touch it.
	h.giveAs(t, "member_split", 40_000, "")
	got, err := h.svc.PledgeByID(h.ctx, pledged.Pledge.ID.Hex())
	if err != nil {
		t.Fatalf("PledgeByID: %v", err)
	}
	if got.PaidMinor != 0 {
		t.Fatalf("general giving counted %d towards a campaign pledge", got.PaidMinor)
	}

	// Giving to the campaign does.
	h.giveAs(t, "member_split", 40_000, building.ID.Hex())
	got, err = h.svc.PledgeByID(h.ctx, pledged.Pledge.ID.Hex())
	if err != nil {
		t.Fatalf("PledgeByID: %v", err)
	}
	if got.PaidMinor != 40_000 {
		t.Fatalf("campaign giving counted %d, want 40000", got.PaidMinor)
	}
}

// The list is what a church acts on, so the behind-only filter has to be right:
// a pastor chasing arrears must not be handed somebody who is up to date.
func TestTheBehindFilterListsOnlyThoseActuallyBehind(t *testing.T) {
	h := newHarness(t)
	if err := h.svc.EnsurePledgeIndexes(h.ctx); err != nil {
		t.Fatalf("EnsurePledgeIndexes: %v", err)
	}

	start := time.Now().AddDate(0, -3, 0)
	for _, m := range []string{"member_paid", "member_short"} {
		if _, err := h.svc.MakePledge(h.ctx, PledgeInput{
			MemberID: m, TotalMinor: 100_000, Currency: "GHS",
			Frequency: FrequencyMonthly, Instalments: 10, StartDate: start,
		}); err != nil {
			t.Fatalf("MakePledge %s: %v", m, err)
		}
	}
	// One keeps up (four instalments due after three months), one does not.
	for i := 0; i < 4; i++ {
		h.giveAs(t, "member_paid", 10_000, "")
	}
	h.giveAs(t, "member_short", 10_000, "")

	behind, err := h.svc.Pledges(h.ctx, "", true)
	if err != nil {
		t.Fatalf("Pledges: %v", err)
	}
	if len(behind) != 1 {
		t.Fatalf("behind list has %d entries, want only the one member who is", len(behind))
	}
	if behind[0].Pledge.MemberID != "member_short" {
		t.Errorf("behind list names %q", behind[0].Pledge.MemberID)
	}

	all, err := h.svc.Pledges(h.ctx, "", false)
	if err != nil {
		t.Fatalf("Pledges: %v", err)
	}
	if len(all) != 2 {
		t.Errorf("the full list has %d entries, want 2", len(all))
	}
}

// Pledges are church records and must not cross tenants — the same rule as
// every other collection, checked here because a pledge names a person and an
// amount they promised.
func TestPledgesDoNotCrossChurches(t *testing.T) {
	h := newHarness(t)
	if err := h.svc.EnsurePledgeIndexes(h.ctx); err != nil {
		t.Fatalf("EnsurePledgeIndexes: %v", err)
	}
	made, err := h.svc.MakePledge(h.ctx, PledgeInput{
		MemberID: "member_1", TotalMinor: 100_000, Currency: "GHS",
		Frequency: FrequencyMonthly, Instalments: 10, StartDate: time.Now(),
	})
	if err != nil {
		t.Fatalf("MakePledge: %v", err)
	}

	other := tenancy.WithScope(h.ctx, tenancy.Scope{
		ChurchID: "church_finance_other", UserID: "admin_2", Role: "CHURCH_ADMIN",
	})
	if _, err := h.svc.PledgeByID(other, made.Pledge.ID.Hex()); err == nil {
		t.Fatal("another church read this church's pledge")
	}
	list, err := h.svc.Pledges(other, "", false)
	if err != nil {
		t.Fatalf("Pledges: %v", err)
	}
	if len(list) != 0 {
		t.Fatalf("another church sees %d of this church's pledges", len(list))
	}
}

// An expense recorded against a member is not giving. A church that disburses
// welfare money to somebody and attributes the row to them must not have that
// counted as fulfilment of the pledge they made — it moves the wrong way.
func TestAnExpenseAttributedToAMemberIsNotFulfilment(t *testing.T) {
	h := newHarness(t)
	if err := h.svc.EnsurePledgeIndexes(h.ctx); err != nil {
		t.Fatalf("EnsurePledgeIndexes: %v", err)
	}
	made, err := h.svc.MakePledge(h.ctx, PledgeInput{
		MemberID: "member_helped", TotalMinor: 100_000, Currency: "GHS",
		Frequency: FrequencyMonthly, Instalments: 10,
		StartDate: time.Now().AddDate(0, -3, 0),
	})
	if err != nil {
		t.Fatalf("MakePledge: %v", err)
	}

	// The church gives money TO this member.
	if _, err := h.svc.RecordCash(h.ctx, CashRequest{
		MemberID: "member_helped", Type: TypeExpense,
		Direction: DirectionExpense, Amount: money.MustNew(50_000, "GHS"),
		Note: "welfare disbursement",
	}); err != nil {
		t.Fatalf("RecordCash: %v", err)
	}

	got, err := h.svc.PledgeByID(h.ctx, made.Pledge.ID.Hex())
	if err != nil {
		t.Fatalf("PledgeByID: %v", err)
	}
	if got.PaidMinor != 0 {
		t.Fatalf("an expense paid TO the member counted %d towards their pledge",
			got.PaidMinor)
	}
	if !got.Behind {
		t.Error("a member who has given nothing is not flagged as behind")
	}
}

// ADR-005: this database is shared with the legacy TypeScript API, which stores
// memberId as an ObjectId, while the Go giving path stores the same id as a
// string. A lookup that matches only one form silently halves a member's giving
// and reports a faithful giver as being in arrears — which is exactly how the
// consent bug (R-27) hid for as long as it did.
func TestGivingIsFoundUnderBothStorageFormsOfAMemberID(t *testing.T) {
	h := newHarness(t)
	if err := h.svc.EnsurePledgeIndexes(h.ctx); err != nil {
		t.Fatalf("EnsurePledgeIndexes: %v", err)
	}

	// A REAL member id — hex, so both forms are possible. A non-hex fixture
	// can never exercise this, which is why one is not used here.
	memberID := bson.NewObjectID().Hex()

	made, err := h.svc.MakePledge(h.ctx, PledgeInput{
		MemberID: memberID, TotalMinor: 100_000, Currency: "GHS",
		Frequency: FrequencyMonthly, Instalments: 10,
		StartDate: time.Now().AddDate(0, -5, 0),
	})
	if err != nil {
		t.Fatalf("MakePledge: %v", err)
	}

	// Half through the Go path, which writes memberId as a string.
	h.giveAs(t, memberID, 20_000, "")

	// Half as the legacy API writes it: an actual ObjectId.
	oid, err := bson.ObjectIDFromHex(memberID)
	if err != nil {
		t.Fatalf("ObjectIDFromHex: %v", err)
	}
	now := time.Now().UTC()
	if _, err := h.svc.coll.InsertOne(h.ctx, bson.M{
		"memberId": oid, // <- the legacy form
		"type":     string(TypeTithe), "direction": string(DirectionIncome),
		"channel": money.ChannelCash, "grossMinor": int64(20_000),
		"netMinor": int64(20_000), "currency": "GHS",
		"status": string(StatusSuccess), "idempotencyKey": "legacy_pledge_row",
		"reference": "legacy_pledge_row", "occurredAt": now,
		"settledAt": now, "createdAt": now, "updatedAt": now,
	}); err != nil {
		t.Fatalf("insert legacy row: %v", err)
	}

	got, err := h.svc.PledgeByID(h.ctx, made.Pledge.ID.Hex())
	if err != nil {
		t.Fatalf("PledgeByID: %v", err)
	}
	if got.PaidMinor != 40_000 {
		t.Fatalf("paid = %d, want 40000 — one storage form of memberId is being missed",
			got.PaidMinor)
	}
}
