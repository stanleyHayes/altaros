# ALTAR OS — Agent Execution Plan

> **Source of truth:** `ALTAR OS.pdf` (Stanley Hayford, 28 Mar 2026), expanded with market, regulatory, and technical research conducted 31 Jul 2026.
> **Audience:** coding agents and the humans directing them. Every work package is written to be picked up cold.
> **Status:** Plan v1. Not yet executed.

---

## How to use this document

Work packages are `WP-nn`, grouped into phases. Each has **Depends on**, **Deliverable**, and **Done when** — treat "Done when" as the acceptance test. Do not start a WP whose dependencies are unmet. Do not mark a WP complete on the basis of "code written"; the verification command must pass.

Sections §0–§6 are context every agent should read before touching code. §7 is the work. §8 is what this plan adds beyond the PDF. §9–§10 are risks and unresolved questions.

**Read the red callout at the top of §0 first.** The repo has no commits and 48 files exist only in the git index; WP-00b and WP-00c must run before anything else in this plan.

---

## §0. Ground truth — what actually exists today

This was audited directly against the repo, not assumed. **The PDF describes a system that does not exist yet; the repo contains a different, partially-built system.**

> ## ✅ RESOLVED — 31 Jul 2026, commit `7feade5`
>
> **This section described a repository with zero commits.** Verified at the time: `git rev-parse HEAD` → `fatal: ambiguous argument 'HEAD'`. No commits, no branches, no stash. All 239 staged files existed **only in `.git/index`** — including 48 already deleted from the working tree, which existed *nowhere else on disk*. A single `git reset` would have destroyed them irrecoverably.
>
> **Action taken (WP-00 · WP-00b · WP-00c, all complete):**
>
> 1. All 48 index-only files backed up outside the repo as a safety net.
> 2. All 48 restored **in place** — 32 backend `apps/api` files (6 domains + all routes/controllers) and 16 frontend components across `dashboard`, `mobile`, `admin`, `web`.
> 3. Dangling-import scan re-run: **zero unresolved imports** across `apps/`.
> 4. Initial commit `7feade5` created — 317 files, clean working tree. Every one of the 48 verified present in the commit tree with intact content.
>
> **Note on sequencing, preserved because it is a live trap:** `git add -A` would have staged those 48 files as *deletions*, dropping them from the very commit meant to rescue them. Restoring in place had to happen first.
>
> **Still outstanding:** the commit is local only. `git remote add origin <url> && git push -u origin main` — the repo has no remote and therefore no off-machine copy. See §10 Q-0.

### 0.1 What the repo really is

| Layer | PDF says | Repo actually has | Verdict |
|---|---|---|---|
| Mobile | React Native | Expo + React Native, React Navigation, `expo-camera`, `expo-notifications`, `expo-secure-store` | 🟡 **Builds and exports; WP-19 native/provider QA still open** (§0.2) |
| Web admin | React + TypeScript | React + MUI + Vite — `dashboard`, `web`, `admin`, `marketing` | ⚠️ **Right stack, 3 of 4 broken** (§0.2) |
| Backend | Golang microservices, gRPC + REST | TypeScript / Express / Mongoose, hexagonal ports-and-adapters | ❌ **Diverges** |
| Database | MySQL + Redis | MongoDB (Mongoose), no Redis | ❌ **Diverges** |
| Messaging | Kafka | none | ❌ **Absent** |
| Deploy | Docker + Kubernetes | `vercel.json` targeting two frontends | ❌ **Diverges** |
| Contracts | — | `packages/shared-types` — 15 domain modules, complete | ➕ **Bonus asset — the only intact layer** |

### 0.2 The blocking finding: five of six workspaces do not build

This is repo-wide, not backend-only. **48 files were staged-as-added and then deleted from the working tree** (git status `AD`) — 32 backend `.ts` and 16 frontend `.tsx`. **Every single one is still imported by surviving code.** Verified by resolving each deleted module against live `import` statements.

