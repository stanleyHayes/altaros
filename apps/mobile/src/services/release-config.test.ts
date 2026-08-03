import appConfig from '../../app.json';
import packageConfig from '../../package.json';

describe('native release presentation', () => {
  it('uses an app-local entrypoint in the monorepo', () => {
    expect(packageConfig.main).toBe('./index.ts');
  });

  it('keeps the native and React launch surfaces on the Altar brand', () => {
    const splashPlugin = appConfig.expo.plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen',
    );
    expect(splashPlugin).toEqual([
      'expo-splash-screen',
      {
        image: './assets/icon.png',
        imageWidth: 180,
        resizeMode: 'contain',
        backgroundColor: '#102A27',
      },
    ]);
    expect(appConfig.expo.icon).toBe('./assets/icon.png');
    expect(appConfig.expo.backgroundColor).toBe('#F7FBF8');
    expect(appConfig.expo.primaryColor).toBe('#157F73');
    expect(appConfig.expo.userInterfaceStyle).toBe('light');
    expect(packageConfig.dependencies['expo-system-ui']).toBe('~57.0.2');
  });

  it('uses the brand accent for native notification presentation', () => {
    const notificationPlugin = appConfig.expo.plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-notifications',
    );
    expect(notificationPlugin).toEqual([
      'expo-notifications',
      { color: '#6DD5C4' },
    ]);
  });

  it('does not request broad legacy external-storage access', () => {
    expect(appConfig.expo.android.blockedPermissions).toEqual([
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.USE_BIOMETRIC',
      'android.permission.USE_FINGERPRINT',
    ]);
    expect(appConfig.expo.android.allowBackup).toBe(false);
  });

  it('declares the standard app cryptography as export exempt on iOS', () => {
    expect(appConfig.expo.ios.config.usesNonExemptEncryption).toBe(false);
  });

  it('does not advertise biometric access that session storage never requests', () => {
    const secureStorePlugin = appConfig.expo.plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-secure-store',
    );
    expect(secureStorePlugin).toEqual([
      'expo-secure-store',
      { faceIDPermission: false },
    ]);
  });
});
