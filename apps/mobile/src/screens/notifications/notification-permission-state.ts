export interface PushPermissionState {
  status: 'granted' | 'denied' | 'undetermined';
  canAskAgain: boolean;
}

export function pushPermissionAction(
  permission: PushPermissionState | null,
  checkFailed = false,
): 'checking' | 'retry' | 'prompt' | 'settings' | 'enabled' {
  if (checkFailed) return 'retry';
  if (!permission) return 'checking';
  if (permission.status === 'granted') return 'enabled';
  return permission.canAskAgain ? 'prompt' : 'settings';
}
