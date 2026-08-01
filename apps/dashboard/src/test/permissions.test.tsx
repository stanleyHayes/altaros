import { describe, expect, it } from 'vitest';
import { PermissionSet, visibleNav } from '@altar-os/permissions';
import { NAV_ITEMS, SIDEBAR_ITEMS, requirementFor } from '@/navigation';

/**
 * Requirement 7, asserted against the REAL navigation list.
 *
 * The rendering behaviour — <Can> producing no element, RequirePermission
 * showing the not-found page — is covered in @altar-os/permissions' own suite,
 * where it is tested against the components directly. What can only be tested
 * HERE is that this app's actual navigation declares the right requirements,
 * because that list is what the sidebar and the router both read. A copy of it
 * in a fixture would pass forever while the real sidebar showed Finance to
 * everyone.
 *
 * These are deliberately not render tests. This app's vitest setup resolves
 * `react` from apps/dashboard and `react-dom` from the workspace root — two
 * different 19.x builds — so any component using a hook fails with "Cannot
 * read properties of null (reading 'useState')". That predates this work and
 * went unnoticed because the app's only other test renders a hook-free
 * component. Fixing it means unifying the workspace React, which is a change
 * to the mobile app's pinned version and belongs in its own work package.
 */

const ADMIN = [
  'church:read',
  'communication:read',
  'event:read',
  'finance:read',
  'finance:delete',
  'member:read',
  'report:read',
  'settings:read',
  'user:read',
  'user:create',
];

/** What the seeded Member role actually holds. */
const MEMBER = ['church:read', 'communication:read', 'event:read', 'member:read'];

describe('navigation is filtered by permission', () => {
  it('a Member-role session gets no Finance entry', () => {
    const labels = visibleNav(SIDEBAR_ITEMS, new PermissionSet(MEMBER)).map((i) => i.label);

    expect(labels).not.toContain('Finance');
    expect(labels).not.toContain('People & Roles');
    // And still sees what they legitimately hold — otherwise this would pass
    // for a filter that simply hides everything.
    expect(labels).toContain('Members');
    expect(labels).toContain('Events');
  });

  it('an administrator gets the whole sidebar', () => {
    const visible = visibleNav(SIDEBAR_ITEMS, new PermissionSet(ADMIN));
    expect(visible.map((i) => i.label)).toContain('Finance');
    expect(visible).toHaveLength(SIDEBAR_ITEMS.length);
  });

  it('an empty set leaves only what requires nothing', () => {
    // What the sidebar shows on a resolution failure. It must not be the full
    // list, and it must not throw.
    const labels = visibleNav(SIDEBAR_ITEMS, new PermissionSet([])).map((i) => i.label);
    expect(labels).toEqual(['Dashboard']);
  });

  // The list is the contract between the sidebar and the router. An entry with
  // no declared requirement is reachable by anyone, which is right for the
  // landing page and wrong for anything holding church data.
  it('every entry except the dashboard declares what it requires', () => {
    const unguarded = NAV_ITEMS.filter((item) => !item.requires?.length).map((i) => i.path);
    expect(unguarded).toEqual(['/dashboard']);
  });

  // The router asks for a path's requirement by string. A typo there fails
  // open — no requirement found means the route renders for everyone — so the
  // paths the router guards must all resolve.
  it('every navigable path resolves to its requirement', () => {
    for (const item of NAV_ITEMS) {
      if (!item.requires?.length) continue;
      expect(requirementFor(item.path), `no requirement found for ${item.path}`).toEqual(
        item.requires,
      );
    }
  });

  it('the sensitive sections require the permission that names them', () => {
    // Spelled out rather than derived, so a change to any of these is a
    // deliberate edit to this test rather than a silent pass.
    expect(requirementFor('/finance')).toEqual(['finance:read']);
    expect(requirementFor('/members')).toEqual(['member:read']);
    expect(requirementFor('/people')).toEqual(['user:read']);
    expect(requirementFor('/settings')).toEqual(['settings:read']);
  });
});
