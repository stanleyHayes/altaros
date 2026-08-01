import { normalizeAuthResponse, normalizeUser } from './auth.service';

describe('auth wire normalization', () => {
  it('normalizes the Go result shape and name fields', () => {
    expect(normalizeAuthResponse({
      user: { id: 'member-1', name: 'Ama Mensah', email: 'ama@example.com', phone: '+233241234567', avatarUrl: 'https://example.com/ama.jpg', churchId: 'church-1', role: 'MEMBER' },
      tokens: { accessToken: 'access', refreshToken: 'refresh' },
    })).toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      user: {
        id: 'member-1', firstName: 'Ama', lastName: 'Mensah', email: 'ama@example.com', phone: '+233241234567', avatar: 'https://example.com/ama.jpg', churchId: 'church-1', churchName: undefined, role: 'MEMBER',
      },
    });
  });

  it('keeps compatibility with the legacy flat token response', () => {
    expect(normalizeAuthResponse({
      user: { id: 'member-2', firstName: 'Kojo', lastName: 'Asare' },
      accessToken: 'legacy-access',
      refreshToken: 'legacy-refresh',
    }).user).toMatchObject({ firstName: 'Kojo', lastName: 'Asare', role: 'MEMBER' });
  });

  it('rejects an incomplete session response', () => {
    expect(() => normalizeAuthResponse({ user: { id: 'member-3' } })).toThrow('invalid session');
  });

  it('gives unnamed users a stable member label', () => {
    expect(normalizeUser({ id: 'member-4' }).firstName).toBe('Member');
  });
});
