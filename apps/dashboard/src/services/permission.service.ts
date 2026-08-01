import { get } from './api';

/** What `GET /me/permissions` returns. */
interface MyPermissions {
  userId: string;
  churchId: string;
  permissions: string[];
}

/** One entry from `GET /roles/assignable`. */
export interface AssignableRole {
  id: string;
  name: string;
  slug: string;
  description?: string;
  permissions: string[];
  system: boolean;
  assignable: boolean;
  /** Which of the role's permissions the caller lacks. Empty when assignable. */
  missingPermissions?: string[];
}

interface AssignableRoles {
  roles: AssignableRole[];
  rule: string;
}

/** One resource and the actions defined on it, from `GET /permissions`. */
export interface PermissionCatalogueEntry {
  resource: string;
  actions: string[];
}

interface PermissionCatalogue {
  resources: PermissionCatalogueEntry[];
  rule: string;
}

/**
 * Fetches the signed-in user's own effective permissions.
 *
 * Deliberately about the caller only — there is no "permissions for user X"
 * here, because that would let anyone who can call it map the church's
 * administrative structure.
 *
 * The signal comes from the provider so a sign-out or an account switch
 * abandons an in-flight request rather than letting it land on the next
 * session.
 */
export async function fetchMyPermissions(signal: AbortSignal): Promise<string[]> {
  const result = await get<MyPermissions>('/me/permissions', { signal });
  return result.permissions ?? [];
}

/**
 * Roles the caller may actually assign, and what is missing from the rest.
 *
 * The invite form populates its role picker from this rather than from
 * `GET /roles`. The escalation rule is a strict subset — you may only assign a
 * role whose permissions you hold entirely — so offering the full list means
 * offering options that will be refused, which reads as a broken form.
 */
export async function fetchAssignableRoles(): Promise<AssignableRoles> {
  return get<AssignableRoles>('/roles/assignable');
}

/**
 * Every permission the platform defines, for a role editor's matrix.
 *
 * Fetched rather than hard-coded so a permission added on the server appears
 * without a frontend release — a client-side copy of this list drifts, and the
 * drift shows up as a role nobody can grant.
 */
export async function fetchPermissionCatalogue(): Promise<PermissionCatalogue> {
  return get<PermissionCatalogue>('/permissions');
}
