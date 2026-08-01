import axios from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { session } from './session';

// The Go gateway is the single origin. It serves auth, members and finance
// directly and forwards anything not yet ported to the legacy TypeScript API,
// so this app never needs to know which domains have moved.
//
// The previous value pointed at localhost:4000/api, which was neither the port
// nor the path any API has ever served — this app could not have reached a
// backend at all.
//
// localhost only resolves to the dev machine from an iOS simulator or the web
// build. A physical device or an Android emulator needs the machine's LAN
// address, which is why this is overridable rather than hard-coded.
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (__DEV__ ? 'http://localhost:8080/api/v1' : 'https://api.altar-os.com/api/v1');

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: attach JWT token
api.interceptors.request.use(
  async (config) => {
    try {
      const token = await session.getAccessToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (error) {
      console.warn('Failed to retrieve the access token:', error);
    }
    return config;
  },
  (error) => Promise.reject(error),
);

type RetryableRequest = InternalAxiosRequestConfig & { _retry?: boolean };
let refreshPromise: Promise<string> | null = null;

async function rotateTokens(): Promise<string> {
  const refreshToken = await session.getRefreshToken();
  if (!refreshToken) throw new Error('No refresh token is available.');

  const { data } = await axios.post(`${API_BASE_URL}/auth/refresh-token`, {
    refreshToken,
  });
  const tokens = data.tokens ?? data;
  if (!tokens.accessToken || !tokens.refreshToken) {
    throw new Error('The server returned an invalid session.');
  }
  await session.setTokens(tokens.accessToken, tokens.refreshToken);
  if (data.user) await session.setUser(data.user);
  return tokens.accessToken as string;
}

// Response interceptor: handle 401 and token refresh
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableRequest | undefined;

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        // Refresh tokens rotate and are single-use. Coalesce simultaneous 401s
        // so two requests never replay one token and revoke the whole family.
        refreshPromise ??= rotateTokens().finally(() => {
          refreshPromise = null;
        });
        const accessToken = await refreshPromise;
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        await clearTokens(true);
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  },
);

async function clearTokens(notify = false) {
  await session.clear();
  if (notify) session.notifyExpired();
}

export { API_BASE_URL, clearTokens };
export default api;
