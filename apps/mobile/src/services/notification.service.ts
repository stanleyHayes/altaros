import api, { sessionBoundRequest } from './api';
import { Platform } from 'react-native';
import * as Notifications from './notification-platform';
import { safeNotificationUrl } from './notification-linking';
import { session } from './session';

const ANDROID_CHANNEL_ID = 'default';
type NativePushPlatform = 'ios' | 'android';

export interface PushPermissionResult {
  status: Notifications.PermissionStatus;
  canAskAgain: boolean;
}

export function supportsNativePush(
  platform: typeof Platform.OS = Platform.OS,
): platform is NativePushPlatform {
  return platform === 'ios' || platform === 'android';
}

export function normalizeNativePushToken(
  value: unknown,
  expectedPlatform: typeof Platform.OS = Platform.OS,
): { token: string; platform: NativePushPlatform } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('This device returned an invalid push token.');
  }
  const candidate = value as { type?: unknown; data?: unknown };
  const platform = candidate.type;
  const token = typeof candidate.data === 'string' ? candidate.data.trim() : '';
  const validPlatform = platform === 'ios' || platform === 'android';
  const valid = validPlatform
    && platform === expectedPlatform
    && token.length >= 32
    && token.length <= 4_096
    && !/[\u0000-\u001F\u007F]/.test(token);
  if (!valid) throw new Error('This device returned an invalid push token.');
  return { token, platform };
}

export function configureNotificationPresentation(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      // The app does not yet own a server-backed unread badge count, so avoid
      // leaving an inaccurate OS badge after the member reads the inbox.
      shouldSetBadge: false,
    }),
  });
}

export async function ensureAndroidNotificationChannel(
  platform: typeof Platform.OS = Platform.OS,
): Promise<void> {
  if (platform !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Church updates',
    description: 'Giving receipts, event reminders, and pastoral messages',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#6DD5C4',
    sound: 'default',
  });
}

export interface MemberNotification {
  id: string;
  title: string;
  body: string;
  readAt?: string;
  createdAt: string;
  deepLink?: string;
}

interface WireNotification extends Omit<MemberNotification, 'readAt' | 'deepLink'> {
  churchId?: string;
  recipientId?: string;
  channel?: string;
  type?: string;
  readAt?: string | Date;
  sentAt?: string | Date;
  status?: string;
  deepLink?: string;
  metadata?: Record<string, unknown>;
}

const dateString = (value: string | Date | undefined): string | undefined => {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
};

const NOTIFICATION_STATUSES = new Set(['PENDING', 'SENT', 'FAILED', 'READ']);
const NOTIFICATION_CHANNELS = new Set(['PUSH', 'SMS', 'EMAIL']);
const NOTIFICATION_TYPES = new Set([
  'EVENT_REMINDER', 'GIVING_REMINDER', 'EMERGENCY_ALERT', 'WELCOME',
  'BIRTHDAY', 'FOLLOW_UP', 'ANNOUNCEMENT', 'CUSTOM',
]);
const MAX_INBOX_ITEMS = 200;
export const NOTIFICATION_PAGE_SIZE = 50;
const MAX_ID_LENGTH = 128;
const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 4_096;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export interface NotificationPage {
  items: MemberNotification[];
  total: number;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function boundedText(value: unknown, maxLength: number, allowLineBreaks = false): value is string {
  const unsafeControls = allowLineBreaks
    ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
    : /[\u0000-\u001F\u007F]/;
  return nonEmptyString(value)
    && value.length <= maxLength
    && !unsafeControls.test(value);
}

function validId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= MAX_ID_LENGTH
    && SAFE_ID.test(value);
}

function optionalMutationPayload(value: unknown, errorMessage: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(errorMessage);

  const envelope = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(envelope, 'success') && envelope.success !== true) {
    throw new Error(errorMessage);
  }
  if (!Object.prototype.hasOwnProperty.call(envelope, 'data')) return envelope;
  if (envelope.success !== true) throw new Error(errorMessage);
  if (envelope.data === undefined || envelope.data === null) return undefined;
  if (typeof envelope.data !== 'object' || Array.isArray(envelope.data)) throw new Error(errorMessage);
  return envelope.data as Record<string, unknown>;
}

export function validateNotificationReadAcknowledgement(value: unknown, expectedId: string): void {
  const errorMessage = 'The server did not confirm this notification was read.';
  const payload = optionalMutationPayload(value, errorMessage);
  if (!payload) return;

  if (Object.prototype.hasOwnProperty.call(payload, 'id') && payload.id !== expectedId) {
    throw new Error(errorMessage);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'notificationId')
    && payload.notificationId !== expectedId) {
    throw new Error(errorMessage);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'status') && payload.status !== 'READ') {
    throw new Error(errorMessage);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'readAt') && !validDateValue(payload.readAt)) {
    throw new Error(errorMessage);
  }
}

