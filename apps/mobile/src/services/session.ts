import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const ACCESS_TOKEN_KEY = 'altar.accessToken';
const REFRESH_TOKEN_KEY = 'altar.refreshToken';
const USER_KEY = 'altar.user';

type SessionExpiredListener = () => void;
const expiryListeners = new Set<SessionExpiredListener>();

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

export const session = {
  getAccessToken: () => getSecret(ACCESS_TOKEN_KEY),
  getRefreshToken: () => getSecret(REFRESH_TOKEN_KEY),

  async setTokens(accessToken: string, refreshToken: string): Promise<void> {
    await Promise.all([
      setSecret(ACCESS_TOKEN_KEY, accessToken),
      setSecret(REFRESH_TOKEN_KEY, refreshToken),
    ]);
  },

  async getUser<T>(): Promise<T | null> {
    const value = await AsyncStorage.getItem(USER_KEY);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      await AsyncStorage.removeItem(USER_KEY);
      return null;
    }
  },

  setUser: (user: unknown) => AsyncStorage.setItem(USER_KEY, JSON.stringify(user)),

  async clear(): Promise<void> {
    await Promise.all([
      deleteSecret(ACCESS_TOKEN_KEY),
      deleteSecret(REFRESH_TOKEN_KEY),
      AsyncStorage.removeItem(USER_KEY),
      // Remove keys used by the pre-SecureStore build after migration.
      AsyncStorage.removeItem('accessToken'),
      AsyncStorage.removeItem('refreshToken'),
      AsyncStorage.removeItem('user'),
    ]);
  },

  onExpired(listener: SessionExpiredListener): () => void {
    expiryListeners.add(listener);
    return () => expiryListeners.delete(listener);
  },

  notifyExpired(): void {
    expiryListeners.forEach((listener) => listener());
  },
};

