/**
 * Subdomains a church may not take (WP-39, §13.1).
 *
 * Under ADR-007 a church's slug IS its subdomain — `grace-chapel` becomes
 * `grace-chapel.altaros.com` — so a slug is not a display detail, it is a
 * routing decision. A church legitimately called "Apostolic Prayer
 * International" must not be able to take `api`.
 *
 * This is the canonical list and it lives here, in the package both writers
 * already share, for a reason WP-35 made concrete: when the Go services and the
 * legacy TypeScript API each keep their own copy of a rule about the same
 * collection, they drift, and whichever ran last wins silently. The Go mirror in
 * internal/domain/church/reserved.go has a test that reads THIS file and fails
 * if the two disagree.
 *
 * Refused at creation rather than patched afterwards: a church that has already
 * printed `api.altaros.com` on its bulletins cannot simply be renamed.
 */
export const RESERVED_SLUGS: readonly string[] = [
  // Platform surfaces named in §13.1.
  "admin",
  "api",
  "app",
  "assets",
  "auth",
  "blog",
  "cdn",
  "checkout",
  "dashboard",
  "dev",
  "docs",
  "ftp",
  "help",
  "internal",
  "login",
  "mail",
  "my",
  "pay",
  "secure",
  "smtp",
  "staging",
  "static",
  "status",
  "support",
  "test",
  "www",

  // Mail and certificate validation. A church holding one of these can receive
  // address-validation mail for the parent domain, which is how domain
  // ownership is proved — this is an account-takeover surface, not a tidiness
  // one.
  "abuse",
  "administrator",
  "hostmaster",
  "postmaster",
  "root",
  "ssl",
  "sysadmin",
  "webmaster",

  // Reserved for platform expansion. Cheap to hold now, impossible to reclaim
  // once a church is using one.
  "account",
  "accounts",
  "billing",
  "cms",
  "console",
  "email",
  "events",
  "files",
  "give",
  "giving",
  "graphql",
  "img",
  "media",
  "metrics",
  "mobile",
  "ns1",
  "ns2",
  "portal",
  "public",
  "sms",
  "sso",
  "track",
  "web",
  "webhook",
  "webhooks",
];

const RESERVED = new Set(RESERVED_SLUGS);

/**
 * Whether a slug is reserved for the platform.
 *
 * Case and surrounding whitespace are normalised first, because DNS is
 * case-insensitive: refusing `api` while allowing `API` reserves nothing.
 */
export function isReservedSlug(slug: string): boolean {
  return RESERVED.has(slug.trim().toLowerCase());
}
