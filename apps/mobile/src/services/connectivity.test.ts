import NetInfo from '@react-native-community/netinfo';
import {
  ensureConnectionAvailable,
  isKnownOffline,
  KnownOfflineError,
  connectivityErrorMessage,
} from './connectivity';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { fetch: jest.fn() },
}));

const mockedNetInfo = NetInfo as jest.Mocked<typeof NetInfo>;

describe('known-offline request boundary', () => {
  beforeEach(() => jest.clearAllMocks());

  it('treats either definitive negative signal as offline', () => {
    expect(isKnownOffline({ isConnected: false, isInternetReachable: null })).toBe(true);
    expect(isKnownOffline({ isConnected: true, isInternetReachable: false })).toBe(true);
  });

  it('does not block unknown reachability', () => {
    expect(isKnownOffline({ isConnected: null, isInternetReachable: null })).toBe(false);
    expect(isKnownOffline({ isConnected: true, isInternetReachable: null })).toBe(false);
  });

  it('rejects immediately when NetInfo confirms the device is offline', async () => {
    mockedNetInfo.fetch.mockResolvedValueOnce({ isConnected: false, isInternetReachable: false } as never);
    await expect(ensureConnectionAvailable()).rejects.toBeInstanceOf(KnownOfflineError);
  });

  it('allows requests when reachability is online or cannot be determined', async () => {
    mockedNetInfo.fetch
      .mockResolvedValueOnce({ isConnected: true, isInternetReachable: true } as never)
      .mockRejectedValueOnce(new Error('reachability unavailable'));
    await expect(ensureConnectionAvailable()).resolves.toBeUndefined();
    await expect(ensureConnectionAvailable()).resolves.toBeUndefined();
  });

  it('keeps definitive offline copy distinct from unrelated service failures', () => {
    expect(connectivityErrorMessage(new KnownOfflineError(), 'Service unavailable'))
      .toBe('You are offline. Reconnect and try again.');
    expect(connectivityErrorMessage(new Error('internal detail'), 'Service unavailable'))
      .toBe('Service unavailable');
  });
});
