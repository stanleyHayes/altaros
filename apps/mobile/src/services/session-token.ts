export const MAX_SESSION_TOKEN_LENGTH = 4_096;

export interface SessionTokenPair {
  accessToken: string;
  refreshToken: string;
}

function validOpaqueToken(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_SESSION_TOKEN_LENGTH
    // JWTs and the gateway's opaque credentials are visible ASCII. Rejecting
    // spaces/control characters prevents invalid Authorization headers and
    // avoids silently changing credential identity with trim().
    && /^[\x21-\x7E]+$/.test(value);
}

export function normalizeOpaqueSessionToken(value: unknown): string {
  if (!validOpaqueToken(value)) throw new Error('The server returned an invalid session.');
  return value;
}

export function normalizeSessionTokenPair(
  accessToken: unknown,
  refreshToken: unknown,
): SessionTokenPair {
  const normalizedAccessToken = normalizeOpaqueSessionToken(accessToken);
  const normalizedRefreshToken = normalizeOpaqueSessionToken(refreshToken);
  if (normalizedAccessToken === normalizedRefreshToken) {
    throw new Error('The server returned an invalid session.');
  }
  return { accessToken: normalizedAccessToken, refreshToken: normalizedRefreshToken };
}
