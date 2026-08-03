import { AxiosError, AxiosHeaders } from 'axios';
import {
  notificationActionAccessibility,
  notificationBannerState,
  notificationInboxBelongsToIdentity,
  notificationMutationCompletionBelongsToIdentity,
  notificationReadFailure,
  runNotificationActions,
} from './notification-action';

describe('notification row actions', () => {
  it('starts navigation before a slow read receipt settles', async () => {
    let finishRead!: () => void;
    const read = jest.fn(() => new Promise<void>((resolve) => { finishRead = resolve; }));
    const open = jest.fn(async () => undefined);

    const result = runNotificationActions(read, open);
    expect(read).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);

    finishRead();
    await expect(result).resolves.toEqual({ readFailed: false, openFailed: false });
  });

  it('accepts inbox action completion only for the mounted initiating identity', () => {
    const active = { churchId: 'church-1', memberId: 'member-1' };
    expect(notificationMutationCompletionBelongsToIdentity(
      true, active, 'church-1', 'member-1',
    )).toBe(true);
    expect(notificationMutationCompletionBelongsToIdentity(
      false, active, 'church-1', 'member-1',
    )).toBe(false);
    expect(notificationMutationCompletionBelongsToIdentity(
      true, { ...active, memberId: 'member-2' }, 'church-1', 'member-1',
    )).toBe(false);
  });

  it('still opens the destination when starting the read action throws', async () => {
    const open = jest.fn(async () => undefined);
    const readError = new Error('read failed');
    await expect(runNotificationActions(() => { throw readError; }, open))
      .resolves.toEqual({ readFailed: true, readError, openFailed: false });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('reports independent read and navigation failures', async () => {
    const readError = new Error('read failed');
    await expect(runNotificationActions(
      async () => { throw readError; },
      async () => { throw new Error('open failed'); },
    )).resolves.toEqual({ readFailed: true, readError, openFailed: true });
  });

  it('requires an authoritative inbox refresh when a read acknowledgement is lost', () => {
    expect(notificationReadFailure(new AxiosError('timeout', 'ECONNABORTED'))).toEqual({
      outcomeUnknown: true,
      message: 'We could not confirm whether that notification was marked as read. Refresh your inbox to check its latest status.',
    });
  });

  it('allows ordinary retry after an explicit read rejection', () => {
    const rejected = new AxiosError(
      'Request failed',
      'ERR_BAD_REQUEST',
      { headers: new AxiosHeaders() },
      undefined,
      { data: {}, status: 409, statusText: 'Conflict', headers: {}, config: { headers: new AxiosHeaders() } },
    );
    expect(notificationReadFailure(rejected)).toEqual({
      outcomeUnknown: false,
      message: 'That notification could not be marked as read. Try again.',
    });
  });

  it('disables and announces a row while its action is in flight', () => {
    expect(notificationActionAccessibility(true, false, false, true)).toEqual({
      disabled: true,
      busy: true,
      hint: 'Opening the related screen',
    });
    expect(notificationActionAccessibility(false, false, true, false)).toEqual({
      disabled: true,
      busy: false,
      hint: 'Reconnect to mark this notification as read',
    });
  });

  it('renders a private inbox only for its exact loaded member and church', () => {
    const active = { churchId: 'church-1', memberId: 'member-1' };
    expect(notificationInboxBelongsToIdentity(active, active)).toBe(true);
    expect(notificationInboxBelongsToIdentity(null, active)).toBe(false);
    expect(notificationInboxBelongsToIdentity(
      { churchId: 'church-2', memberId: 'member-1' }, active,
    )).toBe(false);
    expect(notificationInboxBelongsToIdentity(
      { churchId: 'church-1', memberId: 'member-2' }, active,
    )).toBe(false);
    expect(notificationInboxBelongsToIdentity(active, {})).toBe(false);
  });
});

describe('notification banner recovery', () => {
  it('keeps concurrent action and inbox errors visible beside the relevant refresh', () => {
    expect(notificationBannerState(
      'The related screen could not be opened.',
      'Notifications are unavailable right now.',
      false,
      false,
    )).toEqual({
      message: 'The related screen could not be opened. Notifications are unavailable right now.',
      action: {
        label: 'Refresh inbox',
        hint: 'Loads the latest notifications and read status.',
        disabled: false,
      },
    });
    expect(notificationBannerState('Notifications are off.', '', false, false)).toEqual({
      message: 'Notifications are off.',
    });
    expect(notificationBannerState('', 'You are offline.', false, true)).toEqual({
      message: 'You are offline.',
      action: {
        label: 'Reconnect to refresh',
        hint: 'Reconnect to refresh your notification inbox.',
        disabled: true,
      },
    });
    expect(notificationBannerState('', '', true, false)).toEqual({
      message: 'Notification read status needs to be refreshed.',
      action: {
        label: 'Refresh inbox',
        hint: 'Loads the latest notifications and read status.',
        disabled: false,
      },
    });
    expect(notificationBannerState('', '', false, false)).toBeNull();
  });
});
