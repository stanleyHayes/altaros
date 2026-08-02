import {
  notificationActionAccessibility,
  notificationInboxBelongsToIdentity,
  notificationMutationCompletionBelongsToIdentity,
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
    await expect(runNotificationActions(() => { throw new Error('read failed'); }, open))
      .resolves.toEqual({ readFailed: true, openFailed: false });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('reports independent read and navigation failures', async () => {
    await expect(runNotificationActions(
      async () => { throw new Error('read failed'); },
      async () => { throw new Error('open failed'); },
    )).resolves.toEqual({ readFailed: true, openFailed: true });
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
