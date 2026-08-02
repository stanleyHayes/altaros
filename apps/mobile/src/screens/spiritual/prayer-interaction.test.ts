import {
  ownsPrayerMutationContext,
  prayerMutationCompletionBelongsToContext,
} from './PrayerScreen';

describe('prayer mutation ownership', () => {
  it('accepts a completion only for the initiating church and member', () => {
    expect(ownsPrayerMutationContext(
      { churchId: 'church-1', memberId: 'member-1' }, 'church-1', 'member-1',
    )).toBe(true);
    expect(ownsPrayerMutationContext(
      { churchId: 'church-2', memberId: 'member-1' }, 'church-1', 'member-1',
    )).toBe(false);
    expect(ownsPrayerMutationContext(
      { churchId: 'church-1', memberId: 'member-2' }, 'church-1', 'member-1',
    )).toBe(false);
    expect(ownsPrayerMutationContext(
      {}, 'church-1', 'member-1',
    )).toBe(false);
  });

  it('accepts finalizers only while the initiating prayer identity remains mounted', () => {
    const active = { churchId: 'church-1', memberId: 'member-1' };
    expect(prayerMutationCompletionBelongsToContext(
      true, active, 'church-1', 'member-1',
    )).toBe(true);
    expect(prayerMutationCompletionBelongsToContext(
      false, active, 'church-1', 'member-1',
    )).toBe(false);
    expect(prayerMutationCompletionBelongsToContext(
      true, { ...active, churchId: 'church-2' }, 'church-1', 'member-1',
    )).toBe(false);
  });
});
