import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearTokens } from './api';
import { session } from './session';

const secure = SecureStore as jest.Mocked<typeof SecureStore>;
let values: Record<string, string>;

async function seedSession(accessToken: string, refreshToken: string): Promise<void> {
  await session.commitAuthenticatedSessionIf(
    accessToken,
    refreshToken,
    { id: 'seed-member', churchId: 'seed-church' },
  );
}

describe('native secure session storage', () => {
  beforeEach(async () => {
    values = {};
    jest.clearAllMocks();
    await AsyncStorage.clear();
    secure.getItemAsync.mockImplementation(async (key) => values[key] ?? null);
    secure.setItemAsync.mockImplementation(async (key, value) => { values[key] = value; });
    secure.deleteItemAsync.mockImplementation(async (key) => { delete values[key]; });
  });

  it('stores rotating tokens as one consistent envelope', async () => {
    await seedSession('access-new', 'refresh-new');

    expect(JSON.parse(values['altar.session'])).toEqual({
      accessToken: 'access-new', refreshToken: 'refresh-new',
    });
    await expect(session.getAccessToken()).resolves.toBe('access-new');
    await expect(session.getRefreshToken()).resolves.toBe('refresh-new');
  });

  it('commits tokens and their matching cached identity in one serialized lane', async () => {
    await expect(session.commitAuthenticatedSessionIf(
      'access-new', 'refresh-new', { id: 'member-1' }, () => true,
    )).resolves.toBe(true);

    await expect(session.getAccessToken()).resolves.toBe('access-new');
    await expect(session.getUser()).resolves.toEqual({ id: 'member-1' });
  });

  it('refuses a stale authentication attempt before writing credentials', async () => {
    await expect(session.commitAuthenticatedSessionIf(
      'access-stale', 'refresh-stale', { id: 'member-stale' }, () => false,
    )).resolves.toBe(false);

    await expect(session.getAccessToken()).resolves.toBeNull();
    await expect(session.getUser()).resolves.toBeNull();
  });

  it('rolls back both credentials and profile when an attempt expires during storage', async () => {
    let active = true;
    secure.setItemAsync.mockImplementation(async (key, value) => {
      values[key] = value;
      if (key === 'altar.session') active = false;
    });

    await expect(session.commitAuthenticatedSessionIf(
      'access-stale', 'refresh-stale', { id: 'member-stale' }, () => active,
    )).resolves.toBe(false);

    await expect(session.getAccessToken()).resolves.toBeNull();
    await expect(session.getUser()).resolves.toBeNull();
  });

  it('serializes token writes so a slower old write cannot overwrite a newer login', async () => {
    let releaseOld!: () => void;
    const oldCanFinish = new Promise<void>((resolve) => { releaseOld = resolve; });
    secure.setItemAsync.mockImplementation(async (key, value) => {
      if (key === 'altar.session' && value.includes('access-old')) await oldCanFinish;
      values[key] = value;
    });

    const oldWrite = seedSession('access-old', 'refresh-old');
    await Promise.resolve();
    const newWrite = seedSession('access-new', 'refresh-new');
    await Promise.resolve();
    expect(secure.setItemAsync).toHaveBeenCalledTimes(1);

    releaseOld();
    await Promise.all([oldWrite, newWrite]);
    await expect(session.getAccessToken()).resolves.toBe('access-new');
    await expect(session.getRefreshToken()).resolves.toBe('refresh-new');
  });

  it('does not replace tokens after logout or after a newer login', async () => {
    await seedSession('access-old', 'refresh-old');
    await session.clear();
    await expect(session.replaceTokensIfCurrent(
      'refresh-old', 'access-rotated', 'refresh-rotated',
    )).resolves.toBe(false);
    await expect(session.getAccessToken()).resolves.toBeNull();

    await seedSession('access-new', 'refresh-new');
    await expect(session.replaceTokensIfCurrent(
      'refresh-old', 'access-rotated', 'refresh-rotated',
    )).resolves.toBe(false);
    await expect(session.getAccessToken()).resolves.toBe('access-new');
    await expect(session.getRefreshToken()).resolves.toBe('refresh-new');
  });

  it('atomically replaces only the refresh-token family that initiated rotation', async () => {
    await seedSession('access-old', 'refresh-old');
    await expect(session.replaceTokensIfCurrent(
      'refresh-old', 'access-next', 'refresh-next',
    )).resolves.toBe(true);
    await expect(session.getAccessToken()).resolves.toBe('access-next');
    await expect(session.getRefreshToken()).resolves.toBe('refresh-next');
  });

  it('expires only the refresh-token family rejected by the gateway', async () => {
    const listener = jest.fn();
    const unsubscribe = session.onExpired(listener);
    await seedSession('access-new', 'refresh-new');

    await expect(session.clearIfRefreshTokenCurrent('refresh-old', true)).resolves.toBe(false);
    await expect(session.getAccessToken()).resolves.toBe('access-new');
    expect(listener).not.toHaveBeenCalled();

    await expect(session.clearIfRefreshTokenCurrent('refresh-new', true)).resolves.toBe(true);
    await expect(session.getAccessToken()).resolves.toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('deletes a malformed token envelope instead of accepting truthy non-strings', async () => {
    values['altar.session'] = JSON.stringify({ accessToken: 123, refreshToken: ['not-a-token'] });

    await expect(session.getAccessToken()).resolves.toBeNull();
    expect(values['altar.session']).toBeUndefined();
  });

  it('deletes an unsafe stored envelope before it can reach an Authorization header', async () => {
    values['altar.session'] = JSON.stringify({
      accessToken: 'access\nInjected: header', refreshToken: 'refresh-safe',
    });

    await expect(session.getAccessToken()).resolves.toBeNull();
    expect(values['altar.session']).toBeUndefined();
  });

  it('refuses unsafe credentials before writing secure storage', async () => {
    await expect(session.commitAuthenticatedSessionIf(
      ' access', 'refresh-safe', { id: 'member-1' },
    )).rejects.toThrow('invalid session');
    expect(secure.setItemAsync).not.toHaveBeenCalled();
  });

  it('migrates only a complete legacy token pair', async () => {
    values['altar.accessToken'] = 'legacy-access';
    values['altar.refreshToken'] = 'legacy-refresh';

    await expect(session.getAccessToken()).resolves.toBe('legacy-access');
    expect(JSON.parse(values['altar.session'])).toEqual({
      accessToken: 'legacy-access', refreshToken: 'legacy-refresh',
    });
    expect(values['altar.accessToken']).toBeUndefined();
    expect(values['altar.refreshToken']).toBeUndefined();
  });

  it('rejects a partial legacy pair instead of mixing token families', async () => {
    values['altar.accessToken'] = 'orphaned-access';
    await expect(session.getAccessToken()).resolves.toBeNull();
    expect(values['altar.accessToken']).toBeUndefined();
    expect(values['altar.session']).toBeUndefined();
  });

  it('deletes a complete but unsafe legacy pair instead of migrating it', async () => {
    values['altar.accessToken'] = 'legacy-access';
    values['altar.refreshToken'] = 'legacy refresh';

    await expect(session.getAccessToken()).resolves.toBeNull();
    expect(values['altar.accessToken']).toBeUndefined();
    expect(values['altar.refreshToken']).toBeUndefined();
    expect(values['altar.session']).toBeUndefined();
  });

  it('keeps the cached member profile in native secure storage', async () => {
    await session.commitAuthenticatedSessionIf(
      'access-current', 'refresh-current', { id: 'member-1', churchId: 'church-1' },
    );
    await expect(session.getUser()).resolves.toEqual({ id: 'member-1', churchId: 'church-1' });
    expect(secure.setItemAsync).toHaveBeenCalledWith(
      'altar.user',
      JSON.stringify({ id: 'member-1', churchId: 'church-1' }),
      expect.objectContaining({ keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
    );
  });

  it('replaces a reconciled profile only for the token family that requested it', async () => {
    await session.commitAuthenticatedSessionIf(
      'access-old', 'refresh-old', { id: 'member-old' }, () => true,
    );

    await expect(session.replaceUserIfRefreshTokenCurrent(
      'refresh-old', { id: 'member-updated' }, () => true,
    )).resolves.toBe(true);
    await expect(session.getUser()).resolves.toEqual({ id: 'member-updated' });

    await session.commitAuthenticatedSessionIf(
      'access-new', 'refresh-new', { id: 'member-new' }, () => true,
    );
    await expect(session.replaceUserIfRefreshTokenCurrent(
      'refresh-old', { id: 'member-stale' }, () => true,
    )).resolves.toBe(false);
    await expect(session.getUser()).resolves.toEqual({ id: 'member-new' });
  });

  it('refuses a reconciled profile when its session revision is no longer active', async () => {
    await session.commitAuthenticatedSessionIf(
      'access-current', 'refresh-current', { id: 'member-current' }, () => true,
    );

    await expect(session.replaceUserIfRefreshTokenCurrent(
      'refresh-current', { id: 'member-stale' }, () => false,
    )).resolves.toBe(false);
    await expect(session.getUser()).resolves.toEqual({ id: 'member-current' });
  });

  it('refuses an oversized profile before writing secure storage', async () => {
    await expect(session.commitAuthenticatedSessionIf(
      'access-current', 'refresh-current', { id: 'member-1', name: 'x'.repeat(17_000) },
    ))
      .rejects.toThrow('could not be stored safely');
    expect(secure.setItemAsync).not.toHaveBeenCalled();
  });

  it('deletes an oversized cached profile before parsing or mounting it', async () => {
    values['altar.user'] = 'x'.repeat(17_000);
    await expect(session.getUser()).resolves.toBeNull();
    expect(values['altar.user']).toBeUndefined();
  });

  it('attempts every credential deletion when one secure-store key fails', async () => {
    secure.deleteItemAsync.mockImplementation(async (key) => {
      if (key === 'altar.accessToken') throw new Error('keychain unavailable');
      delete values[key];
    });

    await expect(session.clear()).rejects.toThrow('keychain unavailable');

    expect(secure.deleteItemAsync).toHaveBeenCalledWith('altar.accessToken');
    expect(secure.deleteItemAsync).toHaveBeenCalledWith('altar.refreshToken');
    expect(secure.deleteItemAsync).toHaveBeenCalledWith('altar.session');
    expect(secure.deleteItemAsync).toHaveBeenCalledWith('altar.user');
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('accessToken');
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('refreshToken');
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('user');
  });

  it('notifies React of authoritative expiry even when storage cleanup fails', async () => {
    const listener = jest.fn();
    const unsubscribe = session.onExpired(listener);
    const clearSpy = jest.spyOn(session, 'clear').mockRejectedValueOnce(new Error('storage failed'));

    await expect(clearTokens(true)).rejects.toThrow('storage failed');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    clearSpy.mockRestore();
  });

  it('never resurrects a secure envelope whose logout deletion failed', async () => {
    await seedSession('stale-access', 'stale-refresh');
    secure.deleteItemAsync.mockImplementation(async (key) => {
      if (key === 'altar.session') throw new Error('keychain unavailable');
      delete values[key];
    });

    await expect(session.clear()).rejects.toThrow('keychain unavailable');
    expect(values['altar.session']).toBeDefined();
    await expect(session.getAccessToken()).resolves.toBeNull();
    await expect(session.getRefreshToken()).resolves.toBeNull();
  });
});
