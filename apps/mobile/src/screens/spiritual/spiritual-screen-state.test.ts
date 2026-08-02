import { spiritualContentBelongsToIdentity } from './spiritual-screen-state';

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
