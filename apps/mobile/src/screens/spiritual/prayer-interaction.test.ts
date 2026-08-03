import {
  ownsPrayerMutationContext,
  prayerMutationFailureAlert,
  prayerMutationCompletionBelongsToContext,
  prayerRequestActionState,
  prayActionState,
  prayerRefreshOwnsReconciliation,
} from './PrayerScreen';
import { AxiosError, AxiosHeaders } from 'axios';

describe('prayer mutation ownership', () => {
  it('turns uncertain request and prayer outcomes into authoritative refresh actions', () => {
    expect(prayerRequestActionState('Healing', 'Please pray', false, false, true, true)).toEqual({
      mode: 'refresh',
      label: 'Refresh prayer wall to continue',
      disabled: false,
      hint: 'Refreshes the prayer wall before another request can be submitted.',
    });
    expect(prayerRequestActionState('', '', false, false, false, true).label)
      .toBe('Complete title and description');
    expect(prayerRequestActionState('Healing', 'Please pray', true, false, false, true).label)
      .toBe('Reconnect to share your request');
    expect(prayActionState(12, false, false, true, false)).toEqual({
      mode: 'refresh',
      label: 'Refresh prayer status',
      disabled: false,
      hint: 'Refreshes the prayer wall before praying again.',
    });
    expect(prayActionState(12, true, false, true, false).label)
      .toBe('Reconnect to refresh prayer status');
  });

  it('rejects a refresh that began before a newer uncertain mutation', () => {
    expect(prayerRefreshOwnsReconciliation(4, 4)).toBe(true);
    expect(prayerRefreshOwnsReconciliation(3, 4)).toBe(false);
  });

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

  it('does not invite duplicate prayer mutations after response loss', () => {
    const timeout = new AxiosError('timeout', 'ECONNABORTED');
    expect(prayerMutationFailureAlert('create', timeout)).toEqual({
      outcomeUnknown: true,
      title: 'Request status unknown',
      message: expect.stringMatching(/Refresh the prayer wall before submitting it again/),
    });
    expect(prayerMutationFailureAlert('pray', timeout)).toEqual({
      outcomeUnknown: true,
      title: 'Prayer status unknown',
      message: expect.stringMatching(/before pressing Pray again/),
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
    expect(prayerMutationFailureAlert('create', rejected)).toEqual({
      outcomeUnknown: false,
      title: 'Request not shared',
      message: 'Please add more detail.',
    });
    expect(prayerMutationFailureAlert('pray', rejected).title).toBe('Not saved');
  });
});
