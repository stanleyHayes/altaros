import { navigationIdentityForUser, navigationSessionKey } from './navigation-session';

describe('root navigation session ownership', () => {
  it('keeps one stable auth navigator while signed out', () => {
    expect(navigationSessionKey(false, {})).toBe('auth-navigation');
    expect(navigationSessionKey(false, { churchId: 'church-1', memberId: 'member-1' }))
      .toBe('auth-navigation');
  });

  it('replaces private route history for member or church changes', () => {
    const first = navigationSessionKey(true, { churchId: 'church-1', memberId: 'member-1' });
    expect(navigationSessionKey(true, { churchId: 'church-1', memberId: 'member-1' })).toBe(first);
    expect(navigationSessionKey(true, { churchId: 'church-1', memberId: 'member-2' })).not.toBe(first);
    expect(navigationSessionKey(true, { churchId: 'church-2', memberId: 'member-1' })).not.toBe(first);
  });

  it('does not allow ambiguous identity pairs to share a navigator key', () => {
    expect(navigationSessionKey(true, { churchId: 'ab', memberId: 'c' }))
      .not.toBe(navigationSessionKey(true, { churchId: 'a', memberId: 'bc' }));
    expect(navigationSessionKey(true, { churchId: '', memberId: 'member-1' }))
      .toBe('member-navigation-incomplete');
  });

  it('binds private navigation to the roster member identity, not the login account id', () => {
    const user = { id: 'account-1', churchId: 'church-1', memberId: 'member-1' };
    expect(navigationIdentityForUser(user)).toEqual({ churchId: 'church-1', memberId: 'member-1' });
  });
});