**Backend — `apps/api` does not compile:**
- All 12 domain folders under [apps/api/src/domain/](apps/api/src/domain/) are **empty on disk**.
- [controllers/](apps/api/src/interfaces/http/controllers/) and [routes/](apps/api/src/interfaces/http/routes/) are **empty directories**.
- [apps/api/src/index.ts:7](apps/api/src/index.ts#L7) imports `./interfaces/http/routes/index.js`, which no longer exists.
- Only 13 `.ts` files survive — entrypoint, `infrastructure/`, one test.

**Frontends — dangling imports in four apps:**

| App | Dangling imports | Examples |
|---|---|---|
| `dashboard` | 8 | [MainLayout.tsx:4-5](apps/dashboard/src/components/layout/MainLayout.tsx#L4-L5) → `Sidebar`, `Header`; `MembersPage`, `EventsPage`, `FinancePage`, `CommunicationsPage` |
| `mobile` | 8 | [BottomTabs.tsx:3-7](apps/mobile/src/components/navigation/BottomTabs.tsx#L3-L7) → `HomeScreen`, `GivingScreen`, `FeedScreen`, `EventsScreen`, `ProfileScreen`; [AppNavigator.tsx:8](apps/mobile/src/components/navigation/AppNavigator.tsx#L8) → `RegisterScreen` |
| `admin` | 2 | [MainLayout.tsx:5-6](apps/admin/src/components/layout/MainLayout.tsx#L5-L6) → `Sidebar`, `Header` |
| `web` | 1 | [EventsPage.tsx:3](apps/web/src/pages/EventsPage.tsx#L3) → `EventCard` |
| `marketing` | 0 | intact |

**Everything is recoverable from the git index** — verified end-to-end, not assumed. Note the flag: these files are *added* in the index and *deleted* in the worktree, so the diff is index-vs-worktree (`git diff`), **not** HEAD-vs-index (`git diff --cached`, which returns nothing here).

**Consequence for sequencing.** Two distinct recovery jobs, and they are not the same job:
- The **32 backend `.ts` files** are a working reference implementation of the domain logic — auth flows, repository ports, service contracts. They are the port specification for the Go rewrite, and are recovered to `reference/` rather than restored in place (WP-00).
- The **16 frontend `.tsx` files** are live production code for apps ADR-001 explicitly keeps. They are **restored in place** (WP-00b), and this is a Phase 0 blocker — no frontend work of any kind can proceed until it is done.

**Coverage caveat on the backend reference:** the deleted `.ts` files cover only **6 of the 12** domains — `auth`, `church`, `communication`, `event`, `finance`, `member`. The other six (`ai`, `giving`, `notification`, `social`, `spiritual`, `welfare`) are empty directories that never had committed implementations. Those six get no reference code and must be built from `shared-types` and the PDF alone — budget accordingly.

### 0.3 Integrations are all stubs

[payment.service.ts](apps/api/src/infrastructure/services/payment.service.ts), [sms.service.ts](apps/api/src/infrastructure/services/sms.service.ts), `email.service.ts`, `push.service.ts`, `storage.service.ts` define interfaces with `Stub*` implementations. `StubPaymentGateway.verifyCharge()` **returns `status: "success"` unconditionally** — a stub that silently green-lights every payment. It must never reach an environment where anyone can send money.

`.env.example` already names the intended providers: Paystack, Africa's Talking, Resend, Firebase, Cloudinary.

### 0.4 Toolchain is ready

Verified present: **Go 1.26.5**, **Docker 28.3.3**, **kubectl v1.33.4 / kustomize v5.6.0**, **protoc 33.2**. Nothing needs installing to start the Go work. Note `node_modules` is absent — the TS workspace has never been installed in this checkout.

---

## §1. Locked decisions

Confirmed by the project owner, 31 Jul 2026. These are settled; do not relitigate them mid-build.

### ADR-001 — The PDF wins. Rewrite the backend in Go.
**Decision:** Target the PDF architecture: Go microservices, MySQL, Redis, Kafka, Docker, Kubernetes.
**Scope of the rewrite is backend-only.** The PDF's frontend spec (React Native mobile, React + TypeScript admin) is *exactly what already exists*. All five frontends are kept and evolved, not rebuilt — but four of them are currently broken by deleted components and must be **restored first** (WP-00b, §0.2). "Kept" is a decision about direction, not a statement that they currently work.
**Consequence:** `apps/api` is replaced by `services/*` in Go. `packages/shared-types` is promoted from an incidental package to the **canonical contract**, and Go structs are generated to match it (§4.4).
**Cost accepted:** longer runway to first revenue than continuing in TypeScript. The owner has accepted this.

### ADR-002 — Church-as-merchant. ALTAR OS never holds church funds.
**Decision:** Every church is its own Paystack (or Flutterwave) **subaccount**. Money settles directly from the payer to the church. ALTAR OS takes a percentage split as commission and never takes custody.
**Why this is the highest-leverage decision in the document:** pooling tithes into an ALTAR OS account and disbursing to churches is **merchant aggregation** under Ghana's Payment Systems and Services Act, 2019 (Act 987) — a licensed activity requiring a **PSP Medium** licence, minimum capital, and local equity structure. The subaccount model routes around the entire licensing project.
**Consequence, and it is a hard invariant:** no ALTAR OS-controlled wallet, float, escrow, or "pending payout" balance holding church money. Any feature request implying one triggers a licensing review before a line of code (§9, R-2).

### ADR-003 — Full breadth. All 16 PDF sections are in scope.
**Decision:** Build across the whole PDF surface rather than sequencing a narrow revenue slice first.
**Risk accepted and mitigated:** breadth-first on a rewrite is the classic way to have nothing demoable for months. Mitigation is structural, not optional — **Phase 1 ends at a vertical slice that runs end-to-end** (auth + member + giving, one live payment, one real SMS) before Phase 2 fans out across the remaining domains. Phase 1 is the walking skeleton; Phase 2 is the breadth.

### ADR-004 — Modular monolith deploy, microservice boundaries.
**Decision:** Write the eight services from PDF §12 as genuinely separate Go modules with their own gRPC contracts and no shared database tables — but **deploy them as one binary with a build flag per service until traffic justifies splitting**.
**Why:** the PDF's 8-service topology is correct as a *boundary* design and premature as a *deployment* design for a pre-launch product. Getting the boundaries right early is cheap; operating 8 K8s deployments before the first paying church is not. The code is written so that splitting is a deploy-config change, never a refactor.
**Trigger to split a service out:** it needs independent scaling, an independent release cadence, or its failure must not take the others down. Finance and Notification will hit this first.

### ADR-005 — MongoDB, not MySQL. Supersedes the datastore half of ADR-001.
**Decision (31 Jul 2026):** the Go services use **MongoDB** via the official **MongoDB Go Driver** (`go.mongodb.org/mongo-driver/v2`). Redis and Kafka are unchanged.
**Note on Mongoose:** Mongoose is a Node-only ODM and has no Go equivalent. Go uses the official driver directly; if Mongoose-style model helpers are wanted later, `mgm` or `qmgo` wrap the driver. Nothing named "Mongoose" will exist in the Go tree.
**Why this is a good trade rather than a concession:** the legacy TypeScript API already runs on MongoDB, so the Go services and the TS API **share one database throughout the migration** instead of operating MySQL and Mongo side by side and syncing between them. It also removes the migration-tooling work (`golang-migrate`, `sqlc`) from the critical path.
**What it costs, stated plainly:** the relational guarantees §5 leaned on are no longer free. Three things become explicit engineering rather than schema declarations:
1. **Money.** `DECIMAL(19,4)` does not exist. Store money as **integer minor units** (`amount_minor` int64 + `currency`), never float64 — BSON `double` is IEEE-754 and will lose cents.
2. **Referential integrity.** No foreign keys. Cross-collection consistency is enforced in the service layer, and multi-document writes that must be atomic use transactions (available on a replica set; the single-node local container is fine for development but production needs a replica set).
3. **Tenant isolation.** §4.5's "leading column of every index" becomes "`church_id` is the **first field of every compound index**", and the query wrapper still refuses to build a tenant-scoped filter without it. The guarantee is unchanged; the mechanism is.
**Consequence:** §5's `CREATE TABLE` definitions are superseded — read them as the **field-level contract** (names, types, required/optional, money as minor units, the unique constraints that make payments idempotent), and implement them as MongoDB collections with equivalent unique indexes. The two `uq_idempotency` / `uq_provider_ref` constraints in §5.2 remain **mandatory unique indexes**: they are what stop a retried payment webhook from recording a tithe twice.


### ADR-006 — Identity is workspace-scoped. The same person is a different user in each church.

**Decision (1 Aug 2026):** every account belongs to exactly one church. Signing in requires a **workspace** (the church's slug) alongside the credential, and uniqueness moves from global `email` to compound `(churchId, email)` and `(churchId, phone)`.

**Why this is forced rather than chosen.** WP-12 already established that the same phone number may legitimately belong to two churches — a member who attends one congregation and helps run another's youth ministry is ordinary, not an edge case. Today `users.email` is globally unique in **both** writers (Mongoose declares `unique: true`, Go declares `email_unique`), so that person cannot have an account in the second church at all. Requiring a workspace at login is what makes per-church identity possible, and per-church identity is what makes "a private workspace only for its members" true rather than aspirational.

**What it costs, stated plainly.** This is a **breaking index change on a shared collection** (ADR-005: the Go services and the legacy TypeScript API write the same database). Dropping a unique index while both writers are live is the kind of migration that fails quietly, so it is sequenced explicitly in WP-35 and gated behind a backfill that proves no `(churchId, email)` collisions exist before the old index is dropped.

**Consequence for the login screen:** the workspace is pre-filled and hidden when the user is already on `grace.altaros.com` — the subdomain *is* the workspace. It is only typed on the shared `app.altaros.com` entry point. A member of one church should never have to know they are in a multi-tenant system.

### ADR-007 — Every church gets a subdomain and a site it controls.

**Decision:** `<slug>.altaros.com` serves that church's own public website, built by the church from a fixed block library. A church may later point its own domain at the platform.

**Why a block library and not free HTML.** A church editor is not a web developer, and an editor that accepts arbitrary HTML or CSS is an XSS vector aimed at that church's own members — the people most likely to trust the page. Blocks are typed, validated on both sides, and rendered by components the platform owns. The cost is that a church cannot build *anything*; the benefit is that it cannot build something that harms its congregation.

**Not a Webflow clone.** v1 ships roughly a dozen block types that cover what a church site actually contains, and deliberately omits a free-form layout engine, custom code blocks, and per-block CSS. Those are the features that turn a CMS into a support burden.

### ADR-008 — Permissions are an overlay on a role, not a copy of one.

**Decision:** a user's effective permissions are computed, never stored as a snapshot:

```
effective = (role.permissions − user.revoked) ∪ user.granted, then dependency-expanded
```

**Why this is the whole design.** The requirements contain an apparent contradiction: an individual's permissions must be alterable *without affecting the role* (5), and role permissions must be updatable (8). A snapshot satisfies 5 and breaks 8 — edit the role and nobody's permissions change. A pure role reference satisfies 8 and breaks 5 — there is nowhere to put an individual grant. The overlay satisfies both, because the role is read live and the individual's deltas are applied on top.

**The behaviour this implies, which someone should agree to explicitly:** if an admin grants Ama `finance:read` individually, and the role she holds *later loses* `finance:read`, **Ama keeps it**. That is what "altered without affecting the original role permissions" means, and it is correct — but it means an admin removing a permission from a role has not necessarily removed it from everyone, and the UI must say so. See §10 Q-11.

---

## §2. Market context (research)

The PDF has no competitive or market section. This is that section.

### 2.1 The incumbent nobody in the PDF mentions

**Asoriba** — Accra, founded 2015. Web + mobile church management: member database, attendance, finance, events, branch integration, group/leadership management, digital giving. Won the Ghanaian *and* pan-African Seedstars World competitions; Barclays Accelerator Africa alumnus. Reported ~1,100 churches and ~69,000 member records, 98% Ghana-concentrated, with presence in Nigeria, Kenya and South Africa.

**Read this correctly.** Asoriba proves the market is real and reachable, and its numbers reveal the actual hard problem: ~63 members per church on average and 98% single-country concentration after years of operating. Church signup is not the constraint — **per-church member activation and multi-country expansion are**. ALTAR OS should be designed around member-side daily-active use and multi-country readiness from day one, which is precisely where the mobile app, offline support, and WhatsApp channel (§8) earn their place.

### 2.2 Global incumbents (pricing benchmarks)

| Product | Positioning | Pricing |
|---|---|---|
| Planning Center | Modular ChMS, mid-to-large US churches | $0–$1,466/mo by module |
| Tithe.ly | Giving-first; ChMS still maturing | Free tier (transaction fees only); ~$119/mo All-Access |
| Breeze | Small-church simplicity | ~$72/mo flat |
| Subsplash | Media/app/streaming-led; management secondary | ~$99–$299/mo custom |
| Pushpay / ChurchStaq | Enterprise, multi-site | $199–$399/mo giving; $500–$1,500+/mo bundled |

**Implication for PDF §16 (Monetization):** these are US price points against US church budgets. Ghanaian tier pricing must be set independently — likely GHS-denominated, per-member-band, with the free tier deliberately generous to win branch networks. The transaction-fee line will out-earn the SaaS line at scale, which reinforces ADR-002: the commission split *is* the business model, so the split mechanics must be correct and auditable from the first transaction.

### 2.3 Why Ghana, quantified

- Mobile money transaction value reached **GH¢3.6 trillion Jan–Oct 2025**; December 2025 alone was GH¢518.4bn.
- **74.1 million** registered MoMo accounts (Feb 2025), up from 66.9m a year earlier.
- **59.7% of adults** use mobile money for payments, transfers, and savings.
- **896,000 registered agents**, 411,000 active.
- **E-Levy is active at 1% on transfers above GHS 100/day** (as of April 2026) — despite widely-reported expectations of permanent abolition.

**Two consequences for the build:**
1. Mobile money is not a payment *option*, it is the default rail. Card is the fallback. Design the giving UX MoMo-first.
2. E-Levy must be **modelled explicitly in the finance domain** — displayed to the giver before confirmation, stored on the transaction record, and excluded from the church's recognised income. A giving flow that quietly under-delivers versus the amount debited will destroy trust faster than any bug. This is a schema requirement (§5), not a UI nicety.

---

## §3. Regulatory & compliance spine (research)

**The PDF's §10 covers JWT, RBAC, TLS, PCI-DSS-via-providers, and fraud detection. That is application security, not compliance.** For a platform holding religious affiliation data on hundreds of thousands of Africans and touching payment flows, the compliance surface is materially larger — and Ghana entered active enforcement this year.

### 3.1 Ghana — Data Protection Act, 2012 (Act 843)

- **Registration is mandatory.** §27(1) requires every data controller intending to process personal data to register with the Data Protection Commission *before* processing. Valid two years, then renewable.
- **Processing unregistered is a criminal offence** — up to 250 penalty units, up to two years' imprisonment, or both.
- **2026 is the enforcement year.** At the National Data Protection Conference in Accra (2 Mar 2026) the Communications Minister confirmed a policy directive instructing the DPC to fine non-registered and non-compliant organisations. At Data Protection Week (Jan 2026) the DPC's Executive Director stated there would be **no exemptions** from registration.
- **Exposure: up to GHS 3 million or 5% of annual turnover, whichever is higher** (April 2026 figures).

### 3.2 Nigeria and Kenya (expansion markets)

- **Nigeria — NDPA 2023:** processing personal data of **over 200 data subjects** makes you a Data Controller of Major Importance, requiring registration with the NDPC within 6 months. Penalties under §48(1)(a) may exceed **₦10 million and 2% of annual gross revenue**. A single mid-size church exceeds the 200-subject threshold on its own.
- **Kenya — DPA 2019 §18:** registration with the ODPC required before processing, for controllers with annual turnover **≥ KES 5,000,000** or **more than 10 employees**.

### 3.3 The part that is easy to miss

**Church membership data reveals religious belief.** Under all three regimes this is a *special category* of personal data attracting the strictest handling: explicit consent, purpose limitation, and heightened breach consequences. Everything ALTAR OS stores is, by construction, sensitive.

Three data classes need above-baseline handling and must be designed for, not retrofitted:

| Data | Why it is high-risk |
|---|---|
| Membership records | Reveals religious affiliation — special category in GH/NG/KE |
| **Prayer requests** | Frequently contains health, family-crisis, financial-distress, and abuse disclosures. Potentially the most sensitive data in the entire system. The PDF treats it as a feed item. |
| **Welfare / assistance requests** | Financial hardship and vulnerability data |

### 3.4 Compliance requirements this imposes on the build

These are **engineering requirements**, tracked as WPs, not a legal to-do list:

1. **Consent is a first-class record** — timestamped, versioned, per-purpose (membership / communications / giving / AI processing), independently revocable, with a full audit trail. (WP-06)
2. **Data subject rights are API endpoints**, not manual ops: export, rectify, erase. (WP-42)
3. **Prayer requests and welfare cases are encrypted at rest with separate key material** and a strict ACL — visible only to the specific pastoral role assigned, never in general admin views, never in analytics aggregates, never in AI training or fine-tuning data. (WP-27, WP-30)
4. **Per-country data residency is a tenant configuration**, because expansion regimes may diverge. (WP-05)
5. **Audit log is append-only and covers every access to sensitive data**, not just mutations. Reads matter here. (WP-08)
6. **Registration with the Ghana DPC is a launch gate.** Track as a business task, blocking production launch — see §10, Q-1.

### 3.5 Bible content licensing — a real legal trap

PDF §5.3 specifies "Bible (offline supported)". Research finding: **you cannot simply ship translations.**

- **NIV is not available for commercial use** through API.Bible.
- **ESV** is free for non-commercial use only (API key, 5,000 queries/day, max 500 verses/query); commercial use requires a separate licence negotiated with Crossway.
- **API.Bible** offers per-translation commercial licensing from roughly $10/month/translation, with availability varying by publisher.

A monetised church platform is unambiguously commercial. **Ship public-domain translations only (KJV, WEB) until per-translation commercial licences are signed** — plus local-language translations where rights are obtainable, which matters more to the actual user (§8.4). (WP-28)

---

## §4. Target architecture

### 4.1 Topology

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Expo Mobile  │  │ Dashboard    │  │ Admin        │  │ Marketing    │
│ (members)    │  │ (church)     │  │ (platform)   │  │ (public)     │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       └─────────────────┴─────────────────┴─────────────────┘
                                │ REST/JSON + JWT
                    ┌───────────▼────────────┐
                    │   API Gateway (Go)     │  authn, rate limit, tenant
                    │   chi + grpc clients   │  resolution, request ID
                    └───────────┬────────────┘
                                │ gRPC (internal)
   ┌────────┬────────┬──────────┼──────────┬─────────┬─────────┬────────┐
   ▼        ▼        ▼          ▼          ▼         ▼         ▼        ▼
 auth    church   member    finance    event   comms      ai     notify
   │        │        │          │          │         │         │        │
   └────────┴────────┴──────────┴──────────┴─────────┴─────────┴────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
        ┌──────────┐     ┌───────────┐     ┌────────────┐
        │  MySQL 8 │     │   Redis   │     │   Kafka    │
        │ (per-svc │     │  cache /  │     │  domain    │
        │  schema) │     │  session  │     │  events    │
        └──────────┘     └───────────┘     └────────────┘
                                │
                    ┌───────────▼────────────┐
                    │ Cloudinary · Paystack  │
                    │ Africa's Talking ·     │
                    │ Resend · FCM · Claude  │
                    └────────────────────────┘
```

Per ADR-004 these compile into one binary (`cmd/altar`) with a `-service` flag, and split into separate K8s Deployments on demand without code change.

### 4.2 Repository layout after the rewrite

```
altar-os/
├── apps/                          # KEPT — all five frontends stay (restored per WP-00b)
│   ├── mobile/  dashboard/  web/  admin/  marketing/
├── packages/
│   ├── shared-types/              # CANONICAL CONTRACT — TS source of truth
│   ├── tsconfig/  eslint-config/
├── proto/                         # NEW — protobuf, generated from shared-types
│   └── altar/v1/*.proto
├── services/                      # NEW — the Go backend
│   ├── gateway/
│   ├── auth/  church/  member/  finance/  event/
│   ├── communication/  ai/  notification/
│   └── internal/                  # shared Go: tenancy, audit, errors, config
├── migrations/                    # NEW — golang-migrate, per service schema
├── deploy/                        # NEW — Dockerfiles, K8s manifests, kustomize
├── reference/                     # NEW — recovered TS domain code (WP-00)
├── go.mod  go.work
└── agent_plan.md
```

`apps/api` is deleted only after WP-20 proves Go parity — not before.

### 4.3 Go stack

| Concern | Choice | Note |
|---|---|---|
| HTTP router | `chi/v5` | stdlib-compatible, no framework lock-in |
| gRPC | `google.golang.org/grpc` + `protoc-gen-go` | protoc 33.2 already installed |
| SQL | `sqlc` (generated, type-safe) over `database/sql` | no ORM; the query is the contract |
| Migrations | `golang-migrate` | versioned, reversible, CI-verified |
| Kafka | `franz-go` | modern, well-maintained, no CGo |
| Cache/session | `redis/go-redis/v9` | |
| Validation | `go-playground/validator/v10` | mirrors the zod rules on the TS side |
| Config | `env` struct-tag loader | mirrors existing `env.ts` |
| Observability | OpenTelemetry → traces/metrics/logs | non-negotiable across service boundaries |
| Testing | stdlib + `testcontainers-go` | real MySQL + Kafka in integration tests |

Each service uses the same **hexagonal layout the TypeScript code already used** — `domain/` (entities, ports), `application/` (services), `adapters/` (MySQL, Kafka, HTTP). The recovered TS files map onto this near 1:1, which is why WP-00 comes first.

### 4.4 Contract flow — one source of truth

```
packages/shared-types/*.ts   ──generate──▶   proto/altar/v1/*.proto
        (canonical)                                   │
                                    ┌─────────────────┴─────────────────┐
                                    ▼                                   ▼
                         Go structs (protoc-gen-go)          TS clients (unchanged)
```

`shared-types` stays canonical because the five frontends already consume it and it already models all 15 domains. A CI check fails the build if `.proto` drifts from `shared-types` (WP-04). Never hand-edit generated Go structs.

### 4.5 Multi-tenancy

**Shared MySQL schema, `church_id` discriminator, enforced at the data-access layer — never at the call site.**

The known failure mode of shared-schema multi-tenancy is one missing `WHERE church_id = ?` leaking one church's giving records into another's dashboard. Mitigations, all mandatory:

1. Every tenant-scoped table has `church_id BIGINT NOT NULL` as the **leading column of every index**.
2. Tenant context is carried in `context.Context` from the gateway and injected by a `sqlc` wrapper; **queries cannot be executed without it** — the wrapper returns an error, not a full scan.
3. A CI lint fails any raw SQL touching a tenant table without a `church_id` predicate. (WP-07)
4. An integration test suite seeds two churches and asserts cross-tenant reads return zero rows, per domain. (WP-07)

Enterprise-tier churches and denominational HQs may later be moved to a dedicated schema; the discriminator design permits it without a rewrite.

### 4.6 The tenancy gap the PDF has: branches

PDF §3 defines four roles and a flat `Church`. **Ghanaian and Nigerian churches are overwhelmingly branch networks** — one denomination, one HQ, tens-to-hundreds of local assemblies, with reporting flowing upward and policy flowing downward. Asoriba's feature list explicitly includes "branch integration and reporting" — this is table stakes here, not an enhancement.

A flat `church_id` cannot express it. The model becomes:

```
Organization (denomination / HQ)
   └── Church (branch / local assembly)          ← church_id lives here
          └── Department (choir, youth, ushers, media)
                 └── Group / cell / home fellowship
```

with roles resolvable at any level (an Organization Admin sees all branches; a Church Admin sees one). This changes the auth model, the analytics rollups, and the finance consolidation — which is exactly why it must land in Phase 1 (WP-11) and not be retrofitted. See §8.1.

---

## §5. Data model — MySQL

The PDF gives two tables (`members`, `transactions`). Both need correction before they are written: no foreign keys, no tenant index, `DECIMAL(10,2)` for money, no currency column, no soft delete, no audit columns.

### 5.1 Conventions (apply to every table)

- `id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY`
- `church_id BIGINT UNSIGNED NOT NULL` on every tenant-scoped table, **first column in every composite index**
- `created_at`, `updated_at` `TIMESTAMP(6)`; `deleted_at TIMESTAMP(6) NULL` for soft delete
- **Money is `DECIMAL(19,4)` plus a `CHAR(3)` ISO-4217 currency column.** Never float. Never a bare amount without its currency — `10.00` is meaningless across GHS/NGN/KES/USD.
- `utf8mb4_0900_ai_ci` collation (correct handling of local-language names and diacritics)
- Every FK explicit, `ON DELETE RESTRICT` by default

### 5.2 Core tables (corrected from PDF §6.1 / §6.4)

```sql
CREATE TABLE organizations (                 -- NEW: denominational tier (§4.6)
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(255)   NOT NULL,
  slug           VARCHAR(120)   NOT NULL UNIQUE,
  country        CHAR(2)        NOT NULL,          -- ISO-3166, drives residency + compliance
  data_region    VARCHAR(32)    NOT NULL,          -- §3.4(4)
  created_at     TIMESTAMP(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at     TIMESTAMP(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;

CREATE TABLE churches (                      -- a branch / local assembly
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  organization_id  BIGINT UNSIGNED NOT NULL,
  parent_church_id BIGINT UNSIGNED NULL,           -- self-ref: sub-branches
  name             VARCHAR(255)  NOT NULL,
  slug             VARCHAR(120)  NOT NULL,
  country          CHAR(2)       NOT NULL,
  currency         CHAR(3)       NOT NULL,
  timezone         VARCHAR(64)   NOT NULL,
  plan             ENUM('free','basic','pro','enterprise') NOT NULL DEFAULT 'free',
  payout_subaccount_code VARCHAR(64) NULL,         -- ADR-002: church-as-merchant
  is_active        BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at       TIMESTAMP(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at       TIMESTAMP(6)  NULL,
  UNIQUE KEY uq_org_slug (organization_id, slug),
  KEY idx_org (organization_id),
  CONSTRAINT fk_church_org    FOREIGN KEY (organization_id)  REFERENCES organizations(id),
  CONSTRAINT fk_church_parent FOREIGN KEY (parent_church_id) REFERENCES churches(id)
) ENGINE=InnoDB;

CREATE TABLE members (                       -- corrects PDF §6.1
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  church_id     BIGINT UNSIGNED NOT NULL,
  user_id       BIGINT UNSIGNED NULL,              -- NULL = pastoral record, no login
  first_name    VARCHAR(120)  NOT NULL,
  last_name     VARCHAR(120)  NOT NULL,
  phone_e164    VARCHAR(20)   NULL,                -- E.164 ONLY; see note below
  email         VARCHAR(255)  NULL,
  date_of_birth DATE          NULL,
  gender        ENUM('male','female','unspecified') NOT NULL DEFAULT 'unspecified',
  household_id  BIGINT UNSIGNED NULL,              -- PDF "family linking"
  status        ENUM('visitor','new_convert','active','inactive','transferred','deceased')
                              NOT NULL DEFAULT 'visitor',   -- richer than PDF's active/inactive
  joined_at     DATE          NULL,
  created_at    TIMESTAMP(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at    TIMESTAMP(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at    TIMESTAMP(6)  NULL,
  UNIQUE KEY uq_church_phone (church_id, phone_e164),
  KEY idx_church_status (church_id, status),
  KEY idx_church_household (church_id, household_id),
  CONSTRAINT fk_member_church FOREIGN KEY (church_id) REFERENCES churches(id)
) ENGINE=InnoDB;
```

> **Phone numbers must be stored E.164-normalised** (`+233241234567`). Ghanaian numbers are written locally as `024 123 4567`, `24 123 4567`, and `+233 24 123 4567` interchangeably. Without normalisation at the boundary, deduplication fails, OTP delivery fails, and `uq_church_phone` is worthless. Normalise on write in the member service; never trust client formatting.

```sql
CREATE TABLE transactions (                  -- corrects PDF §6.4
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  church_id      BIGINT UNSIGNED NOT NULL,
  member_id      BIGINT UNSIGNED NULL,             -- NULL = anonymous giving
  type           ENUM('tithe','offering','donation','campaign','pledge_payment') NOT NULL,
  direction      ENUM('income','expense') NOT NULL DEFAULT 'income',
  channel        ENUM('mobile_money','card','bank_transfer','ussd','cash') NOT NULL,
  gross_amount   DECIMAL(19,4) NOT NULL,           -- what the giver was debited
  levy_amount    DECIMAL(19,4) NOT NULL DEFAULT 0, -- §2.3: E-Levy, shown pre-confirm
  provider_fee   DECIMAL(19,4) NOT NULL DEFAULT 0,
  platform_fee   DECIMAL(19,4) NOT NULL DEFAULT 0, -- ADR-002 commission split
  net_amount     DECIMAL(19,4) NOT NULL,           -- what the church actually receives
  currency       CHAR(3)       NOT NULL,
  status         ENUM('pending','success','failed','reversed') NOT NULL DEFAULT 'pending',
  provider       VARCHAR(32)   NULL,
  provider_ref   VARCHAR(128)  NULL,
  idempotency_key VARCHAR(128) NOT NULL,           -- see note below
  campaign_id    BIGINT UNSIGNED NULL,
  recorded_by    BIGINT UNSIGNED NULL,             -- cash: who counted it (§8.2)
  occurred_at    TIMESTAMP(6)  NOT NULL,
  created_at     TIMESTAMP(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at     TIMESTAMP(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_idempotency (idempotency_key),
  UNIQUE KEY uq_provider_ref (provider, provider_ref),
  KEY idx_church_occurred (church_id, occurred_at),
  KEY idx_church_type_status (church_id, type, status),
  KEY idx_member (church_id, member_id),
  CONSTRAINT fk_txn_church FOREIGN KEY (church_id) REFERENCES churches(id)
) ENGINE=InnoDB;
```

> **`gross_amount ≠ net_amount` and both must be stored.** The giver sees gross, the church receives net, and the difference is levy + provider fee + platform fee. Storing only one number makes every downstream report wrong and makes ADR-002's commission unauditable.
>
> **`uq_idempotency` and `uq_provider_ref` are what make payments safe.** Payment webhooks retry. Mobile money callbacks arrive twice. Without these unique constraints a single tithe gets recorded two or three times. The constraint — not application logic — is the guarantee.

Remaining tables (`users`, `roles`, `departments`, `groups`, `group_members`, `events`, `attendance`, `pledges`, `campaigns`, `announcements`, `messages`, `prayer_requests`, `welfare_cases`, `consents`, `audit_log`, `sermons`, `devotionals`, `marketplace_listings`) follow the same conventions and are specified in their owning WPs.

---

## §6. Event catalog — Kafka (PDF §13)

The PDF names four events. A working system needs a governed catalog with a versioning rule.

**Conventions:** topic `altar.<domain>.<event>.v<n>`; key = `church_id` (guarantees per-tenant ordering); CloudEvents-style envelope; **payloads carry IDs and state transitions, never sensitive bodies** — a consumer that needs prayer request text calls the service and passes an authorisation check.

| Topic | Emitted when | Primary consumers |
|---|---|---|
| `altar.member.created.v1` | Member record created | notification (welcome), ai (baseline), analytics |
| `altar.member.status_changed.v1` | Status transition | notification, analytics, ai (follow-up trigger) |
| `altar.giving.completed.v1` | Payment verified success | notification (receipt), finance (ledger), analytics |
| `altar.giving.failed.v1` | Payment failed/reversed | notification (retry prompt), finance |
| `altar.attendance.checked_in.v1` | Check-in recorded | analytics, ai (engagement score) |
| `altar.event.published.v1` | Event published | notification (announce), comms |
| `altar.message.sent.v1` | Broadcast dispatched | analytics, billing (SMS metering) |
| `altar.prayer.submitted.v1` | Prayer request created | notification (**pastoral role only**) |
| `altar.prayer.escalated.v1` | Crisis classifier fires (§8.6) | notification (**urgent pastoral**), audit |
| `altar.welfare.requested.v1` | Assistance requested | notification, welfare workflow |
| `altar.consent.changed.v1` | Consent granted/revoked | comms (**suppression list**), audit |

**Versioning rule:** additive changes bump nothing. Breaking changes publish `.v2` and run both until every consumer migrates. Never mutate a `.v1` schema in place.

**Consumers must be idempotent.** At-least-once delivery is the contract; a duplicate `giving.completed` must not send two receipts. Dedupe on event ID in Redis with a 24h TTL.

---

## §7. Work packages

### Status — last updated 31 Jul 2026

| WP | State | Evidence |
|---|---|---|
| WP-00 | ✅ done | 32 backend `.ts` restored. **Deviation:** restored *in place*, not to `reference/`, which also made `apps/api` compile and serve the platform again. |
| WP-00b | ✅ done | 16 frontend components restored; zero dangling imports; 4 affected apps build. |
| WP-00c | ✅ done | Commit `7feade5`. ⚠️ **Still local-only — no remote.** See §10 Q-0. |
| WP-01 | ⛔ moot | Existed to stop a non-compiling `apps/api` failing the build. `apps/api` now compiles and is the live backend; quarantining it would break the running platform. It retires at WP-20 as planned. |
| WP-02 | ✅ done | `go build ./...` and `go vet ./...` clean; `go run ./cmd/altar -service=gateway` returns `{"status":"ok"}`; all 9 services registered; graceful shutdown exits 0. |
| WP-03 | ✅ done | `docker compose ps` → mongo/redis/kafka all **healthy**; seeded data intact across the container handover; 4 domain-event topics created. **Kafka is on 19092** (9092–9096 are occupied by other local services). |
| WP-04 | ✅ done | `make contracts` generates 14 Go files from shared-types; `make contracts-check` fails on drift (verified both directions) and gates the Go job in CI. |
| WP-05 | ✅ done | Production boot with missing secrets exits 1 naming each one, sorted, scoped per service (finance → 4, gateway → 9). Covered by tests. |
| WP-07 | ✅ done | `TenantCollection` injects `churchId` into every filter and refuses to build one without a tenant in context. Cross-tenant reads return **zero rows across all 8 tenant-scoped domains** against real MongoDB; cross-tenant filters, inserts and tenant-reassigning updates are all rejected. |

| WP-06 | ✅ done | Per-purpose, append-only, independently revocable consent. Revoking `communications` removes that member from a broadcast — proven by test. Communications and AI processing **fail closed** (no record ≠ consent); membership and giving are service-necessary and implied. Consent does not cross churches. |

| WP-08 | ✅ done | **Audit log done:** append-only, tenant-scoped, records *reads* of sensitive resources (prayer, welfare, exports) and denied attempts, attributing the actor from the request scope rather than the caller. Reading a prayer request writes an audit row — proven by test. **Tracing done:** a single HTTP request produces one trace spanning the request, the handler, and the MongoDB query — proven through the real middleware stack against a real database, not with hand-made spans. Removing the tracing middleware collapses the trace to an orphaned database span, which the test catches. |

| WP-10 | ✅ done | Auth service in Go: phone OTP (new — was a 501 stub), password login, refresh with rotation, revocation. Verified over HTTP against **the same MongoDB and bcrypt hashes the TypeScript API wrote**, so no migration is needed at cutover. Replayed refresh tokens revoke the whole family; expired and revoked tokens rejected. |

| WP-11 | ✅ done | Organization → Church(branch) → Department → Group, with sub-branches. `VisibleChurchIDs` is the single place cross-branch reach is decided: Org Admin sees every branch in their denomination, Church Admin/leader/member see exactly one, Super Admin sees all. Reach stops at the organization boundary; circular re-parenting refused. |

| WP-12 | ✅ done | Member CRM with E.164 normalisation at every write. **Acceptance met:** 1,000 rows across 6 phone spellings → 1,000 members, zero duplicates, every stored number E.164. Dedupe runs twice (within-file and against-stored), so re-importing a file updates rather than doubles the congregation, and bad rows are reported per-row instead of failing the file. Status is a journey (visitor → new convert → active …), defaulting to *visitor* rather than *active* so engagement metrics aren't inflated by import. |

| WP-13 | 🟡 code complete, live charge gated | Real Paystack adapter replacing the stub, plus the `money` package it needed. **Proven:** a charge without a church subaccount is refused before it reaches the provider (ADR-002); the platform split is sent as an explicit integer `transaction_charge` so ledger and provider agree to the pesewa; webhooks are HMAC-SHA512 verified over the raw bytes and forged, tampered, unsigned and wrong-key deliveries are all rejected; three replays of one webhook yield one dedupe key while two distinct gifts and a later refund do not collide; an unconfigured gateway refuses every call instead of inheriting the stub's unconditional success. **Outstanding:** the live test-mode MoMo charge in the acceptance criterion needs Paystack test credentials, which the repo does not have — see §10 Q-5. Everything above is verified against a faithful fake, not against Paystack. |

| WP-14 | ✅ done | Giving and ledger. **Acceptance met:** member gives via MoMo → charge carries the church's subaccount and our computed split → settlement records the provider's actual fees → the church's balance reflects **net**, not gross → `giving.completed` is emitted once for the notification service to consume. Settling three times sequentially, and eight times concurrently, both produce **exactly one** transaction and **exactly one** event. Cash bypasses settlement (no provider, no fees, gross = net) and records who counted it. Expenses reduce the balance. Pending checkouts are never income. Both guards were **mutation-tested**: removing the forced tenant stage leaks another church's income into the summary, and removing the settlement compare-and-set turns 8 concurrent deliveries into 6 duplicate receipts — the suite catches both. |

| WP-15 | ✅ done | Consent-gated messaging with real SMS (Africa's Talking), email (Resend) and push (FCM v1) adapters. **Acceptance met:** `giving.completed` produces exactly one SMS receipt, and a member whose communications consent is revoked receives nothing — the transport is never reached. Per-channel preference, per-member quiet hours, delivery-status tracking and exponential backoff with a ceiling are all covered. |

| WP-16 | ✅ done | Gateway serves auth + member + finance under one origin, with JWT→tenant middleware, role allowlists and per-record ownership checks — and **forwards everything not yet ported to the legacy TypeScript API**, so the frontends see one origin for the whole platform. **Verified against a live server, not just in tests:** login → create a member (`024 123 4567` stored as `+233241234567`) → list → record cash (`"1,250.50"` → 125050 minor) → summary totalling **GHS 1,625.75 exactly**; a MEMBER role gets 403 on the congregation list and the church books; an unsigned, forged or tampered webhook gets 401, a correctly-signed one 200; and with the gateway on :8080, `auth/me`, `members`, `finance/summary` (Go) plus `events` and `churches` (proxied) **all return 200 from one token**. Dashboard, web, admin and mobile now default to the Go origin; all four typecheck and the dashboard builds. |

**Mobile product pass — 1 Aug 2026 (pre-WP-19, goal still active).** The Expo app now boots through the correct `expo/AppEntry` path, stores access/refresh tokens in SecureStore on native, normalises both the Go `{user,tokens}` response and the legacy flat response, clears invalid restored sessions, and coalesces simultaneous refreshes so a rotating refresh token cannot be replayed by two racing 401s. Phone OTP is the primary sign-in path. Every production mock was removed: home, MoMo-first giving/history, events/RSVPs, community posts/reactions, devotionals, sermons, prayers, welfare, notifications, and profile actions now use service boundaries against the gateway and expose loading, empty, error, refresh, accessibility, and global offline states. Giving sends decimal strings to `/finance/give`, displays the server's E-Levy quote and total debit before opening Paystack, and never presents pending money as confirmed giving. The UI now uses the Altar OS green system, proper tab icons, responsive content caps, and generated native app icons.

**Evidence:** `npx tsc -p apps/mobile/tsconfig.json --noEmit` passes; Jest passes **16/16** auth-contract, atomic secure-session migration, Ghana phone-normalisation, registration-envelope, minor-unit money, non-mutating giving-quote, payment-settlement, and legacy event-route tests. Native access and rotating refresh tokens now share one SecureStore envelope so app suspension cannot leave a mismatched pair; cached member identity also moved out of plain AsyncStorage, incomplete legacy token pairs are discarded, and local logout clears the visible session even when the network request fails. OTP entry supports system SMS autofill, paste, digit filtering, labelled fields, guarded resend, and inline server errors. Registration resolves the visible church code through `/churches/slug/:slug`, sends the legacy route's real `{name,email,phone,password,churchId}` contract, unwraps its response, and canonicalises Ghana-local `024…` numbers to `+233…` so OTP lookup can match stored accounts. Giving review is genuinely non-mutating: `/finance/give/quote` returns the cumulative daily levy and total without creating a transaction, `/finance/give` refuses to initialise Paystack unless `acceptedTotalMinor` exactly matches the current server quote, and the `altaros://giving/complete` deep link verifies the returned provider reference before showing success. The event client uses the real church-scoped list and shared RSVP endpoints instead of speculative routes, and does not invent attendee identities the API does not expose. `npx expo export --platform all --output-dir /tmp/altar-mobile-export-20260801-session-otp` produces web, iOS, and Android bundles from the mobile workspace; the focused Go quote-acceptance test and service compile pass. Expo web starts without runtime errors after pinning app-local `react-dom@19.2.3` to match Expo's React. Expo Doctor passes 18/20 checks; its remaining two findings are monorepo-resolution reports (it sees both app-local Expo-compatible React/safe-area packages and root web-workspace copies, and reports `.expo` because a generated log was already committed despite both current ignore rules matching). **Still open:** the iPhone 16 Pro simulator booted, but native visual QA did not complete; a second official Expo Go fetch reached only 1% after a sustained retry and was stopped. No physical-device OTP/MoMo/SMS run has happened. WP-19 therefore remains open and still needs staging infrastructure plus real provider test credentials. Social, spiritual, welfare, and member-notification HTTP routes also remain Phase 2 work and must not be represented as live until the WP-19 gate permits their owning work packages.

**Events follow-up:** the authenticated member's RSVP state now survives reload through `/events/rsvps/me`; RSVP identity comes only from the signed token, and cross-church event reads are rejected. The mobile list adds pull-to-refresh and per-event mutation states, while event details open real map directions and explain attendee-name privacy rather than rendering unfinished placeholders. The legacy API build, mobile TypeScript, 16/16 mobile tests, and `/tmp/altar-mobile-export-20260801-events-state` all pass across web, iOS, and Android.

**Authentication design follow-up — 1 Aug 2026:** the mobile, member web, church dashboard, and platform admin sign-ins now form one Altar OS authentication family without reusing one generic card on every audience. Mobile is a tactile phone-first member entry with OTP as the primary path; member web is warm, community-led, and also OTP-first; dashboard frames sign-in around weekly church operations; admin uses a deliberately restricted, security-forward console treatment. All existing routes, validation, email/password fallbacks, and OTP contracts remain intact. Verification passes: mobile TypeScript and 16/16 Jest tests; production builds for dashboard, admin, and member web; and `git diff --check`.

**Navigation, type, and notification follow-up — 1 Aug 2026:** marketing, dashboard, admin, and member web now use Outfit consistently. Browser route changes animate the real page or internal content scroller back to the top and fall back to an immediate jump when the member has requested reduced motion. The Expo notification client now creates its Android channel, requires an explicit EAS project UUID before requesting a push token, safely allowlists notification destinations, routes cold-start and foreground notification taps through React Navigation, and opens valid in-app destinations from the notification inbox. This is device-side readiness only: the Phase 2 member-notification HTTP routes are still not implemented and are not represented as live. Verification passes: all four browser production builds, mobile TypeScript, 18/18 Jest tests, and an all-platform Expo export at `/tmp/altar-mobile-export-20260801-notification-links-final`. The three previously tracked machine-local `.expo` files are removed; the ignore rules were already correct. Expo Doctor remains 18/20 in this uncommitted worktree because it still sees those paths in the Git index until commit, and because npm hoists web-workspace React/native peer copies alongside Expo's app-local supported versions. The bundle resolves the app-local versions and exports successfully, but the duplicate report remains explicit rather than being suppressed.

**Mobile state-quality follow-up — 1 Aug 2026:** known-shape feed, event, giving-history, sermon, devotional, and notification loads now use a shared card skeleton rather than an indeterminate spinner. Its pulse stops when the device requests reduced motion, and assistive technology receives one loading-progress announcement instead of reading decorative placeholders. Sermon and devotional transport failures are now distinct from valid empty publishing states and provide an accessible retry. The repo's missing mobile/admin ESLint entrypoints and shared-config React export were repaired, and the parser is isolated on its compatible TypeScript toolchain instead of resolving the apps' compiler. Mobile ESLint, TypeScript, 18/18 Jest tests, `git diff --check`, and the web/iOS/Android export at `/tmp/altar-mobile-export-20260801-skeleton-states` pass.

**Session, social, welfare, and accessibility follow-up — 1 Aug 2026:** a cached member session now survives offline launch, refresh-network failures, and gateway 5xx responses; only an authoritative 401/403 (or a confirmed missing current user) clears secure credentials. The community comment control is no longer dead: it opens a paginated, refreshable comment thread with loading, empty, error, retry, keyboard-safe composition, bounded input, and encoded post identifiers, and the feed refreshes on return. Welfare request history no longer flashes a false empty state while loading, failed history can be retried, urgent alerts reject duplicate taps, and all copy states clearly that an internet-dependent church alert does not replace emergency services. Remaining home, social, prayer, sermon, notification, and event touch targets now expose roles, labels, hints, busy/disabled state, and selection state to assistive technology. Mobile ESLint, TypeScript, 22/22 Jest tests, and the web/iOS/Android export at `/tmp/altar-mobile-export-20260801-social-session-a11y` pass. The social, spiritual, welfare, and member-notification server routes remain Phase 2 and are still described as client-ready, not live.

**Home and profile follow-up — 1 Aug 2026:** the home aggregator now begins with a known-shape skeleton, supports pull-to-refresh, preserves previously loaded content when a refresh fails, and distinguishes an unavailable devotional/sermon service from a valid empty publishing state. Profile pull-to-refresh uses the real `/auth/me` gateway route, and “sign out on all devices” uses `/auth/logout-all`, clears the local secure session even if the response is interrupted, and is guarded by destructive confirmation. Member-owned profile mutation is intentionally not offered: the Go gateway exposes self-read but not self-update, while using the legacy unrestricted update route would weaken the tenancy/security boundary. The UI tells members to ask their church office to update the authoritative member record. Mobile ESLint, TypeScript, 23/23 Jest tests, and the web/iOS/Android export at `/tmp/altar-mobile-export-20260801-profile-home-final` pass.

**Release-readiness follow-up — 1 Aug 2026:** `apps/mobile/eas.json` now separates internal preview APK/IPA builds, an iOS simulator preview, and auto-incrementing store production builds; package scripts select profiles explicitly instead of relying on EAS defaults. The public Expo config resolves the committed slug, deep-link scheme, bundle identifier, Android package, icons, and native plugins. `eas config --non-interactive` reaches the expected ownership boundary and stops because this checkout has not been linked with `eas init`; no project UUID or credentials were invented. Unused `expo-camera`, `react-native-paper`, and `date-fns` dependencies were removed, eliminating an unused camera permission and the duplicate native-module tree. Expo Doctor improves from 18/20 to **19/20**; the only remaining finding is the three `.expo` paths still present in Git's current index even though their working-tree files are deleted and both ignore rules match. Mobile-scoped `npm audit --omit=dev` reports no high or critical advisories; its remaining ten moderate reports are the Expo 57 build/config toolchain chain, for which npm's proposed “fix” is an invalid downgrade to Expo 46 and was not applied. Mobile ESLint, TypeScript, 23/23 Jest tests, and the lean web/iOS/Android export at `/tmp/altar-mobile-export-20260801-release-lean` pass.

**Verified-registration follow-up — 1 Aug 2026:** mobile account creation no longer accepts the legacy registration endpoint's immediately issued tokens as proof of phone ownership. Registration still resolves the church slug and creates the member in the shared `users` collection, but leaves those compatibility tokens unpersisted, requests a code from the Go OTP service, and mounts the authenticated navigator only after `/auth/verify-otp` succeeds and marks `phoneVerified`. If initial SMS dispatch fails after account creation, the member is kept in the verification journey with an immediate retry instead of being shown a false registration failure that encourages a duplicate account. The form now validates email shape, retains the backend's eight-character password floor, and exposes its sign-in affordance as a link. Mobile ESLint, TypeScript, and 23/23 Jest tests pass; the auth service test explicitly proves registration writes neither tokens nor user identity to device storage, and `/tmp/altar-mobile-export-20260801-verified-registration-v2` contains successful web, iOS, and Android production bundles.

**App-shell resilience follow-up — 1 Aug 2026:** the branded splash now replaces its spring with a restrained ease-out transition and disables its motion entirely when the platform's reduced-motion setting is active. A root error boundary covers both splash and authenticated trees, remounts the app view on member request, and avoids exposing stack details in production. Signed-out password failures no longer enter the refresh-token path: without a stored refresh token the original gateway `401` and its safe “Invalid credentials” copy survive, while authenticated expiry still coalesces rotation. API error copy is normalised, login validates email without imposing a speculative password-length rule, and dynamic finance, sermon, prayer, and notification identifiers are URL-encoded. Event detail uses a known-shape skeleton, distinguishes a confirmed 404 from a transport failure, and offers retry; sermon links reject unsafe/unsupported URLs and surface an inline failure. Mobile ESLint, TypeScript, `git diff --check`, and **25/25** Jest tests pass. Expo Doctor remains **19/20**, with only the already-documented tracked `.expo` index state; `/tmp/altar-mobile-export-20260801-shell-recovery-v1` contains successful web, iOS, and Android production bundles. Native QA was retried on the booted iPhone 16 Pro simulator, but the official Expo Go download reached only 2% after roughly 42 minutes and was stopped, so no visual/device claim is made from it.

**Giving ownership and push-lifecycle follow-up — 1 Aug 2026:** the mobile history contract and gateway now agree: `/finance/me/giving` returns the signed-in member's newest transaction rows rather than a summary object that `FlatList` could not render. Callback settlement now loads the transaction and enforces self-or-leader ownership *before* contacting Paystack; previously any signed-in member who learned another reference could verify and receive that transaction. Digital checkouts store a private, non-serialized `initiatedBy` identity alongside the optional public `memberId`. Therefore “Give anonymously” still removes the giver from church-facing records, while the initiating member can verify the callback, see their own history, receive the transactional receipt, and cannot reset cumulative transfer calculations by toggling anonymity. Existing attributed transactions remain visible through the owner query. The private identity has a tenant-scoped index and is explicitly proven absent from transaction JSON. Already-consented devices now refresh their Expo push-token registration at authenticated app launch without prompting; first consent remains an explicit Notifications-screen action. Finance-domain tests, the complete `internal/service` package, mobile ESLint and TypeScript, `git diff --check`, and **28/28** mobile Jest tests pass. The full Kafka receipt test initially exposed a stale-topic race in its own signal channel; it now waits for the transaction created by that run and completes in 2.45s instead of failing on an unrelated historical event and deadlocking cleanup. `/tmp/altar-mobile-export-20260801-payment-ownership-v1` contains successful web, iOS, and Android bundles. WP-19 still requires the real Paystack/SMS staging proof and remains open.

**Server-enforced OTP follow-up — 1 Aug 2026:** the registration journey can no longer be bypassed by returning to password sign-in before verifying the new phone. Legacy registration now writes `phoneVerificationRequired: true` only on newly created accounts; the Go password path refuses those accounts with recovery copy directing the member to phone-code sign-in, and successful OTP verification atomically marks the phone verified and clears the requirement before issuing the session. Existing accounts whose documents predate the flag remain grandfathered, avoiding an accidental platform-wide lockout. Registration now checks both email and phone before resolving or creating a church, returns one non-enumerating conflict response, and prevents a duplicate founding-admin phone from leaving an orphan church. The auth-domain integration suite, complete `internal/service` suite, legacy API build and 5/5 API tests, mobile ESLint/TypeScript, 28/28 mobile tests, and `git diff --check` pass. `/tmp/altar-mobile-export-20260801-server-otp-gate-v1` contains successful web, Android, and iOS bundles. This proves local enforcement and packaging, not SMS delivery; the WP-19 live-phone gate remains open.

**Deferred navigation follow-up — 1 Aug 2026:** payment callbacks and notification taps are no longer handed to the auth-only navigator and discarded when the member is signed out. While authentication is active, the app records one allowlisted `altaros://` destination; after OTP/password success it remounts the member navigator, consumes that destination exactly once, and then clears it so a later logout/login cannot replay a stale route. `giving/complete` is explicitly allowlisted so a Paystack return survives authentication, while arbitrary web/admin URLs are rejected. A fresh OS launch URL takes priority over an older stored notification response, preventing stale notification state from redirecting the member away from payment verification. The native last-notification response is explicitly cleared after capture or foreground handling; Expo otherwise persists it and could reopen an already handled destination on a later app start. Authenticated foreground linking continues through React Navigation's normal subscription. Mobile ESLint, TypeScript, `git diff --check`, and **29/29** Jest tests pass. An export invoked from the monorepo root correctly failed because that directory has no Expo `App.tsx`; authoritative reruns from `apps/mobile` succeeded, with the final web/iOS/Android artifacts at `/tmp/altar-mobile-export-20260801-deferred-links-v3`.

**Exact gift-entry follow-up — 1 Aug 2026:** the mobile giving form no longer converts the member's decimal text through JavaScript floating-point or `toFixed(2)`. It accepts at most two fractional digits while typing and canonicalises valid positive values as exact decimal strings for the quote and charge requests (`10` → `10.00`, `10.9` → `10.90`) without changing their monetary value. Inputs that previously could be silently transformed — including `10.999` → `11.00` — are now rejected, as are exponent notation, multiple decimal points, zero, and negative amounts. Mobile ESLint, TypeScript, `git diff --check`, **42/42** Jest tests, finance-domain tests, and the complete `internal/service` suite pass. Fresh web, Android, and iOS bundles are at `/tmp/altar-mobile-export-20260801-exact-money-v1`. This strengthens the local giving path but does not substitute for WP-19's real Paystack/SMS live-phone proof, which remains open.

**Community resilience follow-up — 1 Aug 2026:** the prayer screen no longer flashes a false empty state while its first network request is still running. Initial prayer loading uses the known-shape skeleton; a failed request has an accessible inline error and retry action; pull-to-refresh reconciles the list without replacing it; and empty content is shown only after a successful empty response. The community feed now preserves its loaded list when focus returns from post creation or comments instead of unnecessarily replacing it with a full-screen skeleton, and failures after cached content or an optimistic reaction are visible with an inline retry rather than being silently hidden by a `ListEmptyComponent` that never renders for non-empty data. New spiritual-service contract tests prove bounded prayer loading, anonymous-choice submission, and encoded dynamic prayer identifiers. Mobile ESLint, TypeScript, `git diff --check`, and **45/45** Jest tests pass. Fresh web, Android, and iOS bundles are at `/tmp/altar-mobile-export-20260801-resilient-community-v1`. These are client resilience improvements against the gateway proxy; they do not advance Phase 2 ownership of the spiritual/social HTTP domains ahead of WP-19.

**Notification and event interaction follow-up — 1 Aug 2026:** notification list failures, push-consent failures, mark-read failures, and deep-link failures now have independent state instead of competing for one error string. A failed optimistic mark-read restores the unread state; link and permission lookups cannot reject into an unhandled promise; list failures offer retry both with and without cached notifications; and an action failure is no longer mislabeled as an empty inbox or hidden when data exists. Event cards no longer nest the RSVP button inside the event-detail navigation touch target: details and attendance are separate accessible controls, so one tap cannot mutate the RSVP and open another screen. Mobile ESLint, TypeScript, `git diff --check`, and **45/45** Jest tests pass. Expo Doctor remains **19/20** solely because the current Git index still tracks historical `.expo` paths even though the ignore rule is correct; the eventual commit must record their already-present deletions. Fresh web, Android, and iOS bundles are at `/tmp/altar-mobile-export-20260801-notification-events-v1`. WP-19 remains open for real-provider and live-phone proof.

**Truthful history and welfare-state follow-up — 1 Aug 2026:** a failed initial giving-history request no longer renders a confident `GHS 0.00` summary, because unavailable financial data is not evidence of zero giving. A refresh failure over existing records preserves them but labels the total as last loaded, exposes an accessible error, and offers retry instead of silently presenting cached data as current. Welfare request history now has a known-shape, accessibility-labelled skeleton rather than loading prose; pull-to-refresh and retry preserve the urgent-help and request-form surfaces instead of replacing the screen or discarding cached requests. Mobile ESLint, TypeScript, `git diff --check`, and **45/45** Jest tests pass. Fresh web, Android, and iOS bundles are at `/tmp/altar-mobile-export-20260801-truthful-history-welfare-v1`. Expo web also started successfully on a dedicated local port, but the browser runtime exposed no controllable browser instance, so no responsive visual claim is made; responsive/native visual QA remains open alongside WP-19's provider gate.

**Profile, comments, and media resilience follow-up — 1 Aug 2026:** comment-list failures and comment-submit failures now have separate state and retry semantics, so a failed send is not mislabeled as an unavailable thread and a list retry cannot masquerade as resubmission. Loaded comments survive focus refreshes; stale-list failures are visible alongside cached content; editing clears the relevant submit error. Sermons now support pull-to-refresh, retain cached messages without reverting to a first-load skeleton, and label refresh failures instead of hiding them when the list is non-empty; bounded sermon retrieval gained contract coverage. Profile privacy/help links check device support, handle launch failure inline, and expose link rather than button semantics. Local and all-device sign-out alert callbacks consume expected network rejection after the context securely clears the local session, preventing unhandled promises during navigator teardown. Mobile ESLint, TypeScript, `git diff --check`, and **46/46** Jest tests pass. Fresh web, Android, and iOS bundles are at `/tmp/altar-mobile-export-20260801-profile-social-media-v1`. WP-19 and visual device QA remain explicitly open.

**Canonical OTP identity follow-up — 1 Aug 2026:** phone identity now converges on one E.164 key before registration, OTP request, and OTP verification instead of relying on two client-only string replacements. The mobile boundary accepts common Ghanaian domestic, bare-national, `233…`, `00233…`, formatted `+233…`, and explicit foreign international forms; malformed, too-short, and ambiguous values are rejected before an account can be created with an unusable OTP address. The Go auth boundary independently normalises with the shared launch-market phone package, so a caller cannot bypass canonicalisation by skipping the Expo client; invalid versus missing phone input has a specific safe 400 response. Integration coverage proves that a code requested as `024 123 4567` verifies as `00233 24 123 4567` against the one stored `+233241234567` identity, while unusable input never reaches lookup or SMS delivery. Mobile ESLint, TypeScript, `git diff --check`, **51/51** Jest tests, the auth-domain integration suite, and complete `internal/service` suite pass. Fresh web, Android, and iOS bundles are at `/tmp/altar-mobile-export-20260801-canonical-otp-phone-v1`. This proves normalization and local delivery wiring, not a real SMS; WP-19 remains open.

**Compact-device OTP follow-up — 1 Aug 2026:** the six fixed 48-point OTP fields previously required 376 points after gaps and page padding, overflowing common 320/360-point Android viewports. Code entry now derives field width and gap from the live viewport, caps at the original comfortable tablet/web size, and sits in a keyboard-avoiding scroll container. Deterministic layout tests prove all six fields plus padding fit 320, 360, and 375-point widths. A registration whose first SMS request failed no longer exposes editable code fields or a Verify action before a successful request; after resend, the stale visible code is cleared, the first field is focused, and the copy changes to confirm delivery. Paste/autofill remains on the first field with an explicit accessibility hint. Mobile ESLint, TypeScript, `git diff --check`, and **56/56** Jest tests pass. Expo Doctor remains **19/20** for the documented historical `.expo` Git-index entries. Fresh web, Android, and iOS bundles are at `/tmp/altar-mobile-export-20260801-responsive-otp-v1`. This is deterministic responsive evidence, not a visual device claim; native QA and WP-19 remain open.

| WP-17 | ✅ done | CI now runs the Go suite against **real MongoDB and Redis service containers** with the race detector, builds a 22.4MB distroless image, and smoke-tests a booted gateway. **Done when** was "a PR runs Go + TS pipelines" — it does, plus three checks the spec did not ask for and this codebase has already needed. |

| WP-18 | 🟡 manifests done, cluster run gated on CI | kustomize base + dev/staging/prod overlays, HPA, PDB, sealed-secret placeholders, and the **readiness endpoint the base was documented as probing but which did not exist**. **Verified locally:** all three overlays render, and all 25 resources validate against the real Kubernetes schemas via kubeconform (the 1 skipped is the SealedSecret CRD). **Outstanding:** `kubectl apply -k deploy/overlays/dev` on an actual cluster — no cluster is available in this environment, so a CI job now creates a kind cluster, loads the image, applies the dev overlay and waits for `rollout status`, which only completes once a pod passes readiness. That is the acceptance criterion, run on every PR. |

**Event bus wired — 1 Aug 2026.** Every domain declared a `Publisher` and every wiring site passed `nil`, so `giving.completed` was emitted by no one and consumed by no one; `go.mod` had no Kafka client at all. **WP-19's gate could not have passed even with Paystack credentials**, because the two halves of "member gives → member receives a receipt" were each correct and unconnected. Now on franz-go (pure Go — `CGO_ENABLED=0` on distroless rules out anything wrapping librdkafka), keyed by church id per §6, with Redis dedupe on the event id and a **transactional outbox** so a broker outage queues rather than loses. Proven end to end against real Kafka and MongoDB.

Three bugs came out of building it, all about redelivery: **not committing an offset does not cause redelivery** (franz-go's client has already advanced its own position, so a failure only returns after a restart — failed records now rewind the partition); **a handler panic killed the whole process**, so one malformed event would crash every replica repeatedly; and **every publish error was discarded with `_ =`**, making delivery at-*most*-once while §6 states at-least-once. Also connected: the **real Africa's Talking transport into auth OTP** — WP-15 built it and nothing used it, so production *with* valid credentials would still have refused to send a login code — and **embedded tzdata**, because distroless has no `/usr/share/zoneinfo` and quiet hours were silently evaluating in UTC everywhere deployed.

**Church routes exposed.** WP-11's `VisibleChurchIDs` had no HTTP caller. Now reachable, and verified against seeded data: a church admin sees one branch, an org admin sees every branch in their denomination, and an unreachable church returns **404 rather than 403** — a 403 would confirm it exists and make every church on the platform enumerable by walking ObjectIds.

**Seed data (`make seed`).** 3 branches under one denomination, 260 members, 949 transactions across 12 weeks, per-purpose consent. Ghanaian names, MTN/Telecel/AirtelTigo numbers weighted the way the market is, giving that straddles the E-Levy threshold. Members are created through `member.Import` with phone numbers written the way a church secretary types them, so the seed exercises E.164 normalisation rather than bypassing it. Two guards refuse to run against anything that looks like production.

Not yet started: WP-19 (Phase 1 gate) onward.

**Tracing fails soft and carries no personal data.** With no collector configured it becomes a no-op and the service runs normally — observability that stops the platform when its collector is unreachable is worse than none, because the failure arrives during exactly the incident the traces were for. The exporter uses a bounded queue so a stalled collector drops spans rather than accumulating them until the process runs out of memory.

Spans carry **churchId and role, never a user id, phone, email or member name**. A trace backend is a second copy of production data with weaker access controls than the database, and Act 843 does not distinguish "it was only in a span attribute". churchId is the one identifier worth the risk: without it a trace cannot answer *is this slow for everyone or for one church*, which is the first question in any incident. Amounts are recorded without a payer, because an amount becomes personal data only when joined to a member — which is why no member identifier goes on the same span. A test asserts the absence, so removing it is a decision someone has to consciously make.

Sampling is `ParentBased` so a sampled request stays sampled through every hop; sampling per-service independently produces traces with holes in them, which are harder to read than no trace at all. Probe endpoints are excluded, or `/health` and `/ready` would be the overwhelming majority of every sample.

**`/health` and `/ready` are deliberately different things**, and conflating them is the failure mode this split exists to prevent. Liveness is dependency-free: it answers "is this process wedged", and the only correct response is a restart. Checking Redis there would turn a thirty-second dependency blip into a cluster-wide restart storm, because every pod fails at once. Readiness does check dependencies and returns **503**, which removes that pod from the Service's endpoints without restarting it — "alive but cannot serve". Redis in particular is not optional: it backs token revocation, and revocation checks fail closed, so an instance that cannot reach it rejects every authenticated request.

**A startup probe was needed, not just liveness.** Index creation runs before the listener opens, and on a cold database that takes longer than a liveness probe should tolerate — without the startup probe, a slow first boot is killed and retried forever.

**No CPU limit, but a memory limit.** CFS throttling at a CPU limit adds tail latency even when the node has spare capacity, and the request already guarantees a share. Memory is capped because a leak with no ceiling takes the node's other pods down with it.

**The HPA scales up fast and down slowly** (70% target, 100%/30s up, 25%/60s down after a 5-minute window). Giving traffic is not gradual: a Sunday service puts a whole congregation through the payment flow within minutes, and scaling up takes longer than that spike takes to arrive. A member who sees an error mid-tithe does not usually try again.

**The CI job was previously green while testing almost nothing.** Every integration test calls `t.Skipf` when its database is unreachable, and CI had no database — so `make test` passed having executed none of the guarantees that matter (tenant isolation, payment idempotency, consent gating). A skipped test is indistinguishable from a passing one in a green checkmark. `REQUIRE_INFRA=1` now turns an unreachable dependency into a failure, and the workflow additionally greps the log for `--- SKIP` so a test that skips for any other reason still fails the build.

**The smoke job exists because index creation has failed at boot twice** — once on a legacy Mongoose index name, once because it was never called at all. `go build` proves the binary compiles; only booting it proves it starts, creates `uq_idempotency` and `uq_provider_ref`, refuses an unauthenticated request, and rejects an unsigned webhook. CI asserts all four.

**Bug found while smoke-testing the image:** `LEGACY_API_URL=` (explicitly empty) did not disable the strangler proxy. The config helper treated empty as unset and restored the development default, so a production deployment that had deliberately turned the proxy off would have tried to forward live traffic to `localhost:3001` — and CI, which passes it empty, would have proxied to a legacy API that is not running. Empty and absent are now distinguished for that setting.

**The cutover is a strangler-fig proxy, not a switch.** Pointing the apps at Go was only safe because the gateway forwards unported routes to the TypeScript API. Without that, the frontends would have had to know which domains had moved and split traffic across two origins — making every work package a coordinated frontend release, with mistakes surfacing as broken screens rather than failed deploys. Now a domain moves the moment its routes appear above the proxy, and no client changes.

**One token authenticates against both APIs.** The Go access token carries `id` and `churchId` alongside its own `uid`/`cid`, because that is what the TypeScript middleware reads. Both APIs must therefore share `JWT_SECRET` until the legacy API retires at WP-20, when the two shim claims are deleted. Refresh tokens deliberately omit them: the TypeScript API never sees one, and putting identity into it would widen what a stolen refresh token can do.

**Two frontend contract bugs fixed in passing.** The mobile app pointed at `localhost:4000/api` — neither a port nor a path any API has ever served, so it could not have reached a backend at all — and called `/auth/refresh` where every API serves `/auth/refresh-token`, so every session would have ended at the access token's expiry rather than renewing.

**Three bugs that only end-to-end testing could find**, all from the same root — ADR-005 has the Go services and the legacy Mongoose API sharing one live database, and unit tests run against empty collections where the legacy schema does not exist:

1. **`EnsureIndexes` was never called at startup.** `uq_idempotency` and `uq_provider_ref` — described in this document as "what stops a retried payment webhook from recording a tithe twice" — did not exist in the live database at all. Every test passed because each test creates them itself. Now run at boot, before the listener starts.
2. **Mongoose's `reference_1` unique index broke every Go transaction after the first.** Mongoose declares `reference` required and unique on `transactions`; Go never wrote the field, so every Go document was indexed as `null` and the second collided with the first. Surfaced as a nonsensical "That transaction has already been recorded." on an unrelated gift. Go now writes `reference` = the idempotency key, which is what it is.
3. **Index creation failed the whole boot on an existing legacy index.** Mongoose had already created `slug_1`; Go asked for `org_slug_unique` on the same key and MongoDB answered `IndexOptionsConflict`, so the service refused to start. `mongodb.EnsureIndexes` now accepts an equivalent index under any name — but **refuses one with weaker guarantees**, because silently accepting a non-unique index where uniqueness was required would remove the constraint that makes payments idempotent while the service booted looking healthy.

**And a fourth, found while cleaning up the test data:** Go was writing `churchId` as a **string** while Mongoose writes an **ObjectId**. Reads already tolerated both (`mongodb.ID`), but writes did not — so a member created through the Go API was invisible to every Mongoose query, and would simply not have appeared in the existing dashboard. ADR-005's entire justification is that both writers share one database; that only holds if each can see the other's work. Writes now use the ObjectId form and filters match either, with tests proving both directions and confirming isolation is not weakened by the wider match.

**Consent is checked at the point of send, not by callers.** If the check lived in each caller, one caller forgetting it is a regulatory incident under Act 843 and the NDPA rather than a bug. Two distinctions turned out to matter and are structural:

- **Transactional messages are not consent-gated.** A giving receipt or an OTP is necessary to perform the service the member asked for — the same lawful basis WP-06 gives membership and giving. Treating an OTP as marketing would lock a member out of their account for declining a newsletter, and a receipt held until morning by quiet hours is a member who thinks their tithe vanished.
- **Unsubscribe is a preference, not a consent revocation.** A member who replies STOP has said "stop texting me", not "delete my lawful basis"; collapsing the two would make re-subscribing a consent ceremony instead of a toggle.

**A consent-service outage is an error, never a suppression.** Reading "cannot reach consent" as "no consent" would silently stop every church's communications during an outage, and the suppression records would make it look intentional.

**Bug the concurrency test caught, worth recording.** The unique dedupe index held at exactly one *record*, but all eight racing goroutines called the transport on the winner's row — one record, eight SMS receipts to the same member. The insert now reports whether it actually created the row, and a caller that lost the race returns without sending. A uniqueness constraint stops duplicate *rows*; it does nothing about duplicate *side effects*.

**Two things the ledger refuses to do, both deliberate.** It never trusts a webhook body for value — a forged webhook claiming GHS 1,000,000 against a real GHS 100 gift records GHS 100, because settlement re-verifies with the provider and the body is only a hint that something happened. And when the provider reports a different amount from the one recorded, it **refuses rather than reconciles**: silently adopting the provider's figure would hide both the bug case and the attack case, so the row stays pending for a human. Same for a payment that settled to a different subaccount — successful, but not that church's income.

**`TenantCollection.Aggregate` is new and was the real risk in this WP.** Aggregations are the one query shape where forgetting the tenant filter *returns results* instead of erroring — results belonging to every church. The wrapper prepends the tenant `$match` as the **first** stage (a pipeline starting with `$group` or `$sort` would otherwise have already read everything), and refuses `$out`, `$merge`, `$unionWith` and `$lookup` outright, since those read or write a second collection that no leading `$match` can constrain.

**The split direction is the thing to get right.** Paystack's subaccount field `percentage_charge` is *the percentage the main account receives*, not the subaccount's share. Read the intuitive way round it would send 98.5% of every tithe to ALTAR OS and 1.5% to the church, silently, on every transaction. The adapter does not depend on that reading at all: it passes an explicit `transaction_charge` in minor units, computed here in integer basis points, which overrides the subaccount's configured split for that transaction.

**Money is integer minor units end to end** (ADR-005). The commented-out Paystack draft in the TypeScript tree did `amount * 100` on a float; `0.10 * 100` is `10.000000000000002`, which truncates to 9 pesewas. `internal/platform/money` parses decimal strings without ever touching float64, refuses to mix currencies, and rounds the commission half-up the way the provider does — a split that rounds differently reconciles a pesewa short on every single transaction. Currencies with no minor unit (UGX, RWF) are modelled, so "×100 everywhere" does not survive into the expansion markets. E-Levy is modelled with the **cumulative daily** GHS 100 threshold, not per-transaction: five GHS 30 gifts in one day cross it even though no single one does, and only the portion above the allowance is levied.

**Index trap worth recording:** the phone uniqueness index was first written `unique + sparse`, which is wrong on a compound key. A compound sparse index only skips a document when **every** indexed field is missing, and `churchId` is never missing — so every phone-less pastoral record indexed as `null` and the second one collided with the first. Since most of a congregation has no phone on file initially, that breaks the common case, not an edge case. Both optional-field indexes now use `partialFilterExpression: {field: {$exists: true}}`. Single-field sparse indexes (auth's `email`/`phone`) are unaffected and were left alone.

### Phase 0 — Salvage & foundation

**WP-00 · Recover the backend domain code as the port reference**
Depends on: —
Recover the **32 deleted `apps/api` `.ts` files** from the git index into `reference/ts-domain/`, preserving paths. Commit as a reference snapshot. This is the port specification for the Go services covering the 6 implemented domains.

The flag matters: these files are *added* in the index and *deleted* in the worktree, so the diff is **index-vs-worktree**. `--cached` returns zero files here. Command verified against this repo:
```bash
git diff --name-only --diff-filter=D | grep '^apps/api/.*\.ts$' | while read -r f; do
  mkdir -p "reference/ts-domain/$(dirname "$f")" && git show ":$f" > "reference/ts-domain/$f"
done
```
**Done when:** `find reference/ts-domain -name '*.ts' | wc -l` returns **32**, and `reference/ts-domain/apps/api/src/domain/auth/application/auth.service.ts` contains `class AuthService`.

**WP-00b · 🚩 Restore the 16 deleted frontend components — Phase 0 blocker**
Depends on: —
ADR-001 keeps all five frontends, but four of them currently have dangling imports and cannot build (§0.2). Restore the 16 deleted `.tsx` files **in place** (not to `reference/`) from the git index:
```bash
git diff --name-only --diff-filter=D | grep '\.tsx$' | while read -r f; do
  mkdir -p "$(dirname "$f")" && git show ":$f" > "$f"
done
```
Then verify no dangling imports remain anywhere — every deleted module resolved against live `import` statements.
**Done when:** all four affected apps typecheck; `dashboard`, `web`, `admin`, and `mobile` each build; zero unresolved imports across `apps/`. **No other frontend work starts until this passes.**

**WP-00c · 🚩 Create the initial commit — highest priority in this document**
Depends on: WP-00b (restore first, so the baseline commit is a working tree)
The repo has **no commits at all** (§0). Until this WP is done, every file in the project is one `git reset` away from permanent loss. Create the initial commit, add a remote, and push.
```bash
git add -A && git commit -m "Initial commit: ALTAR OS monorepo baseline"
git remote add origin <url> && git push -u origin main
```
**Done when:** `git rev-parse HEAD` returns a SHA; `git log --oneline` shows the baseline commit; the commit exists on a remote. **Nothing else in this plan should be started before this passes.**

**WP-01 · Quarantine `apps/api`**
Depends on: WP-00, WP-00b, WP-00c
Mark `apps/api` explicitly quarantined: `README.md` stating it is superseded (link ADR-001), removed from the root `dev` and `build` turbo scripts so the workspace build no longer fails on non-compiling code. **Do not delete it** — it goes at WP-20 after Go parity.
> Note: quarantining `apps/api` alone does **not** make `npm run build` pass — WP-00b is what fixes the other four workspaces. Both are required.

**Done when:** `npm install && npm run build` at repo root succeeds end-to-end; `apps/api` is not in the turbo task graph.

**WP-02 · Go workspace skeleton**
Depends on: —
`go.work`, `go.mod` per service, `services/internal/` (config, logging, errors, tenancy context, audit), `cmd/altar` with `-service` flag (ADR-004). Health endpoint per service.
**Done when:** `go build ./...` succeeds; `go run ./cmd/altar -service=gateway` serves `GET /health` → `{"status":"ok"}`.

**WP-03 · Local infrastructure**
Depends on: —
`docker-compose.yml`: MySQL 8, Redis 7, Kafka (KRaft, no ZooKeeper), Kafka UI. Seed script creating per-service schemas.
**Done when:** `docker compose up -d` → all healthy; `mysql -h127.0.0.1 -e 'SHOW DATABASES'` lists every service schema.

**WP-04 · Contract pipeline**
Depends on: WP-02
Generator: `packages/shared-types/*.ts` → `proto/altar/v1/*.proto` → Go structs. CI check failing on drift (§4.4).
**Done when:** `make proto` regenerates cleanly; CI fails if a `shared-types` field is added without regenerating.

**WP-05 · Config, secrets, residency**
Depends on: WP-02
Env loader mirroring [env.ts](apps/api/src/infrastructure/config/env.ts). Per-country `data_region` resolution (§3.4). **Fail fast and loudly on missing required secrets** — never silently fall back to a stub in a non-dev environment (§0.3).
**Done when:** boot with `PAYSTACK_SECRET_KEY` unset and `APP_ENV=production` exits non-zero with a named error.

**WP-06 · Consent & data-subject-rights foundation**
Depends on: WP-03
`consents` table: per-purpose, versioned, timestamped, revocable. Middleware asserting consent before processing in a given purpose. `altar.consent.changed.v1` emission.
**Done when:** revoking `communications` consent causes the comms service to skip that member in a broadcast — proven by test.

**WP-07 · Tenant isolation harness**
Depends on: WP-03, WP-04
`sqlc` wrapper requiring tenant context (§4.5); CI lint for un-scoped tenant SQL; two-church cross-tenant integration suite.
**Done when:** a deliberately un-scoped query fails CI lint; cross-tenant reads return zero rows across all seeded domains.

**WP-08 · Audit log & observability**
Depends on: WP-02, WP-03
Append-only `audit_log` capturing actor, action, resource, tenant, IP, timestamp — **including reads of sensitive data** (§3.4(5)). OpenTelemetry traces across gateway → gRPC → MySQL.
**Done when:** reading a prayer request writes an audit row; a single trace spans gateway → service → DB.

### Phase 1 — Walking skeleton (vertical slice, ADR-003 mitigation)

**WP-10 · Auth service** — Depends on: WP-02, WP-04, WP-07
Port `reference/ts-domain/.../auth/`. Phone OTP (primary — §2.3), email/password, social (optional). JWT access + refresh, Redis session/revocation, bcrypt. RBAC per PDF §3 extended to the org tier (WP-11).
**Done when:** OTP register → login → refresh → revoke passes end-to-end against real MySQL + Redis; expired and revoked tokens rejected.

**WP-11 · Organization / church / branch hierarchy** — Depends on: WP-10
§4.6 model: organizations, churches, parent-child branches, departments, groups. Role resolution at every level.
**Done when:** an Org Admin lists members across all branches; a Church Admin sees only their branch — asserted in tests.

**WP-12 · Member service + CRM** — Depends on: WP-11
PDF §6.1: profiles, household linking, status tracking. E.164 normalisation. Bulk CSV import with dedupe. Emits `member.created`, `member.status_changed`.
**Done when:** importing 1,000 rows with mixed phone formats produces 1,000 members, zero duplicates, all E.164.

**WP-13 · Payment gateway adapter (Paystack, real)** — Depends on: WP-05
Replace `StubPaymentGateway`. **Subaccount-per-church (ADR-002)**: create/link subaccount, initialise with split code, verify, HMAC-verified webhooks. E-Levy modelled and returned pre-confirmation (§2.3). Idempotency on the unique constraints in §5.2.
**Done when:** a Paystack test-mode MoMo charge settles to a test subaccount with the platform split applied; replaying the webhook 3× creates exactly one transaction.

**WP-14 · Finance service + giving** — Depends on: WP-12, WP-13
PDF §5.4 / §6.4: tithe (incl. recurring), offering, donation, campaign. Income/expense ledger, giving summaries. Emits `giving.completed` / `giving.failed`.
**Done when:** member gives via MoMo → transaction `success` → church balance reflects `net_amount` → `giving.completed` consumed by notification.

**WP-15 · Notification service** — Depends on: WP-06, WP-03
PDF §8: push (FCM), SMS (Africa's Talking / Hubtel), email (Resend). Real adapters replacing stubs. **Consent-gated (WP-06)**, per-channel preference, quiet hours, delivery-status tracking, retry with backoff.
**Done when:** `giving.completed` produces one SMS receipt; a member with revoked comms consent receives nothing.

**WP-16 · Gateway wiring + frontend cutover** — Depends on: WP-00b, WP-10, WP-12, WP-14
Gateway routes for auth/member/finance. Point `dashboard` and `mobile` at the Go API. `shared-types` unchanged — the contract holds.
**Done when:** login, view members, and give all work from the Expo app against Go, with no `shared-types` edits.

**WP-17 · CI/CD** — Depends on: WP-02, WP-03
Extend [.github/workflows/ci.yml](.github/workflows/ci.yml): Go build/vet/test, migration up-down verification, testcontainers integration, per-service Docker images.
**Done when:** a PR runs Go + TS pipelines; a broken migration fails CI.

**WP-18 · Kubernetes baseline** — Depends on: WP-17
PDF §15: Dockerfiles (distroless), kustomize base + dev/staging/prod overlays, HPA, secrets via sealed-secrets, liveness/readiness.
**Done when:** `kubectl apply -k deploy/overlays/dev` brings the stack healthy on a local cluster.

**WP-19 · 🚩 PHASE 1 GATE — vertical slice demo**
Depends on: WP-16, WP-18
A real member on a real phone registers by OTP, gives GHS 10 by mobile money to a real church subaccount, receives an SMS receipt, and the church admin sees it in the dashboard within 60s.
**Done when:** demonstrated end-to-end on staging with live provider test credentials. **Phase 2 does not start until this passes.**

**WP-20 · Retire `apps/api`** — Depends on: WP-19
Delete `apps/api`. `reference/ts-domain/` stays.
**Done when:** `apps/api` gone; all frontends green against Go.

### Phase 2 — Full breadth (all remaining PDF sections)

**WP-21 · Event service & attendance** (PDF §5.6) — Depends on: WP-12
Events, RSVP, QR check-in, attendance logs, recurring services. **Offline check-in queue** (§8.3) — ushers scan without connectivity and sync later.
**Done when:** 200 check-ins recorded fully offline reconcile with zero duplicates on reconnect.

**WP-22 · Communication service** (PDF §6.3) — Depends on: WP-15
Broadcast + targeted messaging. Target filters per PDF: location, department, activity level — plus branch, giving recency, group. Templates, scheduling, per-message cost preview (SMS is metered and churches will care).
**Done when:** a broadcast to "inactive members in the youth department, Accra branch" resolves the correct set and reports cost before send.

**WP-23 · WhatsApp Business channel** (§8.5, **not in PDF**) — Depends on: WP-22
WhatsApp Cloud API: template messages, opt-in management, delivery receipts. In much of West Africa WhatsApp is *the* messaging layer; SMS-only communication will under-perform badly.
**Done when:** an announcement delivers via WhatsApp to opted-in members, with SMS fallback on failure.

**WP-24 · Social system** (PDF §5.5) — Depends on: WP-12
Feed (posts, testimonies), comments, likes, group chats. Moderation queue and reporting — a church-branded feed without moderation is a liability.
**Done when:** post → comment → like → report → moderator action, all tenant-scoped.

**WP-25 · Analytics dashboard** (PDF §6.2) — Depends on: WP-14, WP-21
Attendance trends, giving trends, engagement score. Materialised rollups on Kafka consumers (never live aggregate queries on transactional tables). Branch-level and org-level consolidation (§4.6).
**Done when:** a denominational admin sees consolidated giving across 5 branches; queries return < 500ms at 100k transactions.

**WP-26 · Campaigns & project management** (PDF §6.5) — Depends on: WP-14
Fundraising campaigns, donation tracking, progress, **pledges** (pledge → schedule → fulfilment tracking; §8.2).
**Done when:** a pledge of GHS 1,000 over 10 months tracks partial fulfilment and flags arrears.

**WP-27 · Welfare system** (PDF §5.7) — Depends on: WP-12, WP-08
Assistance requests, emergency alerts, volunteer matching. **Encrypted at rest, separate key, strict pastoral ACL, excluded from analytics** (§3.4(3)).
**Done when:** a church admin without the welfare role cannot read case details via any endpoint; attempts are audited.

**WP-28 · Spiritual module** (PDF §5.3) — Depends on: WP-12
Devotionals, sermon streaming/library, prayer requests. **Bible: public-domain translations only (KJV/WEB) with offline sync** until commercial licences are signed (§3.5). Local-language translations where rights permit (§8.4).
**Done when:** Bible reads fully offline after first sync; no non-public-domain translation ships; prayer requests are encrypted and pastoral-ACL'd.

**WP-29 · Media & storage** — Depends on: WP-05
Cloudinary adapter replacing the stub. **Adaptive bitrate and aggressive compression** — sermon video on African mobile data is a cost and abandonment problem, not a bandwidth footnote. Audio-only variant, explicit download-for-offline.
**Done when:** a 45-minute sermon streams acceptably on a throttled 3G profile; audio-only is offered by default on metered connections.

**WP-30 · AI service** (PDF §7) — Depends on: WP-12, WP-25
Go, using the official Anthropic Go SDK (`github.com/anthropics/anthropic-sdk-go`).
- **Sermon assistant** — topic → outline. Model: `claude-opus-5`, adaptive thinking, `effort: high`.
- **Member insights** — inactivity detection and follow-up suggestions. Runs on aggregates; a cheaper tier (`claude-haiku-4-5`) is appropriate for routine scoring.
- **Prayer assistant** — chat with scripture-grounded responses. Model: `claude-opus-5`.

**Three guardrails are mandatory, not optional (§8.6):**
1. **Denominational configuration** — doctrinal position is a tenant setting injected into the system prompt. A single hardcoded theological voice will be wrong for most tenants and offensive to some.
2. **Crisis escalation** — prayer/chat input indicating suicidal ideation, abuse, or acute crisis must **immediately route to a human pastoral contact** and emit `altar.prayer.escalated.v1`. The AI must never be the only responder to a crisis disclosure. This is a safety requirement.
3. **Data boundary** — prayer request and welfare content is never used for training, fine-tuning, or cross-tenant context.

Cost control: per-church monthly token budget, `effort` tuned down for routine calls, prompt caching on the stable system prefix.
**Done when:** a seeded crisis-phrase test escalates to a human within one turn and never returns an AI-only reply; doctrinal config demonstrably changes output; per-church budget enforced.

**WP-31 · Inter-church platform** (PDF §9) — Depends on: WP-11, WP-25
Church discovery, marketplace listings with Super Admin approval (PDF §3.1), collaboration tools. `packages/shared-types/src/marketplace.ts` already models this.
**Done when:** a listing is submitted, approved by platform admin, and discoverable cross-tenant with no data leakage beyond the published fields.

**WP-32 · Super Admin console** (PDF §3.1) — Depends on: WP-25, WP-31
`apps/admin` wired: all churches, system health, marketplace approvals, global analytics, plan/billing management.
**Done when:** platform admin suspends a church and that church's users are denied at the gateway on their next request.

**WP-33 · Volunteer scheduling & rota** (§8.7, **not in PDF**) — Depends on: WP-21
Service-team scheduling, availability, swap requests, reminders. This is Planning Center's stickiest feature and its absence is a competitive gap.
**Done when:** a rota publishes, a volunteer declines, a swap is accepted, and reminders fire.

**WP-34 · Discipleship / follow-up pipeline** (§8.8, **not in PDF**) — Depends on: WP-12, WP-30
First-timer → new convert → member journey with stages, assigned follow-up owners, and AI-suggested actions from WP-30.
**Done when:** a first-timer recorded on Sunday generates an assigned follow-up task with an SLA and escalates if untouched.

### Phase 3 — Hardening & launch

**WP-40 · Security review** — Depends on: Phase 2
PDF §10 in full plus: OWASP ASVS pass, rate limiting, brute-force lockout, tenant-isolation penetration test, secret rotation, dependency scanning. **Explicit re-audit that no ALTAR OS-held-funds path exists** (ADR-002 invariant).
**Done when:** no critical/high findings open; ADR-002 invariant confirmed by review.

**WP-41 · Performance & scale** (PDF §11) — Depends on: Phase 2
Targets: 1M+ users, **p95 < 200ms** API response, 99.9% uptime, horizontal scaling via K8s HPA. Load test with k6; index tuning; N+1 elimination; read replicas.
**Done when:** load test sustains the target at p95 < 200ms with documented headroom.

**WP-42 · Compliance implementation** — Depends on: WP-06, WP-08
Data-subject-rights endpoints (export / rectify / erase), retention policies, breach-notification runbook, DPIA, per-country residency enforcement, processor agreements with Paystack / Africa's Talking / Cloudinary / Anthropic.
**Done when:** a full subject-access export completes for one member across every domain; erasure leaves no residual PII outside legally-required financial records.

**WP-43 · Test strategy** (PDF §14) — Depends on: Phase 2
Go unit tests (target ≥ 70% on domain/application), testcontainers integration, contract tests on `.proto`, k6 load, E2E on the critical giving path.
**Done when:** coverage gate passes in CI; the giving path has E2E coverage.

**WP-44 · Localisation** (§8.4, **not in PDF**) — Depends on: Phase 2
i18n across mobile + dashboard. Priority: English, Twi, Ga, Ewe, Hausa, Yoruba, Swahili, French. Locale-aware currency, dates, number formatting.
**Done when:** the mobile app runs fully in Twi including giving and OTP flows.

**WP-45 · Low-end device & offline hardening** (§8.3) — Depends on: WP-21, WP-28
Target Android 8+, ≤ 2GB RAM. APK size budget, offline-first sync for Bible/devotionals/attendance, conflict resolution, degraded-network UX.
**Done when:** the app is usable on a 2GB-RAM Android 8 device with intermittent connectivity; core reads work fully offline.

**WP-46 · Monetization & billing** (PDF §16) — Depends on: WP-32
SaaS subscription tiers, transaction-fee split reporting, premium feature gating, marketplace commission. GHS-denominated pricing per §2.2.
**Done when:** a church upgrades plan, feature gates change immediately, and platform-fee revenue reconciles against transaction records to the cent.

---

## §11. Workspace-scoped identity (ADR-006)

### 11.1 What "workspace" means here

The workspace is the **church**, addressed by its `slug`. Three things follow.

**Login carries a workspace.** `LoginRequest` gains `workspace`. On `grace.altaros.com` it is filled from the hostname and never shown; on the shared `app.altaros.com` it is a field on the form. A member of one church should never learn that they are inside a multi-tenant system.

**Identity is per-church.** `(churchId, email)` and `(churchId, phone)` are unique; `email` alone is not. One person attending two churches has two accounts, and that is the honest model — their role, permissions, giving history and consent are all per-church, and merging them into one identity would mean deciding which church's data an unscoped session may see. There is no good answer to that question, so the design avoids being asked it.

**Every credential lookup is scoped.** `findByEmail(email)` becomes `findByEmail(churchID, email)`. The same applies to OTP: Redis keys become `otp:code:<workspace>:<phone>`, or a code sent for one church would verify against another.

### 11.2 The failure that matters: enumeration

A wrong workspace, a wrong email, an email that exists in a different church, and a workspace that does not exist must be **one indistinguishable answer**, in one indistinguishable time.

> "We could not sign you in. Check the workspace and your details."

Anything more specific turns the login form into a directory. "No such workspace" enumerates customers — competitively useful and, for a church in a hostile region, a safety problem. "That email is not in this workspace" tells an attacker which of a leaked credential dump belongs to which congregation. The existing auth service already runs bcrypt against a dummy hash when the account is missing, precisely so the timing does not leak; workspace resolution must be inside that same constant-time envelope rather than a cheap early return in front of it.

### 11.3 Invitations

Members and staff arrive by invitation, not self-signup, in the default configuration.

```
invitations: {
  _id, churchId, email, phone,
  roleId,                     // the role they get on acceptance
  invitedBy, invitedAt,
  tokenHash,                  // SHA-256; the raw token only ever exists in the link
  expiresAt,                  // 7 days
  acceptedAt, acceptedUserId,
  revokedAt
}
```

- The token is **hashed at rest**, like the OTP codes in WP-10. An invitation link in a leaked database backup is otherwise a working account.
- Single-use and expiring. An invitation that never expires is a permanent unauthenticated path into a church's data.
- Accepting creates the user **inside the inviting church** — the workspace is carried by the token, never typed, so an invitation cannot be redirected at another church.
- Re-inviting an existing member is idempotent: it revokes the outstanding invitation and issues a new one, rather than accumulating live tokens.

---

## §12. RBAC (ADR-008)

### 12.1 Permission naming

`resource:action`, where action is one of `create`, `read`, `update`, `delete`. Resources are the domains this platform already has: `member`, `finance`, `event`, `communication`, `prayer`, `welfare`, `role`, `page`, `settings`, `report`.

`role:create` is itself a permission, which is what makes requirement 1 — "roles can be created by an admin **with the right permissions**" — expressible rather than hard-coded.

### 12.2 The dependency rule, enforced twice

**One cannot hold `create`, `update` or `delete` on a resource without `read` on it.** A permission set that violates this is not stored:

1. **On write** — saving a role or an override that grants `finance:update` without `finance:read` is rejected with the reason, so an admin sees the rule rather than discovering it later.
2. **On expansion** — computing effective permissions adds the implied `read`. Belt and braces: the first stops bad data being created, the second makes existing data safe.

The rule exists because the alternative is incoherent. A user who may edit a giving record but not read one gets an edit form full of blanks that overwrites real values with them.

### 12.3 Effective permissions

```
effective = expand( (role.permissions − user.revoked) ∪ user.granted )
```

Computed at token issue and re-computed at every refresh — so a role edit reaches every holder within one access-token lifetime (15 minutes), and sooner if the change bumps their permission version and forces a refresh.

```
roles:  { _id, churchId, name, description, permissions[], isSystem, version, createdBy, ... }
users:  { ..., roleId, permissionOverrides: { granted[], revoked[] } }
```

`isSystem` marks the three roles every church starts with — Admin, Staff, Member — which may be **copied but not deleted**. A church that deletes its only admin role has locked itself out, and the recovery is a support ticket against a production database.

### 12.4 Getting a change to a signed-in user

The repo already has the mechanism: Redis-backed revocation with a token family (WP-10). A permission change writes a new `permVersion` for the affected users; the auth middleware compares the token's version against Redis and rejects a stale one, which the client's existing refresh interceptor turns into a silent re-issue. A *removal* of permission therefore takes effect immediately rather than at expiry — which is the direction that matters, since the risk is someone retaining access they should have lost.

### 12.5 The rule that must not be softened

**Hiding a button is not authorisation.**

Requirement 7 is a UX requirement and is worth implementing exactly as stated — a member should not see a Delete they cannot use. But every one of those routes and buttons must *also* be enforced server-side, because the client is under the user's control and "the button was not rendered" is not a security boundary. The frontend uses permissions to decide what to *show*; the gateway uses them to decide what to *allow*. The plan treats a route protected only in the UI as an open route.

Concretely, the existing `requireRole(...)` allowlist becomes `requirePermission("finance:read")`, and `selfOrLeader` keeps its ownership check on top — a member may read *their own* giving without holding `finance:read` over the congregation.

### 12.6 Frontend shape

The access token carries the effective permission list, so the UI needs no extra round trip. Then:

- `<Can do="member:create">` renders children or nothing.
- A route guard returns 404, not 403, for a resource the user cannot read. 403 confirms the thing exists.
- Nav items filter themselves, so a Staff member does not see a Finance section that rejects them on click.

---

## §13. Per-church sites and the CMS (ADR-007)

### 13.1 Routing

```
grace.altaros.com     → Grace Chapel's public site
app.altaros.com       → the shared login / workspace picker
admin.altaros.com     → platform admin
api.altaros.com       → the gateway
```

A `tenantFromHost` middleware resolves the Host header to a church and puts it in the request scope, cached in Redis with a short TTL because it is on every request to the public site. An unknown subdomain gets a **branded "no such church" page, not a 404 from the router** — the visitor typed a church name, and a raw 404 tells them nothing.

**Reserved slugs are refused at church creation, not patched later:** `www, api, app, admin, mail, smtp, ftp, cdn, static, assets, blog, help, support, status, docs, dev, staging, test, internal, dashboard, my, secure, login, auth, pay, checkout`. A church legitimately called "Apostolic Prayer International" must not be able to take `api`.

### 13.2 Certificates

*(Researched 1 Aug 2026. The first research pass failed; this replaces it.)*

`*.altaros.com` is a **single wildcard certificate** via cert-manager with a **DNS-01 solver**. DNS-01 is not a preference — HTTP-01 and TLS-ALPN-01 **cannot issue a wildcard at all**, so the DNS provider has to be one cert-manager can automate (Cloudflare, Route53, Azure DNS, Google CloudDNS and others are built in; the rest need a webhook solver).

**The wildcard is what makes subdomain onboarding free of certificate cost, and this is the point worth being precise about.** One certificate covers every church on `*.altaros.com`, so onboarding the 200th church issues nothing. Let's Encrypt's binding limit for a registered domain is 50 certificates per 7 days — which would be a hard ceiling on growth if each church needed its own certificate, and is simply not reached when they share one. **Renewals are exempt from rate limits entirely.** Any claim that subdomain onboarding is capped at 50 churches a week is a misreading: that is the cost of *not* using a wildcard.

A church on **its own domain** (`gracechapel.org`) is genuinely different, because each customer domain is its own registered domain and needs its own certificate. Two production patterns:

| | cert-manager `Certificate` per domain | Caddy on-demand TLS |
|---|---|---|
| Issuance | Reconciled by the operator, declarative | On first TLS handshake for an unknown host |
| Abuse control | Only domains you create resources for | Requires an **`ask` endpoint** that checks the domain against the database — without it, anyone pointing DNS at us triggers issuance |
| Ops burden | A Kubernetes resource per tenant domain | Automatic renewal and cleanup |
| First request | Certificate exists before traffic | A few seconds' delay on the very first connection |

Neither is clearly better at a few hundred to a few thousand domains — that comparison could **not** be verified, and it should be settled with a spike rather than a preference. The binding constraint when onboarding customer domains in batches is the **300 new orders per account per 3 hours** limit, not the per-domain one.

This is the whole reason WP-41 is separate from WP-39: subdomains have no per-tenant certificate cost, custom domains do, and shipping the first must not commit us to the second.

### 13.3 The content model

```
pages         { _id, churchId, slug, title, seoDescription, navOrder,
                draftVersionId, publishedVersionId, createdAt, updatedAt }
pageVersions  { _id, churchId, pageId, number, status, publishedAt, publishedBy, note }
blocks        { _id, churchId, versionId, type, position, data }
siteThemes    { _id, churchId, palette, typography, logo, favicon, mode }
```

**Versioning at the page, not the block.** Publishing is then "point `publishedVersionId` at this version", and rollback is "point it at an earlier one" — both atomic, both instant, neither requiring the block rows to be touched. Versioning per block makes both operations a multi-row migration that can half-fail.

**Position is a sparse integer** (10, 20, 30…), so inserting between two blocks is one write rather than renumbering the page.

**Draft and published are different versions**, so a half-finished edit is never live, and a church can leave a page mid-edit for a week without consequence.

### 13.4 The block library (v1)

Chosen from what a church website actually contains, not from what a page builder usually offers:

`hero` · `rich_text` · `service_times` · `sermons` · `events` · `giving_cta` · `leadership` · `contact_and_directions` · `live_stream` · `gallery` · `announcements` · `spacer`

`events`, `sermons` and `giving_cta` **read from the platform's own data**. A church that adds an event in the dashboard should not then re-type it into its website; that duplication is how a church site becomes wrong within a month.

**Deliberately not in v1:** custom HTML, custom CSS, a free-form drag canvas, per-block responsive overrides, A/B tests, forms builder. Each is the feature that turns a CMS into a support queue.

### 13.5 The security boundary

The editor is a church staff member, and the audience is that church's own congregation — the people most likely to trust whatever the page says. So:

- **No block accepts HTML or script.** `rich_text` is a constrained subset (headings, bold, italic, lists, links) sanitised server-side on save and again on render.
- **Every URL is validated** against an allowlist of schemes. `javascript:` in a link field is the cheapest possible XSS.
- **Uploads go to Cloudinary**, typed and size-limited, never served from the platform's own origin — an uploaded file on the same origin as the session cookie is a much larger problem than an uploaded file on a CDN.
- **A CSP on the public site** that does not permit inline script, so a sanitiser bug is not automatically an exploit.

---

## §14. Design directives

These apply to every surface built from here, and to the retrofit in WP-42.

**Loading is skeletal, not spinners.** A skeleton in the shape of the content preserves layout and tells the user what is coming; a spinner says only "wait" and then reflows the page under them. Spinners are permitted only for an action with no known result shape — a payment redirect, say.

**Both themes are first-class.** Dark and light are chosen by the user and default to the system preference. Every token is defined in both; nothing hard-codes a colour. A church hall is dark and a phone in Accra at midday is not.

**Cards in a row are the same height, with actions docked at the bottom.** `display: flex; flex-direction: column` on the card, `margin-top: auto` on the action row. Ragged card bottoms are the single most common tell of a generic admin template.

**Motion is part of the build, not a pass at the end.** Ease-out curves; no bounce. Every animation needs a `prefers-reduced-motion` alternative — the 404 pages already taught this lesson (see the WP-16 notes).

**A drawn visual language, used with discipline.** Doodles and custom shapes are the brand, and the requirement is that the platform should not look like anything else. The way that fails is scattering decoration until the interface is noisy; the way it works is *one* coherent hand-drawn system — consistent line weight, a defined shape vocabulary for buttons and cards, illustration reserved for empty states, splash, 404, and section headers rather than sprayed across data-dense screens. A finance table should be calm. The empty state above it can be delightful.

**Splash and 404 on every surface.** Both exist on the four web apps and mobile already; the remaining apps match, and the splash must never gate first paint on a network call.

**Icons everywhere a label is repeated**, never icon-only for a destructive action.

**Latest package versions**, per the existing convention in this repo.


### Phase 3 — Workspaces, RBAC and church sites (added 1 Aug 2026)

These are sequenced so the risk-carrying migration happens once, early, and everything else builds on it. **WP-35 and WP-36 are prerequisites for the rest and should not be parallelised with them.**

**WP-35 · Workspace-scoped identity migration** — Depends on: WP-10, WP-16
Compound `(churchId,email)` and `(churchId,phone)` uniqueness replacing the global `email_unique`. Workspace on `LoginRequest`, OTP keys namespaced by workspace, every credential lookup church-scoped. The legacy Mongoose schema declares `email: {unique: true}` on the same collection (ADR-005), so this is a coordinated index change across two live writers.
**Sequence, and it matters:** (1) add the compound indexes alongside the existing one; (2) backfill and *prove* zero `(churchId,email)` collisions; (3) update both writers to scope their lookups; (4) only then drop `email_unique`. Dropping first leaves a window where two churches can register the same email and the compound index build then fails.
**Done when:** the same email address holds an account in two churches; signing in to one cannot see the other's data; and a wrong workspace, wrong password, and non-existent workspace return the same message in the same time.

**WP-36 · RBAC core** — Depends on: WP-35
`roles`, `permissions`, `permissionOverrides`; effective-permission computation; dependency expansion (`write ⇒ read`) enforced on write and on expansion; `requirePermission` replacing `requireRole`; permissions in the access token; `permVersion` invalidation through the existing Redis revocation path. Three system roles per church (Admin, Staff, Member) that can be copied but not deleted.
**Done when:** an admin creates a role, assigns it, grants one extra permission to one user, then edits the role — and that user keeps their individual grant while picking up the role's change, within one token refresh. Removing a permission takes effect on the next request, not at token expiry.

**WP-37 · Invitations** — Depends on: WP-36, WP-15
Invite staff and members with an initial role. Hashed single-use tokens, 7-day expiry, workspace carried by the token. Delivery over the notification service (email and SMS), which means it is consent-aware and quiet-hours-aware for free.
**Done when:** an invited member accepts, lands in the inviting church with the intended role, and the token cannot be reused; an expired or revoked token gives the same answer as a forged one.

**WP-38 · Permission-aware UI** — Depends on: WP-36
`<Can>`, permission-filtered navigation, 404-not-403 for unreadable resources, and the action buttons genuinely absent rather than disabled. Applied across `dashboard`, `web` and `admin`.
**Done when:** a Member-role session renders no Finance nav, no Delete buttons, and a direct URL to a finance route returns the not-found page — **and the same request without the UI still returns 403 from the gateway**, proving the UI is not the boundary.

**WP-39 · Subdomain routing** — Depends on: WP-35
`tenantFromHost` middleware, reserved-slug refusal at church creation, the wildcard `*.altaros.com` certificate via cert-manager DNS-01, a branded unknown-church page, and ingress for the wildcard host.
**Done when:** `grace.altaros.com` resolves to Grace Chapel over TLS with no per-church certificate step, and a church cannot be created with the slug `api`.

**WP-40 · Church site CMS** — Depends on: WP-39
`pages`, `pageVersions`, `blocks`, `siteThemes`; the v1 block library; draft/publish/rollback; Cloudinary media; sanitisation on save and render; CSP on the public origin. Editor in the dashboard, renderer on the public subdomain.
**Done when:** a church adds a page, arranges blocks, publishes, and the live site changes — while the draft was invisible until publish and a rollback restores the previous version in one action. A block whose text contains `<script>` renders as text.

**WP-41 · Custom domains** — Depends on: WP-40
Per-domain certificate issuance, domain verification, and the rate-limit handling that per-tenant certificates require. Deliberately separate from WP-39, so shipping subdomains does not commit the platform to the operational cost of customer domains.
**Done when:** a church points its own domain at the platform, and issuance failures are visible and retryable rather than silent.

**WP-42 · Design-system retrofit** — Depends on: WP-38
The §14 directives applied across every existing surface: skeletons replacing spinners, dark/light tokens, equal-height cards with docked actions, the shape and doodle vocabulary, motion with reduced-motion alternatives, splash and 404 everywhere.
**Done when:** no surface uses a spinner where the result shape is known; every card row is flush at the bottom; both themes pass contrast on body text; and every animation has a reduced-motion path.

---

## §8. What this plan adds beyond the PDF

The PDF is a strong skeleton. These are the gaps that research and the repo audit surfaced — each is already assigned to a WP above.

**8.1 · Branch/denominational hierarchy (WP-11).** The PDF's flat church model cannot represent how African churches are actually organised. Retrofitting a tenancy tier after launch is among the most expensive changes possible. §4.6.

**8.2 · Cash is still king (WP-14, WP-26).** The PDF's giving system is entirely digital. In practice a large majority of Ghanaian church income still arrives as **physical cash offerings**. Without a counting-team workflow — dual-control count, recorded-by attribution, variance flagging, reconciliation against digital — the finance module reports a fraction of real income and no treasurer will trust it. `channel='cash'` and `recorded_by` in §5.2 exist for this. Pledges are the same story: committed-but-unpaid giving is a core church finance concept the PDF omits.

**8.3 · Offline-first is a requirement, not a feature (WP-21, WP-45).** Intermittent connectivity is the norm. Attendance check-in at a service with 400 people and no signal must work. The PDF marks only the Bible as offline-supported; check-in, member lookup, and devotionals need it too.

**8.4 · Local languages (WP-28, WP-44).** An English-only app in a country where Twi is the dominant spoken language limits member adoption to the digitally fluent — precisely the wrong constraint for a platform whose value is member activation (§2.1).

**8.5 · WhatsApp (WP-23).** The PDF's channels are push/SMS/email. In West Africa WhatsApp carries most person-to-person and group communication. An SMS-only strategy pays per message for lower engagement than a free-to-the-user channel people already live in.

**8.6 · AI safety and doctrinal configuration (WP-30).** The PDF specifies an AI prayer assistant giving "scripture-based responses" with no guardrails. Two serious problems: (a) doctrinal positions differ sharply between denominations, and a single hardcoded voice will be wrong for most tenants; (b) **prayer requests are exactly where people disclose abuse, suicidal ideation, and acute crisis** — an AI must never be the sole responder. Crisis escalation to a human is a safety requirement, not a feature toggle.

**8.7 · Volunteer scheduling (WP-33).** Planning Center's stickiest module and entirely absent from the PDF. Rota management is weekly-recurring, multi-person, and creates habitual platform use.

**8.8 · Discipleship pipeline (WP-34).** The PDF tracks members as active/inactive. Churches think in journeys: first-timer → new convert → baptised → member → leader. Modelling the journey is what makes "AI member insights" (PDF §7.2) actionable rather than decorative.

**8.9 · Financial controls (WP-14, WP-40).** Church finance is a high-fraud-risk domain and the PDF has no dual-approval, no segregation of duties, no immutable financial audit trail. Given ADR-002 keeps ALTAR OS out of custody, the platform's credibility rests on being a trustworthy *record*, which requires controls.

---

## §9. Risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R-0 | **Zero commits — entire codebase is one `git reset` from total loss.** 48 files already exist only in the index, nowhere on disk | **Catastrophic / imminent** | WP-00b then WP-00c, immediately, before any other work. This is the single most urgent item in the plan |
| R-1 | **Breadth-first starves the rewrite of a demoable milestone** (ADR-003) | High | WP-19 is a hard gate; no Phase 2 work starts until the vertical slice runs live |
| R-2 | Feature creep reintroduces custody of church funds, triggering Act 987 licensing | **Critical** | ADR-002 invariant; WP-40 explicit re-audit; any wallet/float/escrow proposal escalates before implementation |
| R-3 | Ghana DPC enforcement lands before registration completes | **Critical** | GHS 3M / 5% turnover exposure. Registration is a launch gate (Q-1); WP-42 delivers the technical requirements in parallel |
| R-4 | Cross-tenant data leak via a missing `church_id` predicate | **Critical** | WP-07: layer-enforced tenancy, CI lint, cross-tenant test suite |
| R-5 | Stub payment gateway reaches a real environment (`verifyCharge` returns success unconditionally) | **Critical** | WP-05 fail-fast on missing secrets in non-dev; WP-13 deletes the stub outright |
| R-6 | Go rewrite runs long; frontends stall waiting on APIs | High | `shared-types` contract is stable and frozen; frontends develop against it while Go lands |
| R-7 | Bible translation shipped without a commercial licence | Medium-High | WP-28 restricts to public domain until licences are signed |
| R-8 | AI produces doctrinally objectionable output, or mishandles a crisis disclosure | **Critical (safety)** | WP-30 guardrails 1 and 2; crisis escalation tested with seeded phrases |
| R-9 | SMS costs exceed subscription revenue | Medium | WP-22 cost preview; WP-23 WhatsApp as cheaper primary; per-plan metering |
| R-10 | **The `email_unique` migration (WP-35) is coordinated across two live writers on one shared collection.** Dropping the global index before both writers scope their lookups leaves a window where two churches register the same address, after which the compound index build fails and the fix is manual data surgery | **High** | WP-35's four-step sequence: add compound indexes → backfill and prove zero collisions → update both writers → only then drop. Never the other order |
| R-11 | **A permission enforced only in the UI.** Requirement 7 hides routes and buttons, which reads as security and is not — the client is under the user's control | **Critical** | §12.5: every hidden route also enforced at the gateway. WP-38's acceptance explicitly asserts the API still returns 403 with the UI bypassed |
| R-12 | **A permission removed from a role is not removed from users who hold it individually** (ADR-008, Q-11) — an admin believes access is revoked when it is not | High | Role editor warns and lists affected users; a "clear individual overrides" action. Needs the Q-11 decision before WP-36 ships |
| R-13 | **A church CMS block becomes an XSS vector aimed at that church's own congregation** — the audience most likely to trust the page | **Critical** | §13.5: no HTML or script in any block, sanitisation on save *and* render, URL scheme allowlist, uploads off-origin to Cloudinary, CSP on the public site |
| R-14 | **Custom-domain certificate issuance scales per customer** and hits CA rate limits as churches are onboarded in batches | Medium-High | WP-41 is deliberately separate from WP-39, so subdomains ship without taking on this cost; issuance failures must be visible and retryable, never silent |
| R-15 | A church takes a **reserved subdomain** (`api`, `admin`, `www`) and breaks platform routing | Medium | Reserved-slug list refused at church creation in WP-39, not patched after the fact |
| R-10 | Kafka operational burden pre-launch | Medium | Single-node KRaft in dev; ADR-004 keeps the deploy simple; revisit managed Kafka at scale |
| R-11 | Solo/small team across 8 services + 5 frontends + compliance | High | ADR-004 single-binary deploy; strict WP dependency order; Phase 3 items deferrable but never skippable pre-launch |

---

## §10. Open questions

Blocking or near-blocking. Each needs an owner decision; none should stall Phase 0.

- **Q-1 (blocking launch):** Has ALTAR OS registered with the Ghana Data Protection Commission? If not, start now — registration is a *precondition* to lawful processing, not a post-launch formality, and 2026 is an active enforcement year.
- **Q-2:** Paystack or Flutterwave as primary? Paystack's multi-split gives finer fee-bearer control (`bearer_type: account | all | subaccount`) and flat-vs-percentage platform charges, which suits ADR-002 better. Recommend Paystack primary, Flutterwave as the second adapter behind the same port. Confirm.
- **Q-3:** Launch country set — Ghana only, or Ghana + Nigeria at once? Determines whether NDPA registration (>200 subjects) is a Phase 1 or Phase 3 concern.
- **Q-4:** Who bears transaction fees — church, giver, or split? Materially changes giving conversion. **Provisionally answered in code:** the adapter defaults `bearer` to `subaccount`, so the church bears Paystack's fee as a cost of its own collection, which follows from ADR-002 making the church the merchant. It is one config field to change — but changing it after churches have seen their first settlement statement is a trust problem, so it should be decided before the first live charge.
- **Q-5:** Is there a launch partner denomination? A branch network as design partner would validate WP-11's hierarchy against reality before it hardens.
- **Q-6 (new, blocks WP-13's acceptance):** Does ALTAR OS have a **Paystack account with test-mode keys**? The adapter is written and covered, but "a test-mode MoMo charge settles to a test subaccount with the platform split applied" cannot be demonstrated without credentials. Two things can only be confirmed against the real API: that a subaccount can actually be created with a **mobile money** settlement destination (Paystack Ghana's supported MoMo settlement codes are not documented in a form worth guessing at), and that `transaction_charge` behaves as documented against a live split. Until then WP-13 stays 🟡.
- **Q-9 (new, blocks WP-35):** Can one person hold **one login across several churches** with a workspace picker after authenticating, or must they hold separate accounts? The plan assumes separate accounts, because a single identity spanning churches forces a decision about what an unscoped session may see and there is no safe answer. A picker is possible later as a convenience layer over separate accounts. Confirm before the index migration, because it is hard to reverse.
- **Q-10 (new):** Is **self-signup** allowed, or is every account invited? §11.3 assumes invitation-only by default with self-signup as a per-church setting. It changes the abuse surface: open signup on a subdomain lets anyone create an account inside a church's workspace.
- **Q-11 (new, needs an explicit decision):** Under ADR-008, if a permission is granted to a user individually and later **removed from their role**, the user **keeps it**. That follows directly from requirement 5, but it means "remove finance access from the Staff role" does not remove it from everyone. Should the role editor warn and list the users with individual grants, and should there be a "clear individual overrides" action? Recommended: yes to both — the alternative is a permission removal an admin believes worked.
- **Q-14 (new, found while verifying seeded data):** An org admin can see **which** branches exist but not their **data**. `VisibleChurchIDs` returns all 3 branches for the bishop, yet `GET /members` returns only their home branch's 120 — because the member, finance and notification services all scope to the caller's single church through `TenantCollection`, which is exactly what it is designed to do. Cross-branch *reading* needs an explicit opt-in per endpoint (`?scope=organization`, resolved through `VisibleChurchIDs` into an `$in` filter) rather than the tenant wrapper quietly widening, since widening it by default would remove the guarantee WP-07 exists for. Worth deciding before WP-36, because RBAC will otherwise grow a permission whose scope is ambiguous.
- **Q-12 (new):** **Who pays for a custom domain** (WP-41), and is it a paid tier feature? Per-domain certificate issuance is the one part of this plan with a per-tenant operational cost that grows with customer count.
- **Q-13 — answered (1 Aug 2026), and it constrains WP-40.** Church sites must be **server-rendered**. A client-side SPA is no longer viable for discovery: Google queues JavaScript-heavy pages for weeks before rendering them, and the AI crawlers churches are increasingly found through (GPTBot, PerplexityBot, ClaudeBot) **do not execute JavaScript at all** — they receive an empty page. A church that cannot be found is a church that does not renew. WP-40's public renderer is therefore SSR with hydration, not the Vite SPA pattern the dashboard uses. The remaining open part is *which* renderer, and whether it shares a codebase with the existing apps.
- **Q-8 (new):** How does a member **find their church at signup**? The web register form asks for a "church code", but the API accepts only `churchId` (a 24-character ObjectId) or `churchName` (which *creates* a church and makes the registrant its admin — wrong for a member joining one). The form now passes the entered value as `churchId`, which works only if an admin shares the raw id. A friendly short code needs either a lookup endpoint (`GET /churches/by-code/:code`) or a `code` field on the church record with a resolve step in registration. Small, but it sits directly on the member-activation path §2.2 identifies as the actual hard problem.
- **Q-7 (new):** Is the **commission rate** set? The code takes it as basis points per subaccount with a platform default, so nothing is hard-coded — but the rate is the business model (§2.2: the transaction-fee line out-earns the SaaS line at scale), and it is written into each church's subaccount at creation. Changing it later means updating every existing subaccount.
- **Q-6:** Target device floor. WP-45 assumes Android 8 / 2GB. Confirm or adjust.
- **Q-7:** AI cost ceiling per church per month — sets the model tier and `effort` defaults in WP-30.

---

## Appendix A — Sources

Market and competition: [Best Church Management Software 2026 comparison](https://blog.petieclark.com/church-management-software-in-2026-an-honest-comparison/) · [Pushpay review and pricing](https://churchmemberpro.com/blog/pushpay-review/) · [Tithe.ly alternatives](https://churchmemberpro.com/blog/tithely-alternatives/) · [Asoriba](https://www.asoriba.com/) · [Asoriba launch coverage](https://disruptafrica.com/2017/02/08/asoriba-launched-in-ghana-to-disrupt-church-management/) · [Asoriba (Wikipedia)](https://en.wikipedia.org/wiki/Asoriba)

Payments and regulation: [Payment Systems and Services Act 2019 (Act 987) — Bank of Ghana PDF](https://www.bog.gov.gh/wp-content/uploads/2022/03/Payment-Systems-and-Services-Act-2019-Act-987_.pdf) · [BoG licensing of PSPs](https://www.bog.gov.gh/notice/licensing-and-authorisation-of-payment-service-providers/) · [PSP Licence Ghana — 2026 requirements](https://blog.norebase.com/payment-service-provider-licence-ghana/) · [Paystack Multi-split Payments](https://paystack.com/docs/payments/multi-split-payments/) · [Flutterwave Split Payments](https://developer.flutterwave.com/v3.0/docs/split-payments)

Data protection: [Ghana DPC — registration](https://dataprotection.org.gh/registration/) · [Ghana fines warning, enforcement era](https://www.newsghana.com.gh/ghana-issues-fines-warning-as-data-enforcement-era-begins/) · [Ghana Data Protection Act complete guide 2026](https://www.recordinglaw.com/world-laws/world-data-privacy-laws/ghana-data-privacy-laws/) · [Nigeria Data Protection Act 2023 (PDF)](https://cert.gov.ng/ngcert/resources/Nigeria_Data_Protection_Act_2023.pdf) · [NDPC controller registration thresholds](https://globaladvisoryexperts.com/ndpc-data-controller-registration/) · [Kenya Data Protection Act 2019](https://www.kentrade.go.ke/wp-content/uploads/2022/09/Data-Protection-Act-1.pdf)

Mobile money: [Ghana MoMo transactions GH¢649.2bn early 2025](https://www.graphic.com.gh/business/business-news/ghanas-mobile-money-transactions-hit-ghc649-2-billion-in-early-2025.html) · [MoMo record levels 2025](https://www.newsghana.com.gh/mobile-money-transactions-surge-to-record-levels-in-2025/) · [E-Levy status 2026](https://www.jbklutse.com/e-levy-ghana-status/) · [Ghana mobile money statistics](https://asetenapa.com/ghana-mobile-money-statistics/)

Bible licensing: [API.Bible licensing](https://care.api.bible/article/369-understanding-api-bible-licensing) · [API.Bible commercial licensing](https://care.api.bible/article/409-express-licensing-for-commercial-use) · [ESV API](https://api.esv.org/) · [YouVersion Platform terms](https://platform.youversion.com/terms)

Architecture: [MongoDB multi-tenant schema design](https://oneuptime.com/blog/post/2026-01-25-mongodb-multi-tenant-schema-design/view) · [Multi-tenant SaaS deployment 2026](https://northflank.com/blog/multi-tenant-saas-platform-deployment) · [Go microservices patterns](https://appetizers.io/en/blog/golang-microservices-architecture/) · [Building gRPC services in Go](https://oneuptime.com/blog/post/2026-01-07-go-grpc-services/view)
