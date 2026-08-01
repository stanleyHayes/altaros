import type { ReactNode } from 'react';
import { usePermissions } from './PermissionsProvider';

export interface CanProps {
  /**
   * The permission(s) required, as `resource:action`. All of them must be
   * held — see PermissionSet.hasAll for why `every` is the default.
   */
  do: string | readonly string[];
  children: ReactNode;
  /**
   * What to render while permissions resolve.
   *
   * Defaults to nothing. That is the right default for an ACTION — a Delete
   * button that appears and then vanishes is worse than one that appears a
   * moment late, because someone may have clicked it. Pass a skeleton when the
   * gate wraps a region whose shape is known and whose absence would collapse
   * the layout.
   */
  loading?: ReactNode;
  /**
   * What to render when the permission is absent. Defaults to nothing.
   *
   * Resist passing a "you do not have access" message for a button. Requirement
   * 7 asks for the control to be ABSENT, and a disabled button or an
   * explanatory note still tells someone the action exists and that they are
   * not trusted with it — which is information about the church's structure
   * that they were not given.
   */
  fallback?: ReactNode;
}

/**
 * Renders its children only if the caller holds the permission.
 *
 * Requirement 7's client half, and worth being precise about what it is for:
 * this decides what to SHOW. The gateway decides what to ALLOW. A route or an
 * action protected only by this component is an open route — the client is
 * under the user's control, so "the button was not rendered" is a UX property,
 * never a security boundary.
 */
export function Can({ do: required, children, loading, fallback }: CanProps) {
  const { permissions, isLoading } = usePermissions();

  if (isLoading) return <>{loading ?? null}</>;

  const list = typeof required === 'string' ? [required] : required;
  return permissions.hasAll(list) ? <>{children}</> : <>{fallback ?? null}</>;
}

export interface CannotProps {
  do: string | readonly string[];
  children: ReactNode;
}

/**
 * The inverse, for the empty states that only make sense to someone who
 * cannot act — "ask an administrator to add members" belongs in front of
 * someone without `member:create`, and would be noise for someone with it.
 */
export function Cannot({ do: required, children }: CannotProps) {
  const { permissions, isLoading } = usePermissions();
  if (isLoading) return null;

  const list = typeof required === 'string' ? [required] : required;
  return permissions.hasAll(list) ? null : <>{children}</>;
}
