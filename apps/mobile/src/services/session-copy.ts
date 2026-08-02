type SessionPlatform = 'web' | 'native';

export function sessionPlatform(value: string): SessionPlatform {
  return value === 'web' ? 'web' : 'native';
}

export function credentialStorageCopy(platform: SessionPlatform): string {
  return platform === 'web'
    ? 'Using a shared browser? Sign out when you finish.'
    : "Your credentials and member profile use this device's secure credential store.";
}

export function sessionStorageLabel(platform: SessionPlatform): string {
  return platform === 'web' ? 'Browser session' : 'Secure device storage';
}
