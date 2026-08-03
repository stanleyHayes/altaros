import {
  createEmergencyConfirmationGate,
  expireEmergencyConfirmation,
  welfareMutationCompletionBelongsToIdentity,
  welfareMutationFailureAlert,
  welfareChoiceAccessibility,
  welfareFormActionState,
  welfareRefreshOwnsReconciliation,
  welfareRequestActionState,
  welfareStateBelongsToIdentity,
  welfareUnknownOutcomeCopy,
} from './welfare-state';
import { AxiosError, AxiosHeaders } from 'axios';

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

  it('uses outcome-unknown copy that prevents blind duplicate welfare mutations', () => {
    expect(welfareUnknownOutcomeCopy('request')).toEqual({
      title: 'Request status unknown',
      message: expect.stringMatching(/Refresh your care history before submitting it again/),
    });
    expect(welfareUnknownOutcomeCopy('emergency')).toEqual({
      title: 'Alert status unknown',
      message: expect.stringMatching(/Avoid sending it repeatedly/),
    });
    expect(welfareUnknownOutcomeCopy('emergency').message).toContain('emergency services');

    const timeout = new AxiosError('timeout', 'ECONNABORTED');
    expect(welfareMutationFailureAlert('request', timeout)).toMatchObject({
      outcomeUnknown: true, title: 'Request status unknown',
    });
    expect(welfareMutationFailureAlert('emergency', timeout)).toMatchObject({
      outcomeUnknown: true, title: 'Alert status unknown',
    });

    const rejected = new AxiosError(
      'bad request',
      'ERR_BAD_REQUEST',
      { headers: new AxiosHeaders() },
      undefined,
      {
        status: 400,
        statusText: 'Bad Request',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { error: 'Please add more detail.' },
      },
    );
    expect(welfareMutationFailureAlert('request', rejected)).toEqual({
      outcomeUnknown: false,
      title: 'Request not sent',
      message: 'Please add more detail.',
    });
    expect(welfareMutationFailureAlert('emergency', rejected).title).toBe('Alert not sent');
  });
});

describe('private welfare form transaction state', () => {
  it('keeps one mutation lane and exposes choices as disabled radios while it is busy', () => {
    expect(welfareFormActionState(false, false, false)).toEqual({
      controlsDisabled: false,
      requestDisabled: false,
      emergencyDisabled: false,
    });
    expect(welfareFormActionState(false, true, false)).toEqual({
      controlsDisabled: true,
      requestDisabled: true,
      emergencyDisabled: true,
    });
    expect(welfareFormActionState(true, false, false)).toEqual({
      controlsDisabled: false,
      requestDisabled: true,
      emergencyDisabled: true,
    });
    expect(welfareChoiceAccessibility(true, true)).toEqual({
      selected: true,
      checked: true,
      disabled: true,
    });
  });

  it('turns an unknown result into an explicit refresh-only recovery state', () => {
    expect(welfareFormActionState(false, false, false, true)).toEqual({
      controlsDisabled: true,
      requestDisabled: false,
      emergencyDisabled: true,
    });
    expect(welfareRequestActionState(false, false, true)).toEqual({
      mode: 'refresh',
      label: 'Refresh care history',
      disabled: false,
      hint: 'Refreshes your private care history before another request can be submitted.',
    });
    expect(welfareRequestActionState(true, false, true)).toMatchObject({
      mode: 'refresh', disabled: true, label: 'Reconnect to confirm request',
    });
  });

  it('allows only a refresh started after the latest uncertain mutation to reconcile it', () => {
    expect(welfareRefreshOwnsReconciliation(4, 4)).toBe(true);
    expect(welfareRefreshOwnsReconciliation(3, 4)).toBe(false);
  });
});
