import {
  clearDeferredUrl,
  consumeDeferredUrl,
  createInitialUrlGate,
  notificationUrlFromData,
  rememberDeferredUrl,
  resolveInitialMemberUrl,
  safeNotificationUrl,
} from './notification-linking';

describe('notification deep links', () => {
  it('allows only known Altar OS destinations', () => {
    expect(safeNotificationUrl('altaros://events/event-1')).toBe('altaros://events/event-1');
    expect(safeNotificationUrl('altaros://giving/history')).toBe('altaros://giving/history');
    expect(safeNotificationUrl('altaros://community/posts/post-1')).toBe('altaros://community/posts/post-1');
    expect(safeNotificationUrl('altaros://community/new')).toBe('altaros://community/new');
    expect(safeNotificationUrl('https://evil.example')).toBeNull();
    expect(safeNotificationUrl('altaros://admin')).toBeNull();
  });

  it('rejects routes that only share an allowed prefix or contain unsafe IDs', () => {
    expect(safeNotificationUrl('altaros://profile/security')).toBeNull();
    expect(safeNotificationUrl('altaros://giving/history/export')).toBeNull();
    expect(safeNotificationUrl('altaros://events/event-1/attendees')).toBeNull();
    expect(safeNotificationUrl('altaros://events/%2Fadmin')).toBeNull();
    expect(safeNotificationUrl('altaros://community/posts/post%20one')).toBeNull();
    expect(safeNotificationUrl('altaros://events/event-1\nhttps://evil.example')).toBeNull();
  });

  it('bounds route IDs and complete URL size before navigation parses them', () => {
    expect(safeNotificationUrl(`altaros://events/${'a'.repeat(128)}`)).not.toBeNull();
    expect(safeNotificationUrl(`altaros://events/${'a'.repeat(129)}`)).toBeNull();
    expect(
      safeNotificationUrl(`altaros://giving/complete?reference=${'a'.repeat(2_100)}`),
    ).toBeNull();
  });

  it('allows query data only for canonical payment callback references', () => {
    const reference = `alt_${'a'.repeat(32)}`;
    expect(safeNotificationUrl(`altaros://giving/complete?reference=${reference}`))
      .toBe(`altaros://giving/complete?reference=${reference}`);
    expect(safeNotificationUrl(`altaros://giving/complete?reference=${reference}&trxref=${reference}`))
      .not.toBeNull();
    expect(safeNotificationUrl(
      `altaros://giving/complete?reference=${reference}&trxref=alt_${'b'.repeat(32)}`,
    )).toBeNull();
    expect(safeNotificationUrl('altaros://profile?redirect=notifications')).toBeNull();
    expect(safeNotificationUrl('altaros://events/event-1?admin=true')).toBeNull();
    expect(safeNotificationUrl('altaros://giving/complete?reference=javascript:alert(1)')).toBeNull();
    expect(safeNotificationUrl(`altaros://giving/complete?reference=${reference}&reference=${reference}`)).toBeNull();
    expect(safeNotificationUrl(`altaros://giving/complete?reference=${reference}#receipt`)).toBeNull();
  });

  it('accepts either server payload key and rejects non-strings', () => {
    expect(notificationUrlFromData({ deepLink: 'altaros://notifications' })).toBe('altaros://notifications');
    expect(notificationUrlFromData({ url: 'altaros://prayer' })).toBe('altaros://prayer');
    expect(notificationUrlFromData({ url: 42 })).toBeNull();
  });

  it('defers one safe auth-bound destination and consumes it once', () => {
    clearDeferredUrl();
    expect(rememberDeferredUrl('https://evil.example/phish')).toBe(false);
    const callback = `altaros://giving/complete?reference=alt_${'a'.repeat(32)}`;
    expect(rememberDeferredUrl(callback)).toBe(true);
    expect(consumeDeferredUrl()).toBe(callback);
    expect(consumeDeferredUrl()).toBeNull();
  });

  it('reads a process launch URL only once across logout and another login', async () => {
    const gate = createInitialUrlGate();
    const read = jest.fn().mockResolvedValue('altaros://events/event-1');
    await expect(gate.take(read)).resolves.toBe('altaros://events/event-1');
    await expect(gate.take(read)).resolves.toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('shares one pending launch read with an auth-to-member navigator handoff', async () => {
    const gate = createInitialUrlGate();
    let resolveRead!: (value: string | null) => void;
    const read = jest.fn(() => new Promise<string | null>((resolve) => { resolveRead = resolve; }));

    const authCollector = gate.take(read);
    const memberNavigator = gate.take(read);
    expect(read).toHaveBeenCalledTimes(1);

    resolveRead('altaros://giving/complete?reference=alt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    await expect(authCollector).resolves.toContain('giving/complete');
    await expect(memberNavigator).resolves.toContain('giving/complete');
    await expect(gate.take(read)).resolves.toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('does not retry a failed launch read and risk replaying it after account transition', async () => {
    const gate = createInitialUrlGate();
    const read = jest.fn().mockRejectedValueOnce(new Error('linking unavailable'));
    await expect(gate.take(read)).rejects.toThrow('linking unavailable');
    await expect(gate.take(read)).resolves.toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('falls back to a notification when the native link bridge rejects', async () => {
    const readNotification = jest.fn().mockResolvedValue('altaros://prayer');
    await expect(resolveInitialMemberUrl(
      async () => { throw new Error('linking unavailable'); },
      readNotification,
    )).resolves.toBe('altaros://prayer');
    expect(readNotification).toHaveBeenCalledTimes(1);
  });

  it('prefers a safe explicit app link without consuming notification fallback', async () => {
    const readNotification = jest.fn().mockResolvedValue('altaros://prayer');
    await expect(resolveInitialMemberUrl(
      async () => 'altaros://events/event-1',
      readNotification,
    )).resolves.toBe('altaros://events/event-1');
    expect(readNotification).not.toHaveBeenCalled();
  });

  it('rejects unsafe startup values and resolves bridge failure to the home route', async () => {
    await expect(resolveInitialMemberUrl(
      async () => 'https://evil.example/phish',
      async () => { throw new Error('notifications unavailable'); },
    )).resolves.toBeNull();
  });
});
