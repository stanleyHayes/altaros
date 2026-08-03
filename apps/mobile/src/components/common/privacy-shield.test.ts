import type { AppStateStatus } from 'react-native';
import { shouldShowPrivacyShield } from './PrivacyShield';

describe('background privacy shield', () => {
  it('reveals app content only while the app is active', () => {
    expect(shouldShowPrivacyShield('active')).toBe(false);
    expect(shouldShowPrivacyShield('inactive')).toBe(true);
    expect(shouldShowPrivacyShield('background')).toBe(true);
    expect(shouldShowPrivacyShield('unknown')).toBe(true);
    expect(shouldShowPrivacyShield('extension')).toBe(true);
  });

  it('fails closed for a future app-state value', () => {
    expect(shouldShowPrivacyShield('suspended' as AppStateStatus)).toBe(true);
  });
});
