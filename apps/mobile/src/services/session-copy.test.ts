import {
  credentialStorageCopy,
  sessionPlatform,
  sessionStorageLabel,
} from './session-copy';

describe('member-facing session storage copy', () => {
  it('describes native credential storage without promising it on web', () => {
    expect(credentialStorageCopy('native')).toContain('secure credential store');
    expect(credentialStorageCopy('web')).toBe('Using a shared browser? Sign out when you finish.');
    expect(credentialStorageCopy('web')).not.toMatch(/secure|encrypted/i);
  });

  it('labels the profile session truthfully on each runtime', () => {
    expect(sessionStorageLabel('native')).toBe('Secure device storage');
    expect(sessionStorageLabel('web')).toBe('Browser session');
  });

  it('maps every non-web Expo platform to the native security contract', () => {
    expect(sessionPlatform('web')).toBe('web');
    expect(sessionPlatform('ios')).toBe('native');
    expect(sessionPlatform('android')).toBe('native');
  });
});
