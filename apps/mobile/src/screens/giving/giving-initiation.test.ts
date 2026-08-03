import {
  canContinueGivingCheckout,
  givingAttemptBelongsToIdentity,
  givingInitiationErrorMessage,
  givingOptionsRetryAccessibility,
  givingPrimaryActionState,
  givingPurposeAccessibility,
} from './GivingScreen';
import { givingHistoryBelongsToIdentity, givingHistoryRetryAccessibility } from './GivingHistoryScreen';
import { AxiosError, AxiosHeaders } from 'axios';

describe('giving initiation lifecycle', () => {
  it('exposes only quote-ready gifts and names the actual next step', () => {
    expect(givingPrimaryActionState('', false, false, true)).toEqual({
      label: 'Enter an amount over GHS 0.00',
      disabled: true,
      hint: 'Enter a positive amount using no more than 2 decimal places.',
    });
    expect(givingPrimaryActionState('0.00', false, false, true).disabled).toBe(true);
    expect(givingPrimaryActionState('00010.5', false, false, true)).toEqual({
      label: 'Review GHS 10.50',
      disabled: false,
      hint: 'Shows the payment fee, levy and total debit before checkout.',
    });
    expect(givingPrimaryActionState('20', true, false, true).label)
      .toBe('Reconnect to review your gift');
    expect(givingPrimaryActionState('20', false, false, false).label)
      .toBe('Sign in again to give');
    expect(givingPrimaryActionState('20', false, true, true).label)
      .toBe('Preparing your secure review…');
  });

  it('announces exclusive purpose selection and honest offline option recovery', () => {
    expect(givingPurposeAccessibility(true)).toEqual({ selected: true, checked: true });
    expect(givingPurposeAccessibility(false)).toEqual({ selected: false, checked: false });
    expect(givingOptionsRetryAccessibility(false)).toEqual({
      disabled: false, label: 'Try again', hint: 'Reloads your active campaigns and pledges.',
    });
    expect(givingOptionsRetryAccessibility(true)).toEqual({
      disabled: true,
      label: 'Reconnect to retry',
      hint: 'Reconnect to reload campaigns and pledges.',
    });
  });

  it('does not present an actionable giving-history retry while offline', () => {
    expect(givingHistoryRetryAccessibility(false)).toEqual({
      disabled: false, label: 'Try again', hint: 'Refreshes your giving history.',
    });
    expect(givingHistoryRetryAccessibility(true)).toEqual({
      disabled: true,
      label: 'Reconnect to retry',
      hint: 'Reconnect to refresh your giving history.',
    });
  });

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

  it('never describes a created pending checkout as though payment did not start', () => {
    expect(givingInitiationErrorMessage(true, new Error('cannot open URL'))).toBe(
      'A pending checkout was created, but the payment page could not be opened. Check giving history before trying again so you do not start a second payment.',
    );
    expect(givingInitiationErrorMessage(true, new Error('provider detail'))).not.toContain(
      'provider detail',
    );
    expect(givingInitiationErrorMessage(false, new Error('Provider is unavailable'))).toBe(
      'Provider is unavailable',
    );
  });

  it('treats a response-less checkout request as outcome-unknown', () => {
    const timeout = new AxiosError('timeout', 'ECONNABORTED');
    expect(givingInitiationErrorMessage(false, timeout)).toBe(
      'We could not confirm whether a checkout was created. Check giving history before trying again so you do not start a second payment.',
    );

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
        data: { error: 'The quote expired.' },
      },
    );
    expect(givingInitiationErrorMessage(false, rejected)).toBe('The quote expired.');
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
