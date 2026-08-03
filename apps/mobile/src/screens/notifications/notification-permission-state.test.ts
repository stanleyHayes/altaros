import { pushPermissionAction } from './notification-permission-state';

describe('notification permission recovery', () => {
  it('waits for the native permission check before exposing an action', () => {
    expect(pushPermissionAction(null)).toBe('checking');
  });

  it('exposes a retry when the device permission bridge could not be read', () => {
    expect(pushPermissionAction(null, true)).toBe('retry');
    expect(pushPermissionAction({ status: 'granted', canAskAgain: false }, true)).toBe('retry');
  });

  it('prompts only while the operating system can still ask', () => {
    expect(pushPermissionAction({ status: 'undetermined', canAskAgain: true })).toBe('prompt');
    expect(pushPermissionAction({ status: 'denied', canAskAgain: true })).toBe('prompt');
  });

  it('routes a permanent denial to device settings and hides the action once granted', () => {
    expect(pushPermissionAction({ status: 'denied', canAskAgain: false })).toBe('settings');
    expect(pushPermissionAction({ status: 'granted', canAskAgain: false })).toBe('enabled');
  });
});
