export interface NotificationActionResult {
  readFailed: boolean;
  openFailed: boolean;
}

export interface NotificationInboxOwner {
  churchId?: string;
  memberId?: string;
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
    openFailed: openResult.status === 'rejected',
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
