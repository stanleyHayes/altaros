/**
 * Requirement 7's client half (WP-38).
 *
 * "If a user does not have a read permission, the route or item should not
 * even be rendered at all. Same applies to update, delete or create
 * permissions. The buttons needed to delete, create or update should not be
 * present."
 *
 * This package implements exactly that, and nothing more. It decides what to
 * SHOW; the gateway decides what to ALLOW (§12.5). Every route and action
 * hidden here is independently enforced server-side by `requirePermission`,
 * because the client is under the user's control and a route protected only in
 * the UI is an open route.
 */

export {
  ACTIONS,
  RESOURCES,
  NO_PERMISSIONS,
  PermissionSet,
  expand,
  isWrite,
  missingReads,
  permission,
  splitPermission,
  type Action,
  type Permission,
  type Resource,
} from './permission';

export {
  PermissionsProvider,
  useCan,
  usePermissions,
  type FetchPermissions,
  type PermissionsProviderProps,
  type PermissionsValue,
} from './PermissionsProvider';

export { Can, Cannot, type CanProps, type CannotProps } from './Can';

export { RequirePermission, type RequirePermissionProps } from './RequirePermission';

export { firstVisiblePath, visibleNav, type NavRequirement } from './navigation';
