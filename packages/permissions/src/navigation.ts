import type { PermissionSet } from './permission';

/**
 * A navigation entry that knows what it requires.
 *
 * The requirement lives on the item rather than in a `<Can>` wrapped around
 * each rendered row, because navigation is data: it gets counted, searched,
 * used to pick a landing route, and rendered in a command palette. Any of
 * those built from an unfiltered list leaks the same information the hidden
 * row was hiding — a command palette that finds "Finance" for someone whose
 * sidebar does not show it is the whole disclosure back again.
 */
export interface NavRequirement {
  /** Permissions required to see this entry. All must be held. */
  requires?: readonly string[];
}

/**
 * Filters navigation to what the caller may see.
 *
 * An entry with no `requires` is always visible — that is the correct default
 * for a dashboard or a profile, and it means adding a nav item does not
 * silently hide it from everyone until someone remembers to grant something.
 * The trade is that forgetting `requires` on a sensitive entry shows it too
 * widely, which is why the route behind it is guarded independently.
 */
export function visibleNav<T extends NavRequirement>(
  items: readonly T[],
  permissions: PermissionSet,
): T[] {
  return items.filter((item) => !item.requires?.length || permissions.hasAll(item.requires));
}

/**
 * The first route the caller may actually open.
 *
 * Needed because "/" redirecting to a fixed landing page sends someone without
 * that permission straight to the not-found screen on sign-in, which reads as
 * a broken account rather than as a narrow one.
 */
export function firstVisiblePath<T extends NavRequirement & { path: string }>(
  items: readonly T[],
  permissions: PermissionSet,
  fallback: string,
): string {
  return visibleNav(items, permissions)[0]?.path ?? fallback;
}
