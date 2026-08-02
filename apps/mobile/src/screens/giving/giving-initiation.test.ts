import { canContinueGivingCheckout, givingAttemptBelongsToIdentity } from './GivingScreen';
import { givingHistoryBelongsToIdentity } from './GivingHistoryScreen';

describe('giving initiation lifecycle', () => {
  it('continues checkout only for the initiating online member and church', () => {
    const active = { churchId: 'church-1', memberId: 'member-1' };
    expect(canContinueGivingCheckout(active, 'church-1', 'member-1', false)).toBe(true);
    expect(canContinueGivingCheckout(active, 'church-2', 'member-1', false)).toBe(false);
    expect(canContinueGivingCheckout(active, 'church-1', 'member-2', false)).toBe(false);
    expect(canContinueGivingCheckout(active, 'church-1', 'member-1', true)).toBe(false);
    expect(canContinueGivingCheckout({}, 'church-1', 'member-1', false)).toBe(false);
  });

  it('accepts dialog and finalizer updates only for the mounted initiating identity', () => {
    const active = { churchId: 'church-1', memberId: 'member-1' };
    expect(givingAttemptBelongsToIdentity(active, 'church-1', 'member-1', true)).toBe(true);
    expect(givingAttemptBelongsToIdentity(active, 'church-1', 'member-1', false)).toBe(false);
    expect(givingAttemptBelongsToIdentity(active, 'church-2', 'member-1', true)).toBe(false);
    expect(givingAttemptBelongsToIdentity(active, 'church-1', 'member-2', true)).toBe(false);
  });

  it('renders private giving history only for its exact loaded owner', () => {
    const active = { churchId: 'church-1', memberId: 'member-1' };
    expect(givingHistoryBelongsToIdentity(active, active)).toBe(true);
    expect(givingHistoryBelongsToIdentity(null, active)).toBe(false);
    expect(givingHistoryBelongsToIdentity(
      { churchId: 'church-2', memberId: 'member-1' }, active,
    )).toBe(false);
    expect(givingHistoryBelongsToIdentity(
      { churchId: 'church-1', memberId: 'member-2' }, active,
    )).toBe(false);
    expect(givingHistoryBelongsToIdentity(active, {})).toBe(false);
  });
});
