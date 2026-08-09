package privacy

import (
	"strings"
	"testing"
	"time"
)

// These protect the DECISIONS, not the loop. The loop is four lines; the
// dangerous change is somebody adding a collection to the policy that should
// never age out, and a test on DeleteMany would not notice.

// The single most destructive possible edit to this file: putting a church's
// own records, or anything with a legal retention floor, on a timer.
func TestRetentionNeverTouchesRecordsThatMustSurvive(t *testing.T) {
	// Financial: six years under Act 915 s.28, and the church's accounts must
	// reconcile. Congregational: a church's own history, which is not ours to
	// age out on its behalf.
	protected := map[string]string{
		"transactions":              "financial records, six-year statutory floor",
		"pledges":                   "financial commitments against a campaign",
		"members":                   "the congregation itself",
		"attendance":                "the church's own history",
		"events":                    "the church's own calendar",
		"rota_assignments":          "who served, which a church keeps",
		"sermons":                   "the church's own teaching",
		"privacy_deletion_receipts": "evidence a deletion request was honoured",
		"users":                     "accounts; removed by deletion, never by age",
		"welfare_cases":             "removed on deletion, not on a timer",
		"consents":                  "proof permission was given and withdrawn",
	}
	for _, rule := range RetentionPolicy {
		if why, bad := protected[rule.Collection]; bad {
			t.Errorf("%q is on a retention timer but must not be: %s",
				rule.Collection, why)
		}
	}
}

func TestEveryRuleIsUsableAndExplains(t *testing.T) {
	if len(RetentionPolicy) == 0 {
		t.Fatal("no retention periods are decided, which is the s.24 failure itself")
	}
	seen := map[string]bool{}
	for _, r := range RetentionPolicy {
		if r.Collection == "" || r.Field == "" {
			t.Errorf("%q has nothing to age from", r.Label)
		}
		if seen[r.Collection] {
			// Two rules on one collection means the shorter silently wins and
			// the longer is decoration.
			t.Errorf("%q has more than one rule", r.Collection)
		}
		seen[r.Collection] = true

		if r.KeepFor <= 0 {
			t.Errorf("%q keeps data for %s — that deletes everything immediately",
				r.Label, r.KeepFor)
		}
		// s.24 asks a controller to explain the period, not just to have one.
		if len(r.Because) < 60 {
			t.Errorf("%q justifies its period in %d characters: %q",
				r.Label, len(r.Because), r.Because)
		}
		// The readable form is what the disclosure publishes; if it disagrees
		// with the enforced duration the published policy is false.
		wantDays := int(r.KeepFor.Hours() / 24)
		if r.KeepForDays != wantDays {
			t.Errorf("%q enforces %d days but publishes %d",
				r.Label, wantDays, r.KeepForDays)
		}
	}
}

// The access log has to outlive the things it records access to, or it cannot
// answer the question it exists for.
func TestTheAuditLogOutlivesEverythingElse(t *testing.T) {
	var auditFor time.Duration
	longestOther := time.Duration(0)
	for _, r := range RetentionPolicy {
		if r.Collection == "audit_log" {
			auditFor = r.KeepFor
			continue
		}
		if r.KeepFor > longestOther {
			longestOther = r.KeepFor
		}
	}
	if auditFor == 0 {
		t.Fatal("the audit log has no retention rule, so it grows forever")
	}
	if auditFor <= longestOther {
		t.Errorf("the audit log is kept %s but other data is kept %s — the log "+
			"would expire while the records it describes still exist",
			auditFor, longestOther)
	}
	if auditFor < 6*365*24*time.Hour {
		t.Errorf("the audit log is kept %s, less than the six years a church's "+
			"financial records must survive", auditFor)
	}
}

// A rule that ages from a field a finished record does not have would delete
// nothing, forever, while looking like a working control.
func TestRulesScopedToFinishedRecordsAgeFromTheirCompletionField(t *testing.T) {
	for _, r := range RetentionPolicy {
		if len(r.Only) == 0 {
			continue
		}
		if strings.HasSuffix(r.Field, "edAt") && r.Field != "updatedAt" {
			continue // resolvedAt / closedAt: correct
		}
		t.Errorf("%q is scoped to finished records but ages from %q, which is "+
			"not a completion timestamp", r.Label, r.Field)
	}
}

func TestTheDisclosureIsACopyAndCannotMutateThePolicy(t *testing.T) {
	got := RetentionDisclosure()
	if len(got) != len(RetentionPolicy) {
		t.Fatalf("disclosure has %d rules, policy has %d", len(got), len(RetentionPolicy))
	}
	original := RetentionPolicy[0].KeepForDays
	got[0].KeepForDays = 1
	if RetentionPolicy[0].KeepForDays != original {
		t.Error("the published disclosure can rewrite the enforced policy")
	}
}
