import type { ReactNode } from 'react';
import { usePermissions } from './PermissionsProvider';

export interface RequirePermissionProps {
  /** The permission(s) the route needs. All must be held. */
  do: string | readonly string[];
  children: ReactNode;
  /**
   * Rendered when the caller lacks the permission.
   *
   * This should be the app's NOT-FOUND page, not a "forbidden" page, and the
   * distinction is the same one the server makes: a 403 confirms the resource
   * exists. "You may not see this church's giving" and "this church has giving
   * you may not see" are different disclosures, and only the second is a leak.
   * Requirement 7 says the route should not render at all — a not-found page
   * is what "does not exist" looks like.
   */
  notFound: ReactNode;
  /**
   * Rendered while permissions resolve. Should be a skeleton of the page, not
   * a spinner: the route's shape is known before its data is.
   */
  loading?: ReactNode;
}

/**
 * A route guard that hides a whole page.
 *
 * Wraps a route element. The API is still enforcing the same permission — this
 * exists so someone who pastes a URL gets the not-found page instead of a
 * screen that renders and then fills with failed requests.
 */
export function RequirePermission({
  do: required,
  children,
  notFound,
  loading,
}: RequirePermissionProps) {
  const { permissions, isLoading } = usePermissions();

  if (isLoading) return <>{loading ?? null}</>;

  const list = typeof required === 'string' ? [required] : required;
  return permissions.hasAll(list) ? <>{children}</> : <>{notFound}</>;
}
