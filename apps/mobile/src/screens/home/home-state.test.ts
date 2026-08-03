import { homeContentBelongsToIdentity, homeSectionRecoveryAction } from './home-state';

describe('member home ownership', () => {
  it('renders aggregated content only for its exact loaded member and church', () => {
    const active = { churchId: 'church-1', memberId: 'member-1' };
    expect(homeContentBelongsToIdentity(active, active)).toBe(true);
    expect(homeContentBelongsToIdentity(null, active)).toBe(false);
    expect(homeContentBelongsToIdentity(
      { churchId: 'church-2', memberId: 'member-1' }, active,
    )).toBe(false);
    expect(homeContentBelongsToIdentity(
      { churchId: 'church-1', memberId: 'member-2' }, active,
    )).toBe(false);
    expect(homeContentBelongsToIdentity(active, {})).toBe(false);
  });
});

describe('member home section recovery', () => {
  it('offers one honest retry state across online, busy, and offline recovery', () => {
    expect(homeSectionRecoveryAction(false, false)).toEqual({
      label: 'Try again',
      hint: 'Refreshes events, today’s devotional, and recent sermons.',
      disabled: false,
      busy: false,
    });
    expect(homeSectionRecoveryAction(false, true)).toEqual({
      label: 'Refreshing…',
      hint: 'Your member home is being refreshed.',
      disabled: true,
      busy: true,
    });
    expect(homeSectionRecoveryAction(true, true)).toEqual({
      label: 'Reconnect to retry',
      hint: 'Reconnect to refresh this section of your member home.',
      disabled: true,
      busy: false,
    });
  });
});
