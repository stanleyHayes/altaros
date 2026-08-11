package plan

import (
	"testing"
	"time"
)

// A tier decides what a church may do AND what its members' giving costs, so
// the dangerous mistakes here are commercial as well as technical.

// ADR-009's line, expressed as a test. Suspension withdraws features and must
// never touch the commission: raising the rate on a church that has not paid
// takes the shortfall out of its members' giving, which is the forbidden
// netting wearing a different hat.
func TestSuspensionWithdrawsFeaturesAndNeverTouchesGiving(t *testing.T) {
	paid := &Subscription{Tier: TierGrowth, Status: StatusActive}
	unpaid := &Subscription{Tier: TierGrowth, Status: StatusSuspended}

	if !paid.Effective().Streaming {
		t.Fatal("a paying church cannot stream")
	}
	if unpaid.Effective().Streaming {
		t.Error("a suspended church can still stream")
	}
	if unpaid.Effective().MaxConcurrentViewers != 0 {
		t.Error("a suspended church still has viewer capacity")
	}

	if got, want := unpaid.Effective().CommissionBasisPoints,
		paid.Effective().CommissionBasisPoints; got != want {
		t.Fatalf("suspension changed the commission from %d to %d — that "+
			"recovers our fee from money members gave their church, which "+
			"ADR-009 forbids", want, got)
	}
}

// Past due is still inside the grace period, so nothing is withdrawn yet. A
// volunteer treasurer's expired card must not take the livestream down
// mid-service.
func TestPastDueKeepsWorkingDuringGrace(t *testing.T) {
	s := &Subscription{Tier: TierGrowth, Status: StatusPastDue}
	if !s.Effective().Streaming {
		t.Error("a church one day late lost its livestream")
	}

	now := time.Date(2026, 8, 9, 12, 0, 0, 0, time.UTC)
	started := now.Add(-GracePeriod).Add(time.Hour) // just inside
	s.PastDueSince = &started
	if s.GraceExpired(now) {
		t.Error("grace expired early")
	}
	expired := now.Add(-GracePeriod).Add(-time.Minute) // just outside
	s.PastDueSince = &expired
	if !s.GraceExpired(now) {
		t.Error("grace never expires, so unpaid is indistinguishable from paid")
	}
}

// The zero value of MaxConcurrentViewers is 0, and that must mean "none", not
// "unlimited". Every viewer costs bandwidth, so unlimited is the expensive
// direction to be wrong in.
func TestAnUnknownTierFallsBackToTheMostConservativePlan(t *testing.T) {
	e := EntitlementFor(Tier("enterprise-plus-2027"))
	if e.Tier != TierFree {
		t.Errorf("an unrecognised tier resolved to %q", e.Tier)
	}
	if e.Streaming || e.MaxConcurrentViewers != 0 {
		t.Error("an unrecognised tier granted streaming capacity")
	}
	if e.CommissionBasisPoints == 0 {
		t.Error("an unrecognised tier made giving free for us to process — " +
			"a typo in a tier name should not cost the company its revenue")
	}

	// And a church with no subscription record at all.
	var none *Subscription
	if none.Effective().Streaming {
		t.Error("a church with no plan can stream")
	}
}

// The commission must fall as the price rises. That is the entire shape of the
// offer, and a catalogue that broke it would be selling a worse deal for more
// money without anybody noticing in code review.
func TestPayingMoreAlwaysMeansKeepingMoreOfWhatMembersGive(t *testing.T) {
	for i := 1; i < len(Catalogue); i++ {
		prev, cur := Catalogue[i-1], Catalogue[i]
		if cur.MonthlyMinor <= prev.MonthlyMinor {
			t.Errorf("%s costs %d, not more than %s at %d",
				cur.Tier, cur.MonthlyMinor, prev.Tier, prev.MonthlyMinor)
		}
		if cur.CommissionBasisPoints >= prev.CommissionBasisPoints {
			t.Errorf("%s costs more than %s but takes %d bps of giving vs %d — "+
				"a church paying more should keep more",
				cur.Tier, prev.Tier, cur.CommissionBasisPoints, prev.CommissionBasisPoints)
		}
		if cur.MaxConcurrentViewers <= prev.MaxConcurrentViewers {
			t.Errorf("%s allows %d viewers, no more than %s at %d",
				cur.Tier, cur.MaxConcurrentViewers, prev.Tier, prev.MaxConcurrentViewers)
		}
	}
}

// The free tier has to be genuinely usable — a church that cannot run its
// giving without paying never starts — and it is funded by the split.
func TestTheFreeTierWorksAndIsFundedByTheCommission(t *testing.T) {
	free := EntitlementFor(TierFree)
	if free.MonthlyMinor != 0 {
		t.Errorf("the free tier costs %d", free.MonthlyMinor)
	}
	if free.CommissionBasisPoints <= 0 {
		t.Error("the free tier is free to us as well as to them")
	}
	highest := int64(0)
	for _, e := range Catalogue {
		if e.CommissionBasisPoints > highest {
			highest = e.CommissionBasisPoints
		}
	}
	if free.CommissionBasisPoints != highest {
		t.Error("the free tier does not carry the highest commission, so it is " +
			"not funded by the trade it is supposed to be funded by")
	}
}

// A negotiated rate of zero is legitimate — a partner church we take nothing
// from — so it must be distinguishable from "no override set".
func TestAZeroNegotiatedRateIsHonoured(t *testing.T) {
	zero := int64(0)
	s := &Subscription{Tier: TierGrowth, Status: StatusActive,
		CommissionOverrideBasisPoints: &zero}
	if got := s.Effective().CommissionBasisPoints; got != 0 {
		t.Fatalf("a negotiated zero rate was ignored and %d bps charged", got)
	}

	none := &Subscription{Tier: TierGrowth, Status: StatusActive}
	if none.Effective().CommissionBasisPoints != EntitlementFor(TierGrowth).CommissionBasisPoints {
		t.Error("a church with no override did not get its tier's rate")
	}
}
