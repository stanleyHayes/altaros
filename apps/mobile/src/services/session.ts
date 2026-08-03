import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  normalizeOpaqueSessionToken,
  normalizeSessionTokenPair,
  type SessionTokenPair,
} from './session-token';

const SESSION_KEY = 'altar.session';
const ACCESS_TOKEN_KEY = 'altar.accessToken';
const REFRESH_TOKEN_KEY = 'altar.refreshToken';
const USER_KEY = 'altar.user';
const REVOKED_SESSION_KEY = 'altar.sessionRevoked';
const MAX_CACHED_USER_LENGTH = 16_384;
const LEGACY_ASYNC_KEYS = ['accessToken', 'refreshToken', 'user'] as const;
let tokenMutationTail: Promise<void> = Promise.resolve();

type SessionExpiredListener = () => void;
const expiryListeners = new Set<SessionExpiredListener>();

function encodeCachedUser(user: unknown): string {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(user);
  } catch {
    throw new Error('The member profile could not be stored safely.');
  }
  if (!encoded || encoded.length > MAX_CACHED_USER_LENGTH) {
    throw new Error('The member profile could not be stored safely.');
  }
  return encoded;
}

async function getSecret(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return AsyncStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

async function setSecret(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function deleteSecret(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

function serializeTokenMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = tokenMutationTail.then(operation, operation);
  tokenMutationTail = result.then(() => undefined, () => undefined);
  return result;
}

async function persistTokens(tokens: SessionTokenPair): Promise<void> {
  // One write keeps a rotating access/refresh pair consistent if the app is
  // suspended or killed while credentials are being replaced.
  await setSecret(SESSION_KEY, JSON.stringify(tokens));
  // Remove a prior logout tombstone only after the complete replacement pair
  // is durable. A crash before this point must fail closed, not resurrect an
  // older envelope whose deletion previously failed.
  await AsyncStorage.removeItem(REVOKED_SESSION_KEY);
  // Legacy cleanup must not turn a successfully persisted new session into
  // a failed login. The envelope is authoritative on the next read.
  await Promise.allSettled([deleteSecret(ACCESS_TOKEN_KEY), deleteSecret(REFRESH_TOKEN_KEY)]);
}

async function removeLegacyAsyncSession(): Promise<void> {
  await Promise.all(LEGACY_ASYNC_KEYS.map((key) => AsyncStorage.removeItem(key)));
}

async function migrateLegacyAsyncSession(): Promise<SessionTokenPair | null> {
  if (Platform.OS === 'web') return null;
  const [accessToken, refreshToken, encodedUser] = await Promise.all(
    LEGACY_ASYNC_KEYS.map((key) => AsyncStorage.getItem(key)),
  );
  if (!accessToken && !refreshToken && !encodedUser) return null;

  let tokens: SessionTokenPair;
  try {
    tokens = normalizeSessionTokenPair(accessToken, refreshToken);
  } catch {
    await removeLegacyAsyncSession();
    return null;
  }

  await persistTokens(tokens);
  try {
    if (encodedUser) {
      const canonicalUser = encodeCachedUser(JSON.parse(encodedUser) as unknown);
      await setSecret(USER_KEY, canonicalUser);
    }
  } catch {
    // A malformed legacy profile must not block a valid token migration. The
    // authenticated launch path will restore it from /auth/me.
  } finally {
    // Old AsyncStorage credentials are backup-eligible on Android. Remove all
    // three keys even when only the cached profile was malformed.
    await removeLegacyAsyncSession();
  }
  return tokens;
}

async function clearSessionUnlocked(): Promise<void> {
  const results = await Promise.allSettled([
    AsyncStorage.setItem(REVOKED_SESSION_KEY, '1'),
    deleteSecret(ACCESS_TOKEN_KEY),
    deleteSecret(REFRESH_TOKEN_KEY),
    deleteSecret(SESSION_KEY),
    deleteSecret(USER_KEY),
    // Remove keys used by the pre-SecureStore build after migration.
    AsyncStorage.removeItem('accessToken'),
    AsyncStorage.removeItem('refreshToken'),
    AsyncStorage.removeItem('user'),
  ]);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failure) throw failure.reason;
}

export const session = {
  async getAccessToken(): Promise<string | null> {
    await tokenMutationTail;
    return (await readTokensUnlocked())?.accessToken ?? null;
  },
  async getRefreshToken(): Promise<string | null> {
    await tokenMutationTail;
    return (await readTokensUnlocked())?.refreshToken ?? null;
  },

  async commitAuthenticatedSessionIf(
    accessToken: string,
    refreshToken: string,
    user: unknown,
    canCommit: () => boolean = () => true,
  ): Promise<boolean> {
    const tokens = normalizeSessionTokenPair(accessToken, refreshToken);
    const encodedUser = encodeCachedUser(user);
    return serializeTokenMutation(async () => {
      if (!canCommit()) return false;
      try {
        await persistTokens(tokens);
        if (!canCommit()) {
          await clearSessionUnlocked();
          return false;
        }
        await setSecret(USER_KEY, encodedUser);
        if (!canCommit()) {
          await clearSessionUnlocked();
          return false;
        }
        return true;
      } catch (error) {
        await clearSessionUnlocked().catch(() => undefined);
        throw error;
      }
    });
  },

  async replaceTokensIfCurrent(
    expectedRefreshToken: string,
    accessToken: string,
    refreshToken: string,
  ): Promise<boolean> {
    const expected = normalizeOpaqueSessionToken(expectedRefreshToken);
    const replacement = normalizeSessionTokenPair(accessToken, refreshToken);
    return serializeTokenMutation(async () => {
      const current = await readTokensUnlocked();
      if (current?.refreshToken !== expected) return false;
      await persistTokens(replacement);
      return true;
    });
  },

  async getUser<T>(): Promise<T | null> {
    const value = await getSecret(USER_KEY);
    if (!value) return null;
    if (value.length > MAX_CACHED_USER_LENGTH) {
      await deleteSecret(USER_KEY);
      return null;
    }
    try {
      return JSON.parse(value) as T;
    } catch {
      await deleteSecret(USER_KEY);
      return null;
    }
  },

  async replaceUserIfRefreshTokenCurrent(
    expectedRefreshToken: string,
    user: unknown,
    canCommit: () => boolean = () => true,
  ): Promise<boolean> {
    const expected = normalizeOpaqueSessionToken(expectedRefreshToken);
    const encodedUser = encodeCachedUser(user);
    return serializeTokenMutation(async () => {
      if (!canCommit()) return false;
      const current = await readTokensUnlocked();
      if (current?.refreshToken !== expected || !canCommit()) return false;
      await setSecret(USER_KEY, encodedUser);
      return canCommit();
    });
  },

  async clear(): Promise<void> {
    // This marker contains no credential material. It makes logout fail closed
    // across restarts if a device keychain refuses one of the deletions below.
    await serializeTokenMutation(clearSessionUnlocked);
  },

  async clearIfRefreshTokenCurrent(
    expectedRefreshToken: string,
    notifyExpired = false,
  ): Promise<boolean> {
    const expected = normalizeOpaqueSessionToken(expectedRefreshToken);
    return serializeTokenMutation(async () => {
      const current = await readTokensUnlocked();
      if (current?.refreshToken !== expected) return false;
      try {
        await clearSessionUnlocked();
      } finally {
        // Once this matching family is authoritatively rejected, private UI
        // must unmount even when a keychain deletion reports a secondary error.
        if (notifyExpired) session.notifyExpired();
      }
      return true;
    });
  },

  onExpired(listener: SessionExpiredListener): () => void {
    expiryListeners.add(listener);
    return () => expiryListeners.delete(listener);
  },

  notifyExpired(): void {
    expiryListeners.forEach((listener) => listener());
  },
};

async function readTokensUnlocked(): Promise<SessionTokenPair | null> {
  if (await AsyncStorage.getItem(REVOKED_SESSION_KEY)) {
    // Best-effort cleanup is repeated on every read, but a stale secure
    // envelope is never accepted while the revocation marker exists.
    await Promise.allSettled([
      deleteSecret(ACCESS_TOKEN_KEY),
      deleteSecret(REFRESH_TOKEN_KEY),
      deleteSecret(SESSION_KEY),
      removeLegacyAsyncSession(),
    ]);
    return null;
  }
  const encoded = await getSecret(SESSION_KEY);
  if (encoded) {
    try {
      const parsed = JSON.parse(encoded) as Partial<SessionTokenPair>;
      const tokens = normalizeSessionTokenPair(parsed.accessToken, parsed.refreshToken);
      await removeLegacyAsyncSession().catch(() => undefined);
      return tokens;
    } catch {
      // Invalid session data is cleared below alongside legacy keys.
    }
    await deleteSecret(SESSION_KEY);
  }

  // One-time migration from the intermediate SecureStore build. Only migrate
  // a complete pair; combining one old token with one new token can revoke a
  // token family.
  const [accessToken, refreshToken] = await Promise.all([
    getSecret(ACCESS_TOKEN_KEY),
    getSecret(REFRESH_TOKEN_KEY),
  ]);
  let tokens: SessionTokenPair;
  try {
    tokens = normalizeSessionTokenPair(accessToken, refreshToken);
  } catch {
    await Promise.all([deleteSecret(ACCESS_TOKEN_KEY), deleteSecret(REFRESH_TOKEN_KEY)]);
    return migrateLegacyAsyncSession();
  }
  await persistTokens(tokens);
  await removeLegacyAsyncSession().catch(() => undefined);
  return tokens;
}
