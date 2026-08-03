import { isAmbiguousMutationFailure } from './api-error';

export interface NotificationActionResult {
  readFailed: boolean;
  readError?: unknown;
  openFailed: boolean;
}

export interface NotificationInboxOwner {
  churchId?: string;
  memberId?: string;
}

export function notificationBannerState(
  actionError: string,
  loadError: string,
  actionNeedsRefresh: boolean,
  offline: boolean,
): {
  message: string;
  action?: { label: string; hint: string; disabled: boolean };
} | null {
  const messages = [actionError.trim(), loadError.trim()].filter(Boolean);
  if (messages.length === 0 && !actionNeedsRefresh) return null;
  if (messages.length === 0) {
    messages.push('Notification read status needs to be refreshed.');
  }
  const refreshRequired = Boolean(loadError.trim()) || actionNeedsRefresh;
  return {
    message: [...new Set(messages)].join(' '),
    ...(refreshRequired ? {
      action: offline
        ? {
          label: 'Reconnect to refresh',
          hint: 'Reconnect to refresh your notification inbox.',
          disabled: true,
        }
        : {
          label: 'Refresh inbox',
          hint: 'Loads the latest notifications and read status.',
          disabled: false,
        },
    } : {}),
  };
}

export function notificationInboxBelongsToIdentity(
  owner: NotificationInboxOwner | null,
  active: NotificationInboxOwner,
): boolean {
  return owner !== null
    && owner.churchId !== undefined
    && owner.memberId !== undefined
    && owner.churchId === active.churchId
    && owner.memberId === active.memberId;
}

export function notificationMutationCompletionBelongsToIdentity(
  mounted: boolean,
  active: NotificationInboxOwner,
  startedChurchId: string,
  startedMemberId: string,
): boolean {
  return mounted
    && active.churchId === startedChurchId
    && active.memberId === startedMemberId;
}

function start(action?: () => Promise<void>): Promise<void> {
  if (!action) return Promise.resolve();
  try {
    return Promise.resolve(action());
  } catch (error) {
    return Promise.reject(error);
  }
}

/**
 * Start navigation without waiting for the read receipt. This keeps a slow
 * gateway from replaying an old member destination after a later sign-out and
 * lets either operation report its own failure without cancelling the other.
 */
export async function runNotificationActions(
  readAction?: () => Promise<void>,
  openAction?: () => Promise<void>,
): Promise<NotificationActionResult> {
  const read = start(readAction);
  const open = start(openAction);
  const [readResult, openResult] = await Promise.allSettled([read, open]);
  return {
    readFailed: readResult.status === 'rejected',
    ...(readResult.status === 'rejected' ? { readError: readResult.reason } : {}),
    openFailed: openResult.status === 'rejected',
  };
}

export function notificationReadFailure(error: unknown): { outcomeUnknown: boolean; message: string } {
  return isAmbiguousMutationFailure(error)
    ? {
      outcomeUnknown: true,
      message: 'We could not confirm whether that notification was marked as read. Refresh your inbox to check its latest status.',
    }
    : {
      outcomeUnknown: false,
      message: 'That notification could not be marked as read. Try again.',
    };
}

export function notificationActionAccessibility(
  hasDestination: boolean,
  isRead: boolean,
  offline: boolean,
  busy: boolean,
): { disabled: boolean; busy: boolean; hint: string } {
  const disabled = busy || (!hasDestination && (offline || isRead));
  const hint = busy
    ? hasDestination ? 'Opening the related screen' : 'Marking this notification as read'
    : hasDestination
      ? offline && !isRead
        ? 'Opens the related screen; reconnect later to mark this notification as read'
        : isRead ? 'Opens the related screen' : 'Marks as read and opens the related screen'
      : offline ? 'Reconnect to mark this notification as read' : 'Marks this notification as read';
  return { disabled, busy, hint };
}
