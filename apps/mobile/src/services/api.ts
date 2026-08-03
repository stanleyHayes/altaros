import axios from 'axios';
import type { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import { session } from './session';
import { isAuthenticationRejection } from './api-error';
import { ensureConnectionAvailable } from './connectivity';
import { rotateSessionTokens } from './token-refresh';
import { coalesceSessionRefresh } from './session-refresh-coordinator';
import { resolveApiBaseUrl } from './api-config';

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
const API_BASE_URL = resolveApiBaseUrl(process.env.EXPO_PUBLIC_API_URL, __DEV__);

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

type SessionBoundRequestConfig = AxiosRequestConfig & { _sessionBound: true };

export function sessionBoundRequest(accessToken: string): SessionBoundRequestConfig {
  return {
    _sessionBound: true,
    headers: { Authorization: `Bearer ${accessToken}` },
  };
}

export function shouldAttachCurrentSessionToken(existingAuthorization: unknown): boolean {
  return typeof existingAuthorization !== 'string' || existingAuthorization.trim() === '';
}

export async function resolveSessionAuthorization(
  existingAuthorization: unknown,
  readAccessToken: () => Promise<string | null>,
): Promise<string | undefined> {
  // Session-bound work already carries the immutable initiating bearer. Do
  // not queue that request behind a concurrent logout/keychain mutation merely
  // to read a token that must not replace its explicit Authorization header.
  if (!shouldAttachCurrentSessionToken(existingAuthorization)) {
    return existingAuthorization as string;
  }
  try {
    const token = await readAccessToken();
    return token ? `Bearer ${token}` : undefined;
  } catch {
    return undefined;
  }
}

export function shouldRetryWithRefreshedSession(
  status: number | undefined,
  request: { _retry?: boolean; _sessionBound?: boolean } | undefined,
): boolean {
  return status === 401 && Boolean(request) && !request?._retry && !request?._sessionBound;
}

// Request interceptor: attach JWT token
api.interceptors.request.use(
  async (config) => {
    await ensureConnectionAvailable();
    const authorization = await resolveSessionAuthorization(
      config.headers.Authorization,
      () => session.getAccessToken(),
    );
    if (authorization) {
      config.headers.Authorization = authorization;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

type RetryableRequest = InternalAxiosRequestConfig & {
  _retry?: boolean;
  _sessionBound?: boolean;
};

// Response interceptor: handle 401 and token refresh
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableRequest | undefined;

    // Logout and background device registration belong to the exact bearer
    // family captured by their initiator. Replaying either operation after a
    // refresh could move an old request into a replacement member session.
    if (error.response?.status === 401 && originalRequest?._sessionBound) {
      return Promise.reject(error);
    }

    if (shouldRetryWithRefreshedSession(error.response?.status, originalRequest) && originalRequest) {
      originalRequest._retry = true;

      // A 401 while signing in is a credential response, not an expired
      // session. Preserve that original server error when no refresh token is
      // present instead of replacing it with an internal token error.
      let refreshToken: string | null;
      try {
        refreshToken = await session.getRefreshToken();
      } catch {
        return Promise.reject(error);
      }
      if (!refreshToken) return Promise.reject(error);

      try {
        // Refresh tokens rotate and are single-use. Coalesce simultaneous 401s
        // so two requests never replay one token and revoke the whole family.
        const accessToken = await coalesceSessionRefresh(
          refreshToken,
          () => rotateSessionTokens(API_BASE_URL, refreshToken),
        );
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        if (isAuthenticationRejection(refreshError)) {
          // The rejection belongs to the family that initiated this refresh.
          // A newer login may have completed while the request was in flight;
          // never clear that replacement session or unmount its private UI.
          await session.clearIfRefreshTokenCurrent(refreshToken, true).catch(() => undefined);
        }
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  },
);

async function clearTokens(notify = false) {
  try {
    await session.clear();
  } finally {
    // An authoritative 401/403 must remove the authenticated UI even if one
    // device-storage deletion fails. Keeping the member inside after the
    // gateway ended the session is both misleading and unsafe.
    if (notify) session.notifyExpired();
  }
}

export { API_BASE_URL, clearTokens };
export default api;
