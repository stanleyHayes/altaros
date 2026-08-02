const ALLOWED_STATIC_PATHS = new Set<string>([
  'notifications',
  'events',
  'community',
  'community/new',
  'give',
  'giving/history',
  'giving/complete',
  'profile',
  'devotional',
  'sermons',
  'prayer',
  'welfare',
]);

const MAX_DEEP_LINK_LENGTH = 2_048;
const SAFE_ROUTE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_PAYMENT_REFERENCE = /^alt_[a-z2-7]{32}$/i;

function hasSafePaymentQuery(query: string): boolean {
  const params = new URLSearchParams(query);
  const entries = Array.from(params.entries());
  if (entries.length < 1 || entries.length > 2) return false;
  const keys = new Set<string>();
  for (const [key, value] of entries) {
    if ((key !== 'reference' && key !== 'trxref') || keys.has(key)
      || !SAFE_PAYMENT_REFERENCE.test(value)) return false;
    keys.add(key);
  }
  const reference = params.get('reference');
  const transactionReference = params.get('trxref');
  if (reference && transactionReference && reference.toLowerCase() !== transactionReference.toLowerCase()) {
    return false;
  }
  return true;
}

function isAllowedRoute(route: string): boolean {
  if (ALLOWED_STATIC_PATHS.has(route)) return true;

  const dynamicMatch = /^(events|community\/posts)\/([^/]+)$/.exec(route);
  if (!dynamicMatch) return false;

  try {
    return SAFE_ROUTE_ID.test(decodeURIComponent(dynamicMatch[2]));
  } catch {
    return false;
  }
}

/**
 * Notification payloads are controlled by the server, but they still cross an
 * external boundary before Navigation receives them. Only allow known in-app
 * destinations so a compromised payload cannot open an arbitrary website.
 */
export function safeNotificationUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const candidate = value.trim();
  if (
    candidate.length === 0
    || candidate.length > MAX_DEEP_LINK_LENGTH
    || /[\u0000-\u001F\u007F\s]/.test(candidate)
    || !candidate.startsWith('altaros://')
  ) return null;

  const destination = candidate.slice('altaros://'.length);
  if (destination.includes('#')) return null;
  const queryIndex = destination.indexOf('?');
  const route = (queryIndex === -1 ? destination : destination.slice(0, queryIndex)).replace(/\/+$/, '');
  if (queryIndex !== -1) {
    if (route !== 'giving/complete' || !hasSafePaymentQuery(destination.slice(queryIndex + 1))) return null;
  }
  return isAllowedRoute(route) ? candidate : null;
}

export function notificationUrlFromData(
  data: Record<string, unknown> | undefined,
): string | null {
  return safeNotificationUrl(data?.deepLink ?? data?.url);
}

let deferredUrl: string | null = null;

/** Holds one validated member destination while the auth navigator is active. */
export function rememberDeferredUrl(value: unknown): boolean {
  const safe = safeNotificationUrl(value);
  if (!safe) return false;
  deferredUrl = safe;
  return true;
}

/** Consume once so a later logout/login cannot replay a stale destination. */
export function consumeDeferredUrl(): string | null {
  const value = deferredUrl;
  deferredUrl = null;
  return value;
}

export function clearDeferredUrl(): void {
  deferredUrl = null;
}

/**
 * Native Linking and notification bridges are startup dependencies owned by
 * the operating system. A rejected bridge read must not prevent the member
 * navigator from mounting. Prefer a safe explicit app link, then try the last
 * notification destination, and otherwise let Navigation open its home route.
 */
export async function resolveInitialMemberUrl(
  readLinkUrl: () => Promise<unknown>,
  readNotificationUrl: () => Promise<unknown>,
): Promise<string | null> {
  try {
    const linkUrl = safeNotificationUrl(await readLinkUrl());
    if (linkUrl) return linkUrl;
  } catch {
    // A broken Linking bridge must not suppress a valid notification tap.
  }

  try {
    return safeNotificationUrl(await readNotificationUrl());
  } catch {
    return null;
  }
}

/**
 * Linking.getInitialURL() keeps returning the process launch URL. Reading it
 * again after logout would replay an already-consumed member destination into
 * whichever account signs in next, so every app process gets exactly one read.
 */
export function createInitialUrlGate() {
  let consumed = false;
  let pending: Promise<string | null> | null = null;
  return {
    async take(read: () => Promise<string | null>): Promise<string | null> {
      if (consumed) return null;
      if (!pending) {
        pending = read().finally(() => {
          consumed = true;
          pending = null;
        });
      }
      return pending;
    },
  };
}
