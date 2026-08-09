package privacy

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

// These need no database. What they check is that the DISCLOSURE and the
// ERASURE PLAN are the same list — which is the property that stops the app
// telling somebody one thing and doing another, and it is a property of the
// data, not of a query.

func TestEveryHoldingSaysWhatHappensAndWhy(t *testing.T) {
	if len(Holdings) == 0 {
		t.Fatal("nothing is declared, so the export discloses nothing")
	}
	for _, h := range Holdings {
		if h.Collection == "" || h.Field == "" {
			t.Errorf("%q has no collection or field to act on", h.Label)
		}
		if h.Label == "" {
			t.Errorf("%s has no human label — an export section nobody can read",
				h.Collection)
		}
		// Every category owes a reason. "Removed completely." is a complete
		// answer, so the bar is only that one exists.
		if strings.TrimSpace(h.Because) == "" {
			t.Errorf("%q gives the member no reason at all", h.Label)
		}
		// But anything that SURVIVES has to justify itself properly. That is
		// where somebody can reasonably feel misled, and it is the disclosure
		// Apple 5.1.1(v) requires before retention is permissible at all.
		if h.Disposition != Erased && len(h.Because) < 60 {
			t.Errorf("%q survives deletion but explains why in only %d "+
				"characters: %q", h.Label, len(h.Because), h.Because)
		}
		switch h.Disposition {
		case Erased, Anonymised, Retained:
		default:
			t.Errorf("%q has disposition %q, which the deletion loop ignores — "+
				"so the record would silently survive", h.Label, h.Disposition)
		}
	}
}

// An anonymised row that keeps a name is not anonymised.
func TestAnonymisedHoldingsNameTheFieldsTheyWipe(t *testing.T) {
	for _, h := range Holdings {
		if h.Disposition != Anonymised {
			continue
		}
		if len(h.IdentityFields) == 0 {
			t.Errorf("%q is anonymised but wipes no fields — the row would keep "+
				"the member id and the anonymisation would be a lie", h.Label)
		}
		var wipesLink bool
		for _, f := range h.IdentityFields {
			if f == h.Field {
				wipesLink = true
			}
		}
		if !wipesLink {
			t.Errorf("%q anonymises without wiping %q, the very field that links "+
				"the row to the person", h.Label, h.Field)
		}
	}
}

// The financial records must survive, and must survive for a stated reason.
// A future edit that "simplifies" this to Erased would leave a church unable
// to reconcile its own bank statement.
func TestGivingRecordsAreAnonymisedAndNotDeleted(t *testing.T) {
	var found bool
	for _, h := range Holdings {
		if h.Collection != "transactions" {
			continue
		}
		found = true
		if h.Disposition != Anonymised {
			t.Fatalf("giving records are %q — a church must keep six years of "+
				"financial records (Act 915 s.28) and its accounts must balance",
				h.Disposition)
		}
		if !strings.Contains(strings.ToLower(h.Because), "six years") {
			t.Errorf("the reason given to the member does not state the "+
				"retention period: %q", h.Because)
		}
	}
	if !found {
		t.Fatal("giving records are not declared at all, so deletion would miss them")
	}
}

// The two most sensitive categories must be erased outright, never merely
// anonymised — a welfare case with the name removed still describes a crisis
// in a congregation small enough to guess.
func TestTheMostSensitiveRecordsAreErasedOutright(t *testing.T) {
	for _, want := range []string{"welfare_cases", "prayer_requests"} {
		var seen bool
		for _, h := range Holdings {
			if h.Collection != want {
				continue
			}
			seen = true
			if h.Disposition != Erased {
				t.Errorf("%s is %q, want erased outright", want, h.Disposition)
			}
		}
		if !seen {
			t.Errorf("%s is not declared, so deletion would leave it behind", want)
		}
	}
}

// The login and profile must go last. If the run dies halfway, the person must
// still exist so the request can be retried — an account with no name and a
// full giving history attached is unrecoverable.
func TestIdentityIsErasedLast(t *testing.T) {
	posOf := func(collection string) int {
		for i, h := range Holdings {
			if h.Collection == collection {
				return i
			}
		}
		return -1
	}
	users, members := posOf("users"), posOf("members")
	if users < 0 || members < 0 {
		t.Fatal("the login or the profile is not in the erasure plan")
	}
	for i, h := range Holdings {
		if h.Collection == "users" || h.Collection == "members" {
			continue
		}
		if i > users || i > members {
			t.Errorf("%q is erased after the identity, so a failure part-way "+
				"leaves an unrecoverable account", h.Label)
		}
	}
}

// Both storage forms, or deletion silently leaves half the person behind —
// the ADR-005 trap that has already produced two bugs in this codebase.
func TestTheMatcherCoversBothIdentifierStorageForms(t *testing.T) {
	const hexID = "6a6f3460a6b0e0738ca16496"
	rendered := fmt.Sprintf("%v", matcher("memberId", hexID))

	// Both forms have to appear: the plain string the Go side writes, and the
	// ObjectId the legacy TypeScript API writes (ADR-005). Matching one leaves
	// half the person behind and still reports success.
	if strings.Count(rendered, hexID) < 2 {
		t.Errorf("matcher covers only one storage form: %s", rendered)
	}

	// A non-hex id has no ObjectId form and must not invent one.
	plain := fmt.Sprintf("%v", matcher("memberId", "not-hex"))
	if strings.Count(plain, "not-hex") != 1 {
		t.Errorf("matcher invented a second form for a non-hex id: %s", plain)
	}
}

// The grace period exists so a mistaken tap is survivable. These are the rules
// that make "deleted" honest without making it irreversible on impulse.

func TestAPendingDeletionIsRestorableAndAPurgedOneIsNot(t *testing.T) {
	now := time.Date(2026, 8, 9, 12, 0, 0, 0, time.UTC)

	pending := &Receipt{Status: StatusPending, PurgeAfter: now.Add(GracePeriod)}
	if !pending.Restorable(now) {
		t.Error("a fresh deletion cannot be undone — one mistaken tap is final")
	}
	// The day before the window closes it is still recoverable.
	if !pending.Restorable(now.Add(GracePeriod - time.Hour)) {
		t.Error("the window closed early")
	}
	// After it, never.
	if pending.Restorable(now.Add(GracePeriod + time.Second)) {
		t.Error("an expired deletion still claims to be restorable")
	}

	for _, s := range []Status{StatusPurged, StatusCancelled} {
		done := &Receipt{Status: s, PurgeAfter: now.Add(GracePeriod)}
		if done.Restorable(now) {
			t.Errorf("a %s deletion claims to be restorable", s)
		}
	}
	var none *Receipt
	if none.Restorable(now) {
		t.Error("a nil receipt claims to be restorable")
	}
}

// Long enough to notice a mistake, short enough that "deleted" stays honest.
// Both stores accept a window; neither accepts an indefinite one.
func TestTheGracePeriodIsBoundedAndReasonable(t *testing.T) {
	if GracePeriod < 7*24*time.Hour {
		t.Errorf("grace period is %s — too short for somebody to notice a "+
			"mistaken deletion while they are away", GracePeriod)
	}
	if GracePeriod > 90*24*time.Hour {
		t.Errorf("grace period is %s — an account kept that long is retained, "+
			"not deleted, whatever the flag says", GracePeriod)
	}
}
