import { MAX_SESSION_TOKEN_LENGTH, normalizeSessionTokenPair } from './session-token';

describe('session credential boundary', () => {
  it('accepts distinct visible-ASCII opaque credentials without rewriting them', () => {
    expect(normalizeSessionTokenPair('header.payload.signature', 'refresh_token-1'))
      .toEqual({ accessToken: 'header.payload.signature', refreshToken: 'refresh_token-1' });
  });

  it.each([
    ['', 'refresh'],
    ['access', ' '],
    [' access', 'refresh'],
    ['access\nnext', 'refresh'],
    ['access', 'refresh\u007f'],
    ['same-token', 'same-token'],
    ['a'.repeat(MAX_SESSION_TOKEN_LENGTH + 1), 'refresh'],
  ])('rejects unsafe, ambiguous, or oversized credentials', (accessToken, refreshToken) => {
    expect(() => normalizeSessionTokenPair(accessToken, refreshToken))
      .toThrow('invalid session');
  });
});
