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
| Mobile | React Native | Expo + React Native, `expo-router`, `expo-camera`, `expo-notifications`, `expo-secure-store` | ⚠️ **Right stack, currently broken** (§0.2) |
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

Not yet started: WP-06 (consent), WP-08 (audit log & observability), and Phase 1 onward.

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
| R-10 | Kafka operational burden pre-launch | Medium | Single-node KRaft in dev; ADR-004 keeps the deploy simple; revisit managed Kafka at scale |
| R-11 | Solo/small team across 8 services + 5 frontends + compliance | High | ADR-004 single-binary deploy; strict WP dependency order; Phase 3 items deferrable but never skippable pre-launch |

---

## §10. Open questions

Blocking or near-blocking. Each needs an owner decision; none should stall Phase 0.

- **Q-1 (blocking launch):** Has ALTAR OS registered with the Ghana Data Protection Commission? If not, start now — registration is a *precondition* to lawful processing, not a post-launch formality, and 2026 is an active enforcement year.
- **Q-2:** Paystack or Flutterwave as primary? Paystack's multi-split gives finer fee-bearer control (`bearer_type: account | all | subaccount`) and flat-vs-percentage platform charges, which suits ADR-002 better. Recommend Paystack primary, Flutterwave as the second adapter behind the same port. Confirm.
- **Q-3:** Launch country set — Ghana only, or Ghana + Nigeria at once? Determines whether NDPA registration (>200 subjects) is a Phase 1 or Phase 3 concern.
- **Q-4:** Who bears transaction fees — church, giver, or split? Materially changes giving conversion and must be settled before WP-13 fixes the fee model.
- **Q-5:** Is there a launch partner denomination? A branch network as design partner would validate WP-11's hierarchy against reality before it hardens.
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
