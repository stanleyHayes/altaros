import axios from 'axios';
import { ensureConnectionAvailable } from './connectivity';
import { session } from './session';
import { normalizeSessionTokenPair, type SessionTokenPair } from './session-token';

export const TOKEN_REFRESH_TIMEOUT_MS = 15_000;

export class SessionChangedDuringRefreshError extends Error {
  constructor() {
    super('The active session changed while credentials were refreshing.');
    this.name = 'SessionChangedDuringRefreshError';
  }
}

type RefreshResponse = {
  accessToken?: string;
  refreshToken?: string;
  tokens?: {
    accessToken?: string;
    refreshToken?: string;
  };
};

type RefreshEnvelope = {
  success?: boolean;
  data?: RefreshResponse;
};

/**
 * Rotate the native session as one bounded operation.
 *
 * This deliberately uses the bare Axios client so a refresh rejection cannot
 * re-enter the authenticated response interceptor. It still shares the main
 * client's offline and timeout boundaries: every request waiting on the
 * single-flight refresh must eventually settle.
 */
export async function rotateSessionTokens(
  apiBaseUrl: string,
  refreshToken: string,
): Promise<string> {
  await ensureConnectionAvailable();
  const { data } = await axios.post<RefreshResponse | RefreshEnvelope>(
    `${apiBaseUrl}/auth/refresh-token`,
    { refreshToken },
    { timeout: TOKEN_REFRESH_TIMEOUT_MS },
  );
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('The server returned an invalid session.');
  }
  const response = data as RefreshResponse & RefreshEnvelope;
  const payload = 'data' in response ? response.data : response;
  if (('success' in response && response.success !== true)
    || typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('The server returned an invalid session.');
  }
  const wireTokens = payload.tokens ?? payload;
  let tokens: SessionTokenPair;
  try {
    tokens = normalizeSessionTokenPair(wireTokens.accessToken, wireTokens.refreshToken);
  } catch {
    throw new Error('The server returned an invalid session.');
  }
  const replaced = await session.replaceTokensIfCurrent(
    refreshToken,
    tokens.accessToken,
    tokens.refreshToken,
  );
  if (!replaced) throw new SessionChangedDuringRefreshError();
  return tokens.accessToken;
}
