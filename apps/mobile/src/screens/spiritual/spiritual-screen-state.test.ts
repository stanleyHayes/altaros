import { spiritualContentBelongsToIdentity, spiritualPartialRecoveryAction } from './spiritual-screen-state';

describe('spiritual screen ownership', () => {
  it('renders church content only for its exact active member context', () => {
    const active = { churchId: 'church-1', memberId: 'member-1' };
    expect(spiritualContentBelongsToIdentity(active, active)).toBe(true);
    expect(spiritualContentBelongsToIdentity(null, active)).toBe(false);
    expect(spiritualContentBelongsToIdentity(
      { churchId: 'church-2', memberId: 'member-1' }, active,
    )).toBe(false);
    expect(spiritualContentBelongsToIdentity(
      { churchId: 'church-1', memberId: 'member-2' }, active,
    )).toBe(false);
    expect(spiritualContentBelongsToIdentity(active, {})).toBe(false);
  });
});

describe('spiritual partial-list recovery', () => {
  it('describes the authoritative refresh instead of promising a page retry', () => {
    expect(spiritualPartialRecoveryAction(false)).toEqual({
      label: 'Refresh to continue',
      hint: 'Refreshes the sermon library from its newest page.',
      disabled: false,
    });
    expect(spiritualPartialRecoveryAction(true)).toEqual({
      label: 'Reconnect to refresh',
      hint: 'Reconnect to refresh the sermon library before continuing.',
      disabled: true,
    });
  });
});
