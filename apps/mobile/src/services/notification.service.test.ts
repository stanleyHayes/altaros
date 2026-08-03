import api from './api';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import notificationService, {
  configureNotificationPresentation,
  normalizeNativePushToken,
  ensureAndroidNotificationChannel,
  normalizeNotification,
  rollbackNotificationReadAt,
  supportsNativePush,
  validateDeviceRegistrationAcknowledgement,
  validateNotificationReadAcknowledgement,
} from './notification.service';

jest.mock('./api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
  sessionBoundRequest: jest.fn((accessToken: string) => ({
    _sessionBound: true,
    headers: { Authorization: `Bearer ${accessToken}` },
  })),
}));

jest.mock('./session', () => ({
  session: { getAccessToken: jest.fn(async () => 'access-token') },
}));

jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getDevicePushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
}));

const mockedApi = api as jest.Mocked<typeof api>;
const mockedNotifications = Notifications as jest.Mocked<typeof Notifications>;

describe('notification device registration', () => {
  const nativeToken = `native_${'a'.repeat(64)}`;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not prompt or register when permission has not been granted', async () => {
    mockedNotifications.getPermissionsAsync.mockResolvedValueOnce({ status: 'denied' } as never);

    await expect(notificationService.syncPushRegistration()).resolves.toBe(false);

    expect(mockedNotifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('does not inspect or request notification permission on an unsupported web runtime', async () => {
    await expect(notificationService.syncPushRegistration('web')).resolves.toBe(false);
    await expect(notificationService.enablePush('web'))
      .rejects.toThrow('available in the installed mobile app');

    expect(mockedNotifications.getPermissionsAsync).not.toHaveBeenCalled();
    expect(mockedNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(mockedNotifications.setNotificationChannelAsync).not.toHaveBeenCalled();
    expect(mockedNotifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('advertises native push support only on iOS and Android', () => {
    expect(supportsNativePush('ios')).toBe(true);
    expect(supportsNativePush('android')).toBe(true);
    expect(supportsNativePush('web')).toBe(false);
  });

  it('refreshes an already-consented native token with the backend', async () => {
    mockedNotifications.getPermissionsAsync.mockResolvedValueOnce({ status: 'granted' } as never);
    mockedNotifications.getDevicePushTokenAsync.mockResolvedValueOnce({
      type: Platform.OS,
      data: nativeToken,
    } as never);
    mockedApi.post.mockResolvedValueOnce({ data: {} } as never);

    await expect(notificationService.syncPushRegistration()).resolves.toBe(true);

    expect(mockedNotifications.getDevicePushTokenAsync).toHaveBeenCalledWith();
    expect(mockedApi.post).toHaveBeenCalledWith('/notifications/devices', {
      token: nativeToken,
      platform: Platform.OS,
    }, {
      _sessionBound: true,
      headers: { Authorization: 'Bearer access-token' },
    });
  });

  it('registers a native token that rotates while the member session remains active', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {} } as never);

    await expect(notificationService.registerRotatedDevice({
      type: Platform.OS,
      data: nativeToken,
    } as never, Platform.OS)).resolves.toBe(true);

    expect(mockedNotifications.getPermissionsAsync).not.toHaveBeenCalled();
    expect(mockedNotifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect(mockedApi.post).toHaveBeenCalledWith('/notifications/devices', {
      token: nativeToken,
      platform: Platform.OS,
    }, {
      _sessionBound: true,
      headers: { Authorization: 'Bearer access-token' },
    });
  });

  it('does not register a rotated token after the owning member session changes', async () => {
    const canRegister = jest.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);

    await expect(notificationService.registerRotatedDevice({
      type: Platform.OS,
      data: nativeToken,
    } as never, Platform.OS, canRegister)).rejects.toThrow('member session changed');

    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('ignores rotated push tokens on unsupported runtimes', async () => {
    await expect(notificationService.registerRotatedDevice({
      type: 'web',
      data: nativeToken,
    } as never, 'web')).resolves.toBe(false);

    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('does not register a token after the initiating member session changes', async () => {
    let resolvePermission!: (value: unknown) => void;
    mockedNotifications.requestPermissionsAsync.mockReturnValueOnce(new Promise((resolve) => {
      resolvePermission = resolve;
    }) as never);
    let active = true;

    const enabling = notificationService.enablePush(Platform.OS, () => active);
    active = false;
    resolvePermission({ status: 'granted' });

    await expect(enabling).rejects.toThrow('member session changed');
    expect(mockedNotifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('returns whether the operating system can show the permission prompt again', async () => {
    mockedNotifications.requestPermissionsAsync.mockReset().mockResolvedValueOnce({
      status: 'denied', canAskAgain: false,
    } as never);

    await expect(notificationService.enablePush(Platform.OS)).resolves.toEqual({
      status: 'denied', canAskAgain: false,
    });
    expect(mockedNotifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('rechecks session ownership after native token retrieval and before transport', async () => {
    mockedNotifications.getPermissionsAsync.mockResolvedValueOnce({ status: 'granted' } as never);
    mockedNotifications.getDevicePushTokenAsync.mockResolvedValueOnce({
      type: Platform.OS,
      data: nativeToken,
    } as never);
    const canRegister = jest.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    await expect(notificationService.syncPushRegistration(Platform.OS, canRegister))
      .rejects.toThrow('member session changed');
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('accepts a matching device-registration acknowledgement', () => {
    expect(() => validateDeviceRegistrationAcknowledgement({
      success: true,
      data: { token: nativeToken, platform: 'android', registered: true },
    }, { token: nativeToken, platform: 'android' })).not.toThrow();
  });

  it.each([
    { success: false },
    { success: true, data: { token: `other_${'b'.repeat(64)}` } },
    { success: true, data: { platform: 'ios' } },
    { success: true, data: { registered: false } },
  ])('rejects a contradictory device-registration acknowledgement', (acknowledgement) => {
    expect(() => validateDeviceRegistrationAcknowledgement(
      acknowledgement,
      { token: nativeToken, platform: 'android' },
    )).toThrow('did not confirm push notification setup');
  });

  it('does not report a successful push sync after a negative acknowledgement', async () => {
    mockedNotifications.getPermissionsAsync.mockResolvedValueOnce({ status: 'granted' } as never);
    mockedNotifications.getDevicePushTokenAsync.mockResolvedValueOnce({
      type: Platform.OS,
      data: nativeToken,
    } as never);
    mockedApi.post.mockResolvedValueOnce({ data: { success: false } } as never);

    await expect(notificationService.syncPushRegistration())
      .rejects.toThrow('did not confirm push notification setup');
  });

  it('keeps the Android channel configured outside the first permission prompt', async () => {
    mockedNotifications.setNotificationChannelAsync.mockResolvedValueOnce(null);

    await ensureAndroidNotificationChannel('android');

    expect(mockedNotifications.setNotificationChannelAsync).toHaveBeenCalledWith('default', {
      name: 'Church updates',
      description: 'Giving receipts, event reminders, and pastoral messages',
      importance: 3,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#6DD5C4',
      sound: 'default',
    });
  });

  it('does not call Android channel APIs on other platforms', async () => {
    await ensureAndroidNotificationChannel('ios');
    expect(mockedNotifications.setNotificationChannelAsync).not.toHaveBeenCalled();
  });

  it('declares visible foreground presentation without inventing a badge count', async () => {
    configureNotificationPresentation();
    expect(mockedNotifications.setNotificationHandler).toHaveBeenCalledTimes(1);
    const handler = mockedNotifications.setNotificationHandler.mock.calls[0]?.[0];
    await expect(handler?.handleNotification({} as never)).resolves.toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    });
  });

  it('accepts only a bounded native token for the running OS', () => {
    expect(normalizeNativePushToken({ type: 'android', data: ` ${nativeToken} ` }, 'android'))
      .toEqual({ token: nativeToken, platform: 'android' });
  });

  it.each([
    { type: 'expo', data: `ExponentPushToken[${'a'.repeat(40)}]` },
    { type: 'web', data: { endpoint: 'https://push.example' } },
    { type: 'ios', data: nativeToken },
    { type: 'android', data: 'short' },
    { type: 'android', data: `${nativeToken.slice(0, 20)}\n${nativeToken.slice(20)}` },
  ])('rejects a relay, foreign-platform, malformed, or unsafe token', (token) => {
    expect(() => normalizeNativePushToken(token, 'android')).toThrow('invalid push token');
  });
});

describe('notification member contract', () => {
  beforeEach(() => jest.clearAllMocks());

  it('normalizes the shared list envelope, metadata link, and READ status', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { success: true, data: [{
      id: 'notification-1', title: 'Service starts soon', body: 'Join us at 9am',
      churchId: 'church-1', recipientId: 'member-1', channel: 'PUSH', type: 'EVENT_REMINDER',
      status: 'READ', sentAt: '2026-08-01T08:00:00Z', createdAt: '2026-08-01T07:00:00Z',
      metadata: { deepLink: 'altaros://events/event-1' },
    }] } } as never);

    await expect(notificationService.list('church-1', 'member-1')).resolves.toEqual([{
      id: 'notification-1', title: 'Service starts soon', body: 'Join us at 9am',
      readAt: '2026-08-01T08:00:00Z', createdAt: '2026-08-01T07:00:00Z',
      deepLink: 'altaros://events/event-1',
    }]);
    expect(mockedApi.get).toHaveBeenCalledWith('/notifications');
  });

  it('loads a bounded notification page with its authoritative total', async () => {
    const item = {
      id: 'notification-2', title: 'Giving receipt', body: 'Thank you for giving.',
      churchId: 'church-1', recipientId: 'member-1', channel: 'SMS', type: 'CUSTOM',
      status: 'SENT', createdAt: '2026-08-01T09:00:00Z', metadata: {},
    };
    mockedApi.get.mockResolvedValueOnce({ data: {
      success: true, data: { data: [item], total: 51 },
    } } as never);

    await expect(notificationService.listPage('church-1', 'member-1', 2, 50))
      .resolves.toEqual({ items: [{
        id: 'notification-2', title: 'Giving receipt', body: 'Thank you for giving.',
        createdAt: '2026-08-01T09:00:00Z',
      }], total: 51 });
    expect(mockedApi.get).toHaveBeenCalledWith('/notifications', {
      params: { page: 2, limit: 50 },
    });
  });

  it.each([[0, 50], [1.5, 50], [1, 0], [1, 101]])(
    'rejects an unsafe notification page before transport: %s/%s',
    async (page, limit) => {
      const callsBefore = mockedApi.get.mock.calls.length;
      await expect(notificationService.listPage('church-1', 'member-1', page, limit))
        .rejects.toThrow('page is not valid');
      expect(mockedApi.get).toHaveBeenCalledTimes(callsBefore);
    },
  );

  it('retains compatibility with a mobile-shaped array', async () => {
    const item = {
      id: 'notification-1', title: 'Welcome', body: 'You are connected',
      createdAt: '2026-08-01T07:00:00Z', deepLink: 'altaros://profile',
    };
    mockedApi.get.mockResolvedValueOnce({ data: [item] } as never);
    await expect(notificationService.list('church-1', 'member-1')).resolves.toEqual([item]);
  });

  it('marks a validated notification id through the shared PUT route', async () => {
    mockedApi.put.mockResolvedValueOnce({ data: undefined } as never);
    await notificationService.markRead('notice-1');
    expect(mockedApi.put).toHaveBeenCalledWith('/notifications/notice-1/read');
  });

  it('accepts a matching notification read acknowledgement', () => {
    expect(() => validateNotificationReadAcknowledgement({
      success: true,
      data: { notificationId: 'notice-1', status: 'READ', readAt: '2026-08-01T08:00:00Z' },
    }, 'notice-1')).not.toThrow();
  });

  it.each([
    { success: false },
    { success: true, data: { id: 'notice-2' } },
    { success: true, data: { notificationId: 'notice-2' } },
    { success: true, data: { status: 'SENT' } },
    { success: true, data: { readAt: 'not-a-date' } },
  ])('rejects a contradictory notification read acknowledgement', (acknowledgement) => {
    expect(() => validateNotificationReadAcknowledgement(acknowledgement, 'notice-1'))
      .toThrow('did not confirm this notification was read');
  });

  it('rejects an unsafe notification id before the read mutation', async () => {
    await expect(notificationService.markRead('notice/unsafe id'))
      .rejects.toThrow('reference is not valid');
    expect(mockedApi.put).not.toHaveBeenCalled();
  });

  it('rejects unsafe inbox ownership before transport', async () => {
    await expect(notificationService.list('church/unsafe', 'member-1'))
      .rejects.toThrow('identity is incomplete');
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('rolls back only the optimistic read timestamp a failed request still owns', () => {
    expect(rollbackNotificationReadAt('optimistic', 'optimistic', undefined)).toBeUndefined();
    expect(rollbackNotificationReadAt('server-confirmed', 'optimistic', undefined))
      .toBe('server-confirmed');
  });

  it.each([
    { id: '', title: 'Title', body: 'Body', createdAt: '2026-08-01T07:00:00Z' },
    { id: 'notice-1', title: 'Title', body: 'Body', createdAt: 'not-a-date' },
    { id: 'notice-1', title: 'Title', body: 'Body', createdAt: '2026-08-01T07:00:00Z', status: 'OPENED' },
    { id: 'notice-1', title: 'Title', body: 'Body', createdAt: '2026-08-01T07:00:00Z', metadata: [] },
  ])('rejects malformed notification records', (notification) => {
    expect(() => normalizeNotification(notification)).toThrow('invalid notification');
  });

  it('rejects a shared notification owned by another member or church', () => {
    expect(() => normalizeNotification({
      id: 'notice-1', churchId: 'other-church', recipientId: 'member-1',
      channel: 'PUSH', type: 'ANNOUNCEMENT', status: 'SENT', title: 'Update', body: 'Body',
      metadata: {}, createdAt: '2026-08-01T07:00:00Z',
    }, { churchId: 'church-1', recipientId: 'member-1' })).toThrow('invalid notification');
  });

  it('drops an external metadata URL before the inbox can open it', () => {
    expect(normalizeNotification({
      id: 'notice-1', title: 'Update', body: 'Body', metadata: { url: 'https://evil.example' },
      createdAt: '2026-08-01T07:00:00Z',
    })).not.toHaveProperty('deepLink');
  });

  it('keeps intentional line breaks in a bounded notification body', () => {
    expect(normalizeNotification({
      id: 'notice-1', title: 'Order of service', body: 'Welcome\nWorship\nMessage',
      createdAt: '2026-08-01T07:00:00Z',
    }).body).toBe('Welcome\nWorship\nMessage');
  });

  it('rejects a malformed shared envelope instead of showing false emptiness', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { success: true } } as never);
    await expect(notificationService.list('church-1', 'member-1'))
      .rejects.toThrow('invalid notification inbox');
  });

  it('rejects duplicate notification identifiers', async () => {
    const notification = { id: 'notice-1', title: 'Update', body: 'Body', createdAt: '2026-08-01T07:00:00Z' };
    mockedApi.get.mockResolvedValueOnce({ data: [notification, notification] } as never);
    await expect(notificationService.list('church-1', 'member-1'))
      .rejects.toThrow('duplicate notifications');
  });

  it.each([
    ['identifier', { id: 'notice/unsafe', title: 'Title', body: 'Body', createdAt: '2026-08-01T07:00:00Z' }],
    ['title', { id: 'notice-1', title: 'x'.repeat(201), body: 'Body', createdAt: '2026-08-01T07:00:00Z' }],
    ['body', { id: 'notice-1', title: 'Title', body: 'x'.repeat(4_097), createdAt: '2026-08-01T07:00:00Z' }],
    ['control-bearing body', { id: 'notice-1', title: 'Title', body: 'Line one\u0000Line two', createdAt: '2026-08-01T07:00:00Z' }],
  ])('rejects an unsafe or oversized notification %s', (_field, notification) => {
    expect(() => normalizeNotification(notification)).toThrow('invalid notification');
  });

  it('rejects an oversized inbox before normalizing rows for FlatList', async () => {
    const notification = (index: number) => ({
      id: `notice-${index}`, title: 'Update', body: 'Body', createdAt: '2026-08-01T07:00:00Z',
    });
    mockedApi.get.mockResolvedValueOnce({ data: Array.from({ length: 201 }, (_, index) => notification(index)) } as never);
    await expect(notificationService.list('church-1', 'member-1'))
      .rejects.toThrow('too many notifications');
  });

  it('does not register an empty native push token', async () => {
    await expect(notificationService.registerDevice('  ', 'ios')).rejects.toThrow('invalid push token');
    expect(mockedApi.post).not.toHaveBeenCalled();
  });
});