export function validateDeviceRegistrationAcknowledgement(
  value: unknown,
  expected: { token: string; platform: NativePushPlatform },
): void {
  const errorMessage = 'The server did not confirm push notification setup.';
  const payload = optionalMutationPayload(value, errorMessage);
  if (!payload) return;

  if (Object.prototype.hasOwnProperty.call(payload, 'token') && payload.token !== expected.token) {
    throw new Error(errorMessage);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'platform')
    && payload.platform !== expected.platform) {
    throw new Error(errorMessage);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'registered') && payload.registered !== true) {
    throw new Error(errorMessage);
  }
}

/** Roll back only the optimistic value this request still owns. */
export function rollbackNotificationReadAt(
  currentReadAt: string | undefined,
  optimisticReadAt: string,
  previousReadAt: string | undefined,
): string | undefined {
  return currentReadAt === optimisticReadAt ? previousReadAt : currentReadAt;
}

function validDateValue(value: unknown): value is string | Date {
  if (!(typeof value === 'string' || value instanceof Date)) return false;
  if (typeof value === 'string' && value.length > 64) return false;
  return Number.isFinite(value instanceof Date ? value.getTime() : Date.parse(value));
}

export function normalizeNotification(
  value: unknown,
  ownership?: { churchId: string; recipientId: string },
): MemberNotification {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The server returned an invalid notification.');
  }
  const item = value as Partial<WireNotification>;
  const validMetadata = item.metadata === undefined
    || (typeof item.metadata === 'object' && item.metadata !== null && !Array.isArray(item.metadata));
  const valid = validId(item.id)
    && boundedText(item.title, MAX_TITLE_LENGTH)
    && boundedText(item.body, MAX_BODY_LENGTH, true)
    && validDateValue(item.createdAt)
    && (item.readAt === undefined || validDateValue(item.readAt))
    && (item.sentAt === undefined || validDateValue(item.sentAt))
    && (item.status === undefined || NOTIFICATION_STATUSES.has(item.status))
    && (item.channel === undefined || NOTIFICATION_CHANNELS.has(item.channel))
    && (item.type === undefined || NOTIFICATION_TYPES.has(item.type))
    && validMetadata
    && (item.deepLink === undefined || typeof item.deepLink === 'string')
    && (!ownership || (
      item.churchId === ownership.churchId
      && item.recipientId === ownership.recipientId
      && nonEmptyString(item.status)
      && nonEmptyString(item.channel)
      && nonEmptyString(item.type)
      && item.metadata !== undefined
    ));
  if (!valid) throw new Error('The server returned an invalid notification.');

  const metadataLink = item.metadata?.deepLink ?? item.metadata?.url;
  const readAt = dateString(item.readAt)
    ?? (item.status === 'READ' ? dateString(item.sentAt) ?? item.createdAt : undefined);
  const deepLink = safeNotificationUrl(
    typeof metadataLink === 'string' ? metadataLink : item.deepLink,
  );
  return {
    id: item.id as string,
    title: item.title as string,
    body: item.body as string,
    createdAt: dateString(item.createdAt as string | Date) as string,
    ...(readAt ? { readAt } : {}),
    ...(deepLink ? { deepLink } : {}),
  };
}

