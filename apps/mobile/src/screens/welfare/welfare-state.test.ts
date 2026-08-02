import {
  createEmergencyConfirmationGate,
  expireEmergencyConfirmation,
  welfareMutationCompletionBelongsToIdentity,
  welfareStateBelongsToIdentity,
} from './welfare-state';

describe('private welfare screen ownership', () => {
  it('renders case history and draft state only for their exact owner', () => {
    const active = { churchId: 'church-1', memberId: 'member-1' };
    expect(welfareStateBelongsToIdentity(active, active)).toBe(true);
    expect(welfareStateBelongsToIdentity(null, active)).toBe(false);
    expect(welfareStateBelongsToIdentity(
      { churchId: 'church-2', memberId: 'member-1' }, active,
    )).toBe(false);
    expect(welfareStateBelongsToIdentity(
      { churchId: 'church-1', memberId: 'member-2' }, active,
    )).toBe(false);
    expect(welfareStateBelongsToIdentity(active, {})).toBe(false);
  });

  it('accepts private mutation completion only for the mounted initiating identity', () => {
    const active = { churchId: 'church-1', memberId: 'member-1' };
    expect(welfareMutationCompletionBelongsToIdentity(
      true, active, 'church-1', 'member-1',
    )).toBe(true);
    expect(welfareMutationCompletionBelongsToIdentity(
      false, active, 'church-1', 'member-1',
    )).toBe(false);
    expect(welfareMutationCompletionBelongsToIdentity(
      true, { ...active, memberId: 'member-2' }, 'church-1', 'member-1',
    )).toBe(false);
  });

  it('consumes an emergency confirmation exactly once', () => {
    const gate = createEmergencyConfirmationGate();
    const token = gate.begin();
    expect(gate.isActive()).toBe(true);
    expect(gate.consume(token)).toBe(true);
    expect(gate.isActive()).toBe(false);
    expect(gate.consume(token)).toBe(false);
    expect(gate.cancel(token)).toBe(false);
  });

  it('expires a visible confirmation when the app backgrounds or identity changes', () => {
    const gate = createEmergencyConfirmationGate();
    const staleToken = gate.begin();
    gate.invalidate();
    expect(gate.isActive()).toBe(false);
    expect(gate.consume(staleToken)).toBe(false);

    const currentToken = gate.begin();
    expect(currentToken).not.toBe(staleToken);
    expect(gate.cancel(currentToken)).toBe(true);
    expect(gate.cancel(currentToken)).toBe(false);
  });

  it('releases only a pending confirmation, never an emergency already in flight', () => {
    const gate = createEmergencyConfirmationGate();
    const release = jest.fn();
    const token = gate.begin();
    expect(expireEmergencyConfirmation(gate, release)).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
    expect(gate.consume(token)).toBe(false);

    const confirmedToken = gate.begin();
    expect(gate.consume(confirmedToken)).toBe(true);
    expect(expireEmergencyConfirmation(gate, release)).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
