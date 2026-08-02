import { homeContentBelongsToIdentity } from './home-state';

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
