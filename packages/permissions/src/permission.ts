/**
 * The permission vocabulary, mirroring internal/domain/rbac/permission.go.
 *
 * This file is a deliberate duplicate of server logic, and the duplication is
 * the point worth being explicit about: the client needs `expand` to decide
 * what to render, and a round trip per button is not viable. What it must
 * never become is the *authority*. Every route and action this file hides is
 * also enforced at the gateway (see §12.5) — hiding a button is not
 * authorisation, because the client is under the user's control.
 *
 * The catalogue is fetched from `GET /permissions` where a UI needs to list
 * everything, so a permission added on the server appears without a release
 * here. These constants exist for the handful of checks written in code.
 */

/** What may be done to a resource. */
export const ACTIONS = ['read', 'create', 'update', 'delete'] as const;
export type Action = (typeof ACTIONS)[number];

/** A thing permissions are granted over. */
export const RESOURCES = [
  'church',
  'communication',
  'event',
  'finance',
  'member',
  'prayer',
  'report',
  'role',
  'settings',
  'user',
  'welfare',
] as const;
export type Resource = (typeof RESOURCES)[number];

/** One `resource:action` pair. */
export type Permission = `${Resource}:${Action}`;

/** Builds a permission string. */
export function permission(resource: Resource, action: Action): Permission {
  return `${resource}:${action}`;
}

/** Splits a permission, or returns null when it is not one. */
export function splitPermission(value: string): { resource: Resource; action: Action } | null {
  const [resource, action] = value.toLowerCase().trim().split(':');
  if (!resource || !action) return null;
  if (!(RESOURCES as readonly string[]).includes(resource)) return null;
  if (!(ACTIONS as readonly string[]).includes(action)) return null;
  return { resource: resource as Resource, action: action as Action };
}

/** Whether an action modifies anything. */
export function isWrite(action: Action): boolean {
  return action !== 'read';
}

/**
 * Adds the read implied by every write, matching rbac.Expand.
 *
 * The server already expands before returning, so this is normally a no-op on
 * a fetched set. It runs anyway because the alternative is a UI that renders
 * an edit form for a record it will not render a view of — and a set assembled
 * anywhere other than `/me/permissions` (a test fixture, a preview of a role
 * being edited) has not been through the server's expansion.
 */
export function expand(permissions: Iterable<string>): Set<Permission> {
  const out = new Set<Permission>();
  for (const raw of permissions) {
    const parsed = splitPermission(raw);
    if (!parsed) continue;
    out.add(permission(parsed.resource, parsed.action));
    if (isWrite(parsed.action)) {
      out.add(permission(parsed.resource, 'read'));
    }
  }
  return out;
}

/**
 * Lists the reads a set is missing for its writes, matching rbac.Validate.
 *
 * For the role editor: it names what to add rather than refusing a save with
 * "invalid permissions".
 */
export function missingReads(permissions: Iterable<string>): Permission[] {
  const held = new Set<string>();
  const wanted = new Set<Permission>();

  for (const raw of permissions) {
    const parsed = splitPermission(raw);
    if (!parsed) continue;
    held.add(permission(parsed.resource, parsed.action));
    if (isWrite(parsed.action)) {
      wanted.add(permission(parsed.resource, 'read'));
    }
  }

  return [...wanted].filter((read) => !held.has(read)).sort();
}

/** A resolved, expanded permission set with the checks a UI needs. */
export class PermissionSet {
  private readonly held: Set<Permission>;

  constructor(permissions: Iterable<string> = []) {
    this.held = expand(permissions);
  }

  /** Whether the caller may perform an action on a resource. */
  can(resource: Resource, action: Action): boolean {
    return this.held.has(permission(resource, action));
  }

  /** Whether the caller holds a permission written as `resource:action`. */
  has(value: string): boolean {
    const parsed = splitPermission(value);
    return parsed ? this.can(parsed.resource, parsed.action) : false;
  }

  /**
   * Whether the caller holds EVERY listed permission.
   *
   * `every` rather than `some` is the default a `<Can do={[...]}>` uses,
   * because the common case is an action needing two permissions at once —
   * "move this member to another department" is `member:update` and
   * `church:read` — and getting that wrong renders a button that 403s.
   */
  hasAll(values: readonly string[]): boolean {
    return values.every((value) => this.has(value));
  }

  /** Whether the caller holds at least one of the listed permissions. */
  hasAny(values: readonly string[]): boolean {
    return values.some((value) => this.has(value));
  }

  /** Whether the caller may see a resource at all. */
  canRead(resource: Resource): boolean {
    return this.can(resource, 'read');
  }

  /** The permissions, sorted, for display and tests. */
  list(): Permission[] {
    return [...this.held].sort();
  }

  get size(): number {
    return this.held.size;
  }
}

/**
 * The empty set, used before permissions have loaded and after a failure.
 *
 * Shared rather than constructed per call so identity comparisons in React
 * memo dependencies do not see a new object every render.
 */
export const NO_PERMISSIONS = new PermissionSet();
