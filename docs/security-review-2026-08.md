# Security review — August 2026

Scope: the recent live streaming, one-tap giving, campaign publishing and
public directory work, plus the cross-cutting surfaces they touch.

Fixed items are in commit `bdd541d`. This file records what was **assessed and
deliberately not changed**, because those findings will resurface — in the next
`npm audit`, or in the next reviewer's head — and the reasoning should not have
to be reconstructed.

## Fixed

| Finding | Severity |
|---|---|
| One grant could pile up orphaned PeerConnections indefinitely | High |
| A stale socket's teardown closed the member's live connection | High |
| grpc GO-2026-6061, reachable from `tracing.Init` | High |
| Three public endpoints with no rate limit | Medium |
| Cover image documented as validated, validated by nothing, never stored | Medium |

## Assessed, sound, unchanged

**WebSocket origin check.** `websocket.Accept` receives the configured CORS
list. The library matches scheme-qualified patterns against `scheme://host`
(`accept.go:245`), so `https://app.altaros.com` is matched correctly and pins
the scheme, which is stricter than a bare host. No wildcard is reachable —
`CORS_ORIGIN` is an explicit list and empty is rejected at startup. A missing
`Origin` header is allowed, which is correct: native apps do not send one, and
the attack this defends against (cross-site WebSocket hijacking) requires a
browser, which always does.

**Room grants.** HMAC-SHA256, compared with `hmac.Equal`. Signature is verified
*before* expiry, so a forger is never told their payload parsed. The room id is
inside the signature and grants are only issued after a tenant-scoped lookup, so
a grant cannot be re-pointed at another church's room.

**Admin search regex.** User input is escaped over the full metacharacter set
and anchored, so neither ReDoS nor an index-defeating scan is reachable.

**Request bodies.** 1 MiB cap via `http.MaxBytesReader`. WebSocket messages are
capped at 32 KiB by the library default, which is comfortably above a gathered
SDP.

**Stored payment authorizations.** AES-GCM encrypted at rest under a key
separate from the welfare key; the `Code` field carries `json:"-"` and is
cleared on every read path. With no key configured the service refuses to store
rather than falling back to plaintext.

**Cross-tenant isolation.** Every query outside `directory` runs through
`TenantCollection`, which refuses to build a query without a church id.
`directory` is the deliberate exception and carries nine tests, each asserting
what must *not* appear.

**Client-side XSS.** No `dangerouslySetInnerHTML`, no `innerHTML`, no WebView
rendering server content, in either client.

## Accepted risk

**npm advisories (4 root causes, 20 reported).** `image-size`, `nanoid` and
`uuid`, reached through `metro`, `@expo/config-plugins` and
`@react-navigation/routers`.

None of these run on a member's phone. `metro` is the bundler and `xcode` /
`config-plugins` run during `expo prebuild` — both on a build machine. Exploiting
them requires feeding malicious input to our own build pipeline, which means
already controlling our source or CI.

They are transitively pinned by Expo SDK 57 and `npm audit fix` cannot resolve
them without a peer-dependency override. Forcing one would risk breaking the
mobile build to address a class of bug that cannot reach a user. **Revisit when
Expo ships an SDK bump**, not before.

**Dashboard tokens in `localStorage`.** Readable by any script running on the
page, which is the standard SPA tradeoff. Mitigated by there being no HTML
injection sink in the app and React escaping by default. Moving to `httpOnly`
cookies means taking on CSRF defence and reworking the refresh flow — a
deliberate architecture decision, not something to change inside a review pass.
Recorded so it is a decision rather than an oversight.

Mobile is not affected: tokens are in `expo-secure-store` on device, with
`AsyncStorage` only on web, where no secure store exists.

## Note on comments

Two of the five fixed findings were comments asserting protections that nothing
implemented — a rate limit "at the edge" and a cover image "checked against the
media rules". Both were written by me. A confident comment about a control is
worse than no comment, because it stops the next person checking. Where this
review confirmed something rather than changing it, the reasoning is above so
the same trap is not set again.
