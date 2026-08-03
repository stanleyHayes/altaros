import {
  sessionBoundRequest,
  resolveSessionAuthorization,
  shouldAttachCurrentSessionToken,
  shouldRetryWithRefreshedSession,
} from './api';

describe('session-bound request ownership', () => {
  it('captures an exact bearer and marks it as non-transferable', () => {
    expect(sessionBoundRequest('family-a-access')).toEqual({
      _sessionBound: true,
      headers: { Authorization: 'Bearer family-a-access' },
    });
  });

  it('preserves an explicitly captured Authorization header', () => {
    expect(shouldAttachCurrentSessionToken(undefined)).toBe(true);
    expect(shouldAttachCurrentSessionToken('')).toBe(true);
    expect(shouldAttachCurrentSessionToken('Bearer family-a-access')).toBe(false);
  });

  it('sends an explicit bearer without waiting on the mutable session vault', async () => {
    const readAccessToken = jest.fn(async () => 'family-new-access');
    await expect(resolveSessionAuthorization(
      'Bearer family-old-access',
      readAccessToken,
    )).resolves.toBe('Bearer family-old-access');
    expect(readAccessToken).not.toHaveBeenCalled();
  });

  it('reads the current bearer only for ordinary authenticated requests', async () => {
    const readAccessToken = jest.fn(async () => 'family-current-access');
    await expect(resolveSessionAuthorization(undefined, readAccessToken))
      .resolves.toBe('Bearer family-current-access');
    expect(readAccessToken).toHaveBeenCalledTimes(1);

    await expect(resolveSessionAuthorization(undefined, async () => { throw new Error('vault unavailable'); }))
      .resolves.toBeUndefined();
  });

  it('never migrates a session-bound 401 through token refresh', () => {
    expect(shouldRetryWithRefreshedSession(401, { _sessionBound: true })).toBe(false);
    expect(shouldRetryWithRefreshedSession(401, {})).toBe(true);
    expect(shouldRetryWithRefreshedSession(401, { _retry: true })).toBe(false);
    expect(shouldRetryWithRefreshedSession(500, {})).toBe(false);
  });
});
