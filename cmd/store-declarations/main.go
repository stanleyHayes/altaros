// Command store-declarations generates the store privacy answers from the code.
//
// A shipped app states the same facts about its data collection in four
// places: Apple's PrivacyInfo.xcprivacy, App Store Connect's Data Collection
// questionnaire, Google Play's Data Safety form, and the published privacy
// policy. They are maintained by different people at different times, and they
// drift — at which point the app is making inconsistent statements to two
// regulators and two review teams, which is worse than any one of them being
// slightly wrong.
//
// So all four come from one place: internal/domain/privacy.Holdings, the same
// list the export and the deletion actually walk. Regenerate after changing it:
//
//	go run ./cmd/store-declarations > docs/store-declarations.md
package main

import (
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/hayfordstanley/altar-os/internal/domain/privacy"
)

// playCategory maps our categories onto Google Play's Data Safety taxonomy.
//
// Play's list is fixed, so this is a translation rather than a description —
// and the mapping is stated here rather than in somebody's head while they
// tick boxes in the console at midnight.
var playCategory = map[string]string{
	"members":                  "Personal info → Name, Email address, Phone number, Other info",
	"users":                    "Personal info → Name, Email address, Phone number",
	"transactions":             "Financial info → Purchase history",
	"pledges":                  "Financial info → Other financial info",
	"welfare_cases":            "Personal info → Other info (sensitive: health and hardship)",
	"prayer_requests":          "Messages → Other in-app messages",
	"social_posts":             "Messages → Other in-app messages",
	"social_comments":          "Messages → Other in-app messages",
	"notification_devices":     "Device or other IDs → Device or other IDs",
	"notifications":            "Messages → Other in-app messages",
	"attendance":               "App activity → Other actions",
	"rsvps":                    "App activity → Other actions",
	"discipleship_journeys":    "App activity → Other actions",
	"discipleship_tasks":       "App activity → Other actions",
	"rota_assignments":         "App activity → Other actions",
	"rota_unavailability":      "App activity → Other actions",
	"social_likes":             "App activity → Other actions",
	"social_reports":           "App activity → Other actions",
	"consents":                 "App activity → Other actions",
	"notification_preferences": "App activity → Other actions",
}

func main() {
	var b strings.Builder

	fmt.Fprintf(&b, `# Store privacy declarations

> **Generated. Do not edit.** Run `+"`go run ./cmd/store-declarations`"+` after
> changing internal/domain/privacy.Holdings or RetentionPolicy.

These are the answers for App Store Connect and the Play Console. They are
generated from the same list the app's data export and account deletion walk,
so the two consoles, the iOS privacy manifest and the published privacy policy
cannot state different things.

## The answers that are the same on both stores

| Question | Answer | Why |
|---|---|---|
| Is data used to track users? | **No** | No advertising SDK, no analytics SDK, no crash reporter, no data broker. Nothing is shared with third parties for advertising or measurement. |
| Is data linked to the user? | **Yes** | A church directory is not anonymous — knowing who is in the congregation is the product. |
| Is data encrypted in transit? | **Yes** | TLS only; the app refuses a non-HTTPS API URL. |
| Can users request deletion? | **Yes** | In-app (Profile → Your data) and at a public URL that works without the app. |
| Is there a data-deletion URL? | **Yes** | `+"`https://api.altaros.com/api/v1/privacy/data-deletion`"+` |
| Privacy policy URL | | `+"`https://api.altaros.com/api/v1/privacy/policy`"+` |

**Payments.** Card details are never seen by this app or its servers. Paystack
takes the payment and each church is its own merchant (ADR-002), so the app
holds a record that a gift happened, not the instrument that paid for it.

## Google Play — Data Safety

Every category below is collected, linked to the user, **not** used for
tracking, and required for app functionality.

| Play category | What it is | Deleted on account deletion? |
|---|---|---|
`)

	// Stable order, so regenerating produces no spurious diff.
	holdings := make([]privacy.Holding, len(privacy.Holdings))
	copy(holdings, privacy.Holdings)
	sort.Slice(holdings, func(i, j int) bool {
		if playCategory[holdings[i].Collection] != playCategory[holdings[j].Collection] {
			return playCategory[holdings[i].Collection] < playCategory[holdings[j].Collection]
		}
		return holdings[i].Label < holdings[j].Label
	})

	missing := 0
	for _, h := range holdings {
		cat, ok := playCategory[h.Collection]
		if !ok {
			cat = "**UNMAPPED — add it to cmd/store-declarations**"
			missing++
		}
		deleted := "Yes"
		switch h.Disposition {
		case privacy.Anonymised:
			deleted = "Anonymised (legal retention — see below)"
		case privacy.Retained:
			deleted = "Retained (see below)"
		}
		fmt.Fprintf(&b, "| %s | %s | %s |\n", cat, h.Label, deleted)
	}

	fmt.Fprintf(&b, `
## What survives account deletion, and the reason given to the user

Both stores allow retention where the law requires it, **provided the user is
told**. This is the text the app shows before anyone confirms.

`)
	for _, h := range privacy.Holdings {
		if h.Disposition == privacy.Erased {
			continue
		}
		fmt.Fprintf(&b, "- **%s** — %s\n", h.Label, h.Because)
	}

	fmt.Fprintf(&b, `
## Retention periods (Ghana Data Protection Act 2012, s.24)

Enforced by a daily sweeper, not merely documented.

| Data | Kept for | Why |
|---|---|---|
`)
	for _, r := range privacy.RetentionDisclosure() {
		fmt.Fprintf(&b, "| %s | %d days | %s |\n", r.Label, r.KeepForDays, r.Because)
	}

	fmt.Fprintf(&b, `
## Apple — App Store Connect Data Collection

Tick exactly these, all "Linked to You", none "Used for Tracking". They match
`+"`expo.ios.privacyManifests`"+` in apps/mobile/app.json, which is what App
Review compares the binary against.

- Contact Info → Name, Email Address, Phone Number
- Financial Info → Other Financial Info
- User Content → Other User Content
- Identifiers → User ID, Device ID
- Sensitive Info
- Other Data

**Sensitive Info is not optional.** Membership of a church is religious belief,
and welfare records describe hardship and health.

## Ghana

- **Data Protection Act 2012 (Act 843)** — consent recorded per purpose; access
  (s.32) and erasure (s.33) in-app; retention periods decided and enforced
  (s.24); data held in the Ghana region (`+"`DATA_REGION=gh`"+`).
- **Revenue Administration Act 2016 (Act 915) s.28** — six years of financial
  records, which is why giving is anonymised rather than deleted.
- **Payment Systems and Services Act 2019 (Act 987)** — the platform never
  holds funds. Each church is its own Paystack subaccount and settles directly
  (ADR-002).
- The church is the **data controller**; ALTAR OS is the **processor**.
`)

	if missing > 0 {
		fmt.Fprintf(os.Stderr,
			"warning: %d holding(s) have no Play category mapping — the generated "+
				"table says UNMAPPED and the Data Safety form would be incomplete\n", missing)
	}
	fmt.Print(b.String())
	if missing > 0 {
		os.Exit(1)
	}
}
