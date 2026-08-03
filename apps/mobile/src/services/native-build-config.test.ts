type NativeBuildEnvironment = Record<string, string | undefined>;

type NativeBuildConfigModule = {
  normalizeGoogleServicesFile: (value: unknown) => string | undefined;
  resolveGoogleServicesFile: (environment?: NativeBuildEnvironment) => string | undefined;
};

const nativeBuildConfig = jest.requireActual<NativeBuildConfigModule>(
  '../../native-build-config.cjs',
);

describe('native Android build configuration', () => {
  it('passes the EAS secret file path to Expo after trimming it', () => {
    expect(
      nativeBuildConfig.resolveGoogleServicesFile({
        EAS_BUILD: 'true',
        EAS_BUILD_PLATFORM: 'android',
        GOOGLE_SERVICES_JSON: ' /tmp/eas/google-services.json ',
      }),
    ).toBe('/tmp/eas/google-services.json');
  });

  it('keeps local Expo and iOS builds usable without an Android credential file', () => {
    expect(nativeBuildConfig.resolveGoogleServicesFile({})).toBeUndefined();
    expect(
      nativeBuildConfig.resolveGoogleServicesFile({
        EAS_BUILD: 'true',
        EAS_BUILD_PLATFORM: 'ios',
      }),
    ).toBeUndefined();
  });

  it('fails closed when a remote Android build has no Firebase file', () => {
    expect(() =>
      nativeBuildConfig.resolveGoogleServicesFile({
        EAS_BUILD: 'true',
        EAS_BUILD_PLATFORM: 'android',
      }),
    ).toThrow('Android EAS builds require GOOGLE_SERVICES_JSON');
  });

  it('rejects paths containing control characters', () => {
    expect(() =>
      nativeBuildConfig.normalizeGoogleServicesFile('/tmp/google-services.json\nleak'),
    ).toThrow('valid file path');
  });
});
