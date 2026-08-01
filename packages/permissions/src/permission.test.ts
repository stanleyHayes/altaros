import { describe, expect, it } from 'vitest';
import { PermissionSet, expand, missingReads, splitPermission } from './permission';

describe('expand', () => {
  // Requirement 6, client side. The server expands too — this exists because a
  // set assembled anywhere else (a role being edited, a test fixture) has not
  // been through that, and a UI that renders an edit form for a record it will
  // not render a view of is incoherent.
  it('adds the read implied by every write', () => {
    expect([...expand(['finance:update'])].sort()).toEqual(['finance:read', 'finance:update']);
  });

  it('leaves a read alone', () => {
    expect([...expand(['member:read'])]).toEqual(['member:read']);
  });

  it('discards anything unrecognised rather than trusting it', () => {
    // Tolerant on read, because stored data outlives code: a permission
    // removed from the platform should stop being granted, not make the whole
    // set undecodable and lock someone out of a working account.
    expect([...expand(['not-a-permission', 'member:fly', 'ghost:read'])]).toEqual([]);
  });
});

describe('splitPermission', () => {
  it('normalises case and whitespace', () => {
    expect(splitPermission('  Finance:READ ')).toEqual({
      resource: 'finance',
      action: 'read',
    });
  });

  it('rejects an unknown resource', () => {
    expect(splitPermission('payroll:read')).toBeNull();
  });

  it('rejects an unknown action', () => {
    expect(splitPermission('finance:approve')).toBeNull();
  });
});

describe('missingReads', () => {
  it('names what to add rather than just refusing', () => {
    expect(missingReads(['finance:update', 'member:delete', 'event:read'])).toEqual([
      'finance:read',
      'member:read',
    ]);
  });

  it('is empty for a valid set', () => {
    expect(missingReads(['finance:read', 'finance:update'])).toEqual([]);
  });
});

describe('PermissionSet', () => {
  const staff = new PermissionSet(['member:read', 'member:update', 'event:read', 'finance:read']);

  it('answers can()', () => {
    expect(staff.can('member', 'update')).toBe(true);
    expect(staff.can('member', 'delete')).toBe(false);
    expect(staff.can('settings', 'read')).toBe(false);
  });

  // The default is `every`, not `some`. An action needing two permissions and
  // checked with `some` renders a button that 403s on click.
  it('hasAll requires every listed permission', () => {
    expect(staff.hasAll(['member:update', 'event:read'])).toBe(true);
    expect(staff.hasAll(['member:update', 'finance:update'])).toBe(false);
  });

  it('hasAny requires only one', () => {
    expect(staff.hasAny(['finance:delete', 'member:read'])).toBe(true);
    expect(staff.hasAny(['finance:delete', 'settings:update'])).toBe(false);
  });

  // The empty set must deny everything. It is what the UI holds before
  // permissions load and after a failure, so a bug that made it permissive
  // would show every control on exactly the paths where nothing is known.
  it('an empty set permits nothing', () => {
    const none = new PermissionSet();
    expect(none.can('member', 'read')).toBe(false);
    expect(none.hasAll([])).toBe(true); // vacuously — no requirement to fail
    expect(none.hasAny([])).toBe(false);
    expect(none.size).toBe(0);
  });

  it('ignores an unrecognised permission rather than granting it', () => {
    const set = new PermissionSet(['member:*', '*:*', 'admin']);
    expect(set.size).toBe(0);
    expect(set.has('member:read')).toBe(false);
  });

  it('lists sorted, so a rendered permission matrix is stable', () => {
    expect(new PermissionSet(['member:read', 'event:read']).list()).toEqual([
      'event:read',
      'member:read',
    ]);
  });
});