const notificationService = {
  async listPage(
    churchId: string,
    recipientId: string,
    page: number,
    limit = NOTIFICATION_PAGE_SIZE,
  ): Promise<NotificationPage> {
    if (!validId(churchId) || !validId(recipientId)) {
      throw new Error('The member identity is incomplete.');
    }
    if (!Number.isSafeInteger(page) || page < 1
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('The notification page is not valid.');
    }
    const { data } = await api.get<unknown>('/notifications', { params: { page, limit } });
    if (typeof data !== 'object' || data === null || Array.isArray(data)
      || (data as { success?: unknown }).success !== true) {
      throw new Error('The server returned an invalid notification inbox.');
    }
    const payload = (data as { data?: unknown }).data;
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new Error('The server returned an invalid notification inbox.');
    }
    const candidate = payload as { data?: unknown; total?: unknown };
    if (!Array.isArray(candidate.data) || candidate.data.length > limit
      || !Number.isSafeInteger(candidate.total) || Number(candidate.total) < candidate.data.length) {
      throw new Error('The server returned an invalid notification inbox.');
    }
    const items = candidate.data.map((item) => normalizeNotification(item, {
      churchId, recipientId,
    }));
    if (new Set(items.map((item) => item.id)).size !== items.length) {
      throw new Error('The server returned duplicate notifications.');
    }
    return { items, total: Number(candidate.total) };
  },

  async list(churchId: string, recipientId: string): Promise<MemberNotification[]> {
    if (!validId(churchId) || !validId(recipientId)) {
      throw new Error('The member identity is incomplete.');
    }
    const { data } = await api.get<unknown>('/notifications');
    const legacy = Array.isArray(data);
    if (!legacy && (typeof data !== 'object' || data === null || Array.isArray(data)
      || (data as { success?: unknown }).success !== true
      || !Array.isArray((data as { data?: unknown }).data))) {
      throw new Error('The server returned an invalid notification inbox.');
    }
    const items = legacy ? data : (data as { data: unknown[] }).data;
    if (items.length > MAX_INBOX_ITEMS) {
      throw new Error('The server returned too many notifications.');
    }
    const normalized = items.map((item) => normalizeNotification(
      item,
      legacy ? undefined : { churchId, recipientId },
    ));
    if (new Set(normalized.map((item) => item.id)).size !== normalized.length) {
      throw new Error('The server returned duplicate notifications.');
    }
    return normalized;
  },
  async markRead(id: string): Promise<void> {
    if (!validId(id)) throw new Error('The notification reference is not valid.');
    const { data } = await api.put<unknown>(`/notifications/${encodeURIComponent(id)}/read`);
    validateNotificationReadAcknowledgement(data, id);
  },
  async registerDevice(token: string, platform: NativePushPlatform): Promise<void> {
    const normalized = normalizeNativePushToken({ type: platform, data: token }, platform);
    const { data } = await api.post<unknown>('/notifications/devices', normalized);
    validateDeviceRegistrationAcknowledgement(data, normalized);
  },

  async registerDeviceForSession(
    token: string,
    platform: NativePushPlatform,
    canRegister: () => boolean,
  ): Promise<void> {
    const normalized = normalizeNativePushToken({ type: platform, data: token }, platform);
    const accessToken = await session.getAccessToken();
    if (!accessToken || !canRegister()) {
      throw new Error('The member session changed before push setup completed.');
    }
    const { data } = await api.post<unknown>(
      '/notifications/devices',
      normalized,
      sessionBoundRequest(accessToken),
    );
    validateDeviceRegistrationAcknowledgement(data, normalized);
  },

  async registerRotatedDevice(
    token: Notifications.DevicePushToken,
    platform: typeof Platform.OS = Platform.OS,
    canRegister: () => boolean = () => true,
  ): Promise<boolean> {
    if (!supportsNativePush(platform)) return false;
    if (!canRegister()) throw new Error('The member session changed before push setup completed.');
    const normalized = normalizeNativePushToken(token, platform);
    if (!canRegister()) throw new Error('The member session changed before push setup completed.');
    await this.registerDeviceForSession(normalized.token, normalized.platform, canRegister);
    return true;
  },

  async syncPushRegistration(
    platform: typeof Platform.OS = Platform.OS,
    canRegister: () => boolean = () => true,
  ): Promise<boolean> {
    // This client intentionally registers native APNs/FCM identities. Expo's
    // web notification token has a different shape and backend transport, so
    // do not ask for browser permission and then fail after consent.
    if (!supportsNativePush(platform)) return false;
    if (!canRegister()) throw new Error('The member session changed before push setup completed.');

    const permission = await Notifications.getPermissionsAsync();
    if (permission.status !== 'granted') return false;
    if (!canRegister()) throw new Error('The member session changed before push setup completed.');

    // Channels can be removed or changed independently of app permission.
    // Recreate the stable channel before every already-consented token sync.
    await ensureAndroidNotificationChannel(platform);
    if (!canRegister()) throw new Error('The member session changed before push setup completed.');

    const token = normalizeNativePushToken(await Notifications.getDevicePushTokenAsync(), platform);
    if (!canRegister()) throw new Error('The member session changed before push setup completed.');
    await this.registerDeviceForSession(token.token, token.platform, canRegister);
    return true;
  },

  async enablePush(
    platform: typeof Platform.OS = Platform.OS,
    canRegister: () => boolean = () => true,
  ): Promise<PushPermissionResult> {
    if (!supportsNativePush(platform)) {
      throw new Error('Push alerts are available in the installed mobile app.');
    }
    if (!canRegister()) throw new Error('The member session changed before push setup completed.');

    await ensureAndroidNotificationChannel(platform);
    if (!canRegister()) throw new Error('The member session changed before push setup completed.');

    const permission = await Notifications.requestPermissionsAsync();
    const result = {
      status: permission.status,
      canAskAgain: permission.canAskAgain !== false,
    };
    if (permission.status !== 'granted') return result;
    if (!canRegister()) throw new Error('The member session changed before push setup completed.');

    await this.syncPushRegistration(platform, canRegister);
    return result;
  },
};

export default notificationService;
