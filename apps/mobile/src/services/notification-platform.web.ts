export type PermissionStatus = 'granted' | 'denied' | 'undetermined';

export interface NotificationResponse {
  notification: {
    request: {
      content: { data: Record<string, unknown> };
    };
  };
}

interface Subscription {
  remove(): void;
}

export const AndroidImportance = { DEFAULT: 3 } as const;

export function setNotificationHandler(): void {
  // Browser push is intentionally unsupported until a server-side web-push
  // subscription and delivery contract exists.
}

export async function getPermissionsAsync(): Promise<{ status: PermissionStatus }> {
  return { status: 'denied' };
}

export async function requestPermissionsAsync(): Promise<{ status: PermissionStatus }> {
  return { status: 'denied' };
}

export async function getDevicePushTokenAsync(): Promise<never> {
  throw new Error('Native push tokens are unavailable on web.');
}

export async function setNotificationChannelAsync(): Promise<null> {
  return null;
}

export async function getLastNotificationResponseAsync(): Promise<null> {
  return null;
}

export async function clearLastNotificationResponseAsync(): Promise<void> {}

export function addNotificationResponseReceivedListener(
  _listener: (response: NotificationResponse) => void,
): Subscription {
  return { remove() {} };
}

export function addPushTokenListener(
  _listener: (token: { type: string; data: unknown }) => void,
): Subscription {
  return { remove() {} };
}
