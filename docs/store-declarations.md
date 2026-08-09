# Store privacy declarations

> **Generated. Do not edit.** Run `go run ./cmd/store-declarations` after
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
| Is there a data-deletion URL? | **Yes** | `https://api.altaros.com/api/v1/privacy/data-deletion` |
| Privacy policy URL | | `https://api.altaros.com/api/v1/privacy/policy` |

**Payments.** Card details are never seen by this app or its servers. Paystack
takes the payment and each church is its own merchant (ADR-002), so the app
holds a record that a gift happened, not the instrument that paid for it.

## Google Play — Data Safety

Every category below is collected, linked to the user, **not** used for
tracking, and required for app functionality.

| Play category | What it is | Deleted on account deletion? |
|---|---|---|
| App activity → Other actions | Attendance records | Yes |
| App activity → Other actions | Consent records | Retained (see below) |
| App activity → Other actions | Dates you were unavailable | Yes |
| App activity → Other actions | Event responses | Yes |
| App activity → Other actions | Follow-up about you | Yes |
| App activity → Other actions | Notification settings | Yes |
| App activity → Other actions | Posts you liked | Yes |
| App activity → Other actions | Posts you reported | Yes |
| App activity → Other actions | Serving rota | Yes |
| App activity → Other actions | Your discipleship journey | Yes |
| Device or other IDs → Device or other IDs | Your registered devices | Yes |
| Financial info → Other financial info | Pledges | Anonymised (legal retention — see below) |
| Financial info → Purchase history | Giving and payment records | Anonymised (legal retention — see below) |
| Messages → Other in-app messages | Comments you wrote | Yes |
| Messages → Other in-app messages | Messages we sent you | Yes |
| Messages → Other in-app messages | Posts you wrote | Yes |
| Messages → Other in-app messages | Prayer requests | Yes |
| Personal info → Name, Email address, Phone number | Your login | Yes |
| Personal info → Name, Email address, Phone number, Other info | Your member profile | Yes |
| Personal info → Other info (sensitive: health and hardship) | Welfare and pastoral care records | Yes |

## What survives account deletion, and the reason given to the user

Both stores allow retention where the law requires it, **provided the user is
told**. This is the text the app shows before anyone confirms.

- **Giving and payment records** — Your church must keep its financial records for six years (Revenue Administration Act 2016, s.28) and its accounts must still balance. The amount and date stay; your name is removed and cannot be reconnected.
- **Pledges** — A pledge is part of a campaign's financial history. The amount stays against the campaign; your name is removed.
- **Consent records** — Kept as proof that permission was given and withdrawn, which is what protects you if anyone later asks why you were contacted. It holds a date and a purpose, not a message.

## Retention periods (Ghana Data Protection Act 2012, s.24)

Enforced by a daily sweeper, not merely documented.

| Data | Kept for | Why |
|---|---|---|
| Message delivery history | 720 days | A church may need to show that a giving receipt or a service notice was sent, and two years covers any reasonable dispute. The message body is not needed after that. |
| Registered devices | 360 days | A push token not seen for a year belongs to a phone that is gone. Keeping it serves nobody and it is an identifier for a specific device. |
| Access and administration log | 2555 days | Seven years, matching the longest record-keeping obligation a church has. This is the log that answers 'did somebody look at a welfare case', so it outlives almost everything else on purpose. |
| Resolved moderation reports | 720 days | A moderator's decision is worth keeping while it might be questioned. Two years after it was settled, it identifies who reported whom and serves no other purpose. |
| Completed follow-up | 720 days | Closed follow-up records what was said about somebody's first visit. The pastoral value is in the weeks after; two years later it is a note about a person that nobody is using. |

## Apple — App Store Connect Data Collection

Tick exactly these, all "Linked to You", none "Used for Tracking". They match
`expo.ios.privacyManifests` in apps/mobile/app.json, which is what App
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
  (s.24); data held in the Ghana region (`DATA_REGION=gh`).
- **Revenue Administration Act 2016 (Act 915) s.28** — six years of financial
  records, which is why giving is anonymised rather than deleted.
- **Payment Systems and Services Act 2019 (Act 987)** — the platform never
  holds funds. Each church is its own Paystack subaccount and settles directly
  (ADR-002).
- The church is the **data controller**; ALTAR OS is the **processor**.
