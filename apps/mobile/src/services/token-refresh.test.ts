import axios from 'axios';
import NetInfo from '@react-native-community/netinfo';
import { session } from './session';
import {
  rotateSessionTokens,
  SessionChangedDuringRefreshError,
  TOKEN_REFRESH_TIMEOUT_MS,
} from './token-refresh';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { fetch: jest.fn() },
}));

const mockedNetInfo = NetInfo as jest.Mocked<typeof NetInfo>;

describe('rotating session refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedNetInfo.fetch.mockResolvedValue({
      type: 'wifi',
      isConnected: true,
      isInternetReachable: true,
      details: null,
    } as never);
  });

  it('bounds the bare refresh request and persists the returned token pair', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        success: true,
        data: { tokens: { accessToken: 'access-next', refreshToken: 'refresh-next' } },
      },
    });
    const persist = jest.spyOn(session, 'replaceTokensIfCurrent').mockResolvedValue(true);

    await expect(rotateSessionTokens('https://api.example.test/v1', 'refresh-old'))
      .resolves.toBe('access-next');

    expect(post).toHaveBeenCalledWith(
      'https://api.example.test/v1/auth/refresh-token',
      { refreshToken: 'refresh-old' },
      { timeout: TOKEN_REFRESH_TIMEOUT_MS },
    );
    expect(persist).toHaveBeenCalledWith('refresh-old', 'access-next', 'refresh-next');
  });

  it('fails fast while definitively offline without sending the refresh token', async () => {
    mockedNetInfo.fetch.mockResolvedValue({
      type: 'none',
      isConnected: false,
      isInternetReachable: false,
      details: null,
    } as never);
    const post = jest.spyOn(axios, 'post');

    await expect(rotateSessionTokens('https://api.example.test/v1', 'refresh-secret'))
      .rejects.toMatchObject({ code: 'KNOWN_OFFLINE' });
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects malformed rotations without overwriting the current session', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({ data: { accessToken: 'access-only' } });
    const persist = jest.spyOn(session, 'replaceTokensIfCurrent').mockResolvedValue(true);

    await expect(rotateSessionTokens('https://api.example.test/v1', 'refresh-old'))
      .rejects.toThrow('The server returned an invalid session.');
    expect(persist).not.toHaveBeenCalled();
  });

  it('rejects unsafe rotated credentials before secure persistence', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      data: { tokens: { accessToken: 'next\nInjected: value', refreshToken: 'refresh-next' } },
    });
    const persist = jest.spyOn(session, 'replaceTokensIfCurrent').mockResolvedValue(true);

    await expect(rotateSessionTokens('https://api.example.test/v1', 'refresh-old'))
      .rejects.toThrow('invalid session');
    expect(persist).not.toHaveBeenCalled();
  });

  it('rejects an unsuccessful 200 envelope without replacing credentials', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      data: { success: false, data: { tokens: { accessToken: 'next', refreshToken: 'next-r' } } },
    });
    const persist = jest.spyOn(session, 'replaceTokensIfCurrent').mockResolvedValue(true);

    await expect(rotateSessionTokens('https://api.example.test/v1', 'refresh-old'))
      .rejects.toThrow('invalid session');
    expect(persist).not.toHaveBeenCalled();
  });

  it('rejects a stale rotation without replaying under a newer session', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      data: { tokens: { accessToken: 'old-family-access-next', refreshToken: 'old-family-refresh-next' } },
    });
    const persist = jest.spyOn(session, 'replaceTokensIfCurrent').mockResolvedValue(false);

    await expect(rotateSessionTokens('https://api.example.test/v1', 'old-family-refresh'))
      .rejects.toBeInstanceOf(SessionChangedDuringRefreshError);
    expect(persist).toHaveBeenCalledWith(
      'old-family-refresh', 'old-family-access-next', 'old-family-refresh-next',
    );
  });
});
