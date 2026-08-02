import appConfig from '../../app.json';

describe('native release presentation', () => {
  it('keeps the native and React launch surfaces on the Altar brand', () => {
    expect(appConfig.expo.splash).toEqual({
      image: './assets/icon.png',
      resizeMode: 'contain',
      backgroundColor: '#102A27',
    });
    expect(appConfig.expo.icon).toBe(appConfig.expo.splash.image);
  });

  it('uses the brand accent for native notification presentation', () => {
    const notificationPlugin = appConfig.expo.plugins.find((plugin) => Array.isArray(plugin));
    expect(notificationPlugin).toEqual([
      'expo-notifications',
      { color: '#6DD5C4' },
    ]);
  });
});
