import api, { clearTokens } from './api';
import authService, {
  canonicalPhone,
  normalizeAuthResponse,
  normalizeCurrentChurch,
  normalizeOtpDispatch,
  normalizePhone,
  normalizeRegistrationChurch,
  normalizeRegistrationResponse,
  resolveChurchCode,
  normalizeUser,
} from './auth.service';
import { session } from './session';
import { isTerminalMemberSessionError, MemberSessionIdentityError } from './api-error';

jest.mock('./api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
  clearTokens: jest.fn(),
  sessionBoundRequest: jest.fn((accessToken: string) => ({
    _sessionBound: true,
    headers: { Authorization: `Bearer ${accessToken}` },
  })),
}));

jest.mock('./session', () => ({
  session: {
    commitAuthenticatedSessionIf: jest.fn(),
    getUser: jest.fn(),
    getAccessToken: jest.fn(),
  },
}));

const mockedApi = api as jest.Mocked<typeof api>;

describe('auth wire normalization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (session.commitAuthenticatedSessionIf as jest.Mock).mockResolvedValue(true);
  });

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
      user: { id: 'member-2', churchId: 'church-1', firstName: 'Kojo', lastName: 'Asare' },
      accessToken: 'legacy-access',
      refreshToken: 'legacy-refresh',
    }).user).toMatchObject({ firstName: 'Kojo', lastName: 'Asare', role: 'MEMBER' });
  });

  it('unwraps the Go success envelope for authenticated sessions', () => {
    expect(normalizeAuthResponse({
      success: true,
      data: {
        user: { id: 'member-2', churchId: 'church-1', name: 'Kojo Asare' },
        tokens: { accessToken: 'access', refreshToken: 'refresh' },
      },
    })).toMatchObject({ user: { firstName: 'Kojo' }, accessToken: 'access' });
  });

  it('requires a real OTP dispatch acknowledgement from either supported envelope', () => {
    expect(normalizeOtpDispatch({ success: true, data: { message: 'Code requested.' } }))
      .toEqual({ message: 'Code requested.' });
    expect(normalizeOtpDispatch({ message: 'Legacy code requested.' }))
      .toEqual({ message: 'Legacy code requested.' });
    expect(() => normalizeOtpDispatch({ success: true, data: {} })).toThrow('did not confirm');
    expect(() => normalizeOtpDispatch({ success: false, data: { message: 'No' } })).toThrow();
  });

  it('rejects an incomplete session response', () => {
    expect(() => normalizeAuthResponse({ user: { id: 'member-3' } })).toThrow('invalid session');
  });

  it.each([
    null,
    {},
    { id: '', churchId: 'church-1' },
    { id: 'member-1' },
    { id: 'member-1', churchId: 'church-1', email: 42 },
    { id: 'member-1', churchId: 'church-1', role: 'PASTOR' },
    { id: 'member/unsafe', churchId: 'church-1' },
    { id: 'member-1', churchId: 'church-1', email: 'not-an-email' },
    { id: 'member-1', churchId: 'church-1', phone: '+123' },
    { id: 'member-1', churchId: 'church-1', firstName: 'Ama\nAdmin' },
    { id: 'member-1', churchId: 'church-1', churchName: 'c'.repeat(161) },
  ])('rejects a malformed member identity before it can mount private navigation', (user) => {
    expect(() => normalizeUser(user)).toThrow('invalid member identity');
  });

  it.each([
    { user: { id: 'member-1', churchId: 'church-1' }, tokens: { accessToken: 42, refreshToken: 'refresh' } },
    { user: { id: 'member-1', churchId: 'church-1' }, tokens: { accessToken: 'access', refreshToken: ' ' } },
    { user: { id: 'member-1', churchId: 'church-1' }, tokens: { accessToken: 'access\nunsafe', refreshToken: 'refresh' } },
    { user: { id: 'member-1', churchId: 'church-1' }, tokens: { accessToken: 'same', refreshToken: 'same' } },
    { user: {}, tokens: { accessToken: 'access', refreshToken: 'refresh' } },
  ])('rejects a malformed authentication envelope', (response) => {
    expect(() => normalizeAuthResponse(response)).toThrow();
  });

  it('validates cached identity instead of trusting a parsed object cast', async () => {
    (session.getUser as jest.Mock).mockResolvedValueOnce({ role: 'MEMBER' });
    await expect(authService.getStoredUser()).rejects.toThrow('invalid member identity');
  });

  it('gives unnamed users a stable member label', () => {
    expect(normalizeUser({ id: 'member-4', churchId: 'church-1' }).firstName).toBe('Member');
  });

  it('canonicalizes returned email and phone before caching member identity', () => {
    expect(normalizeUser({
      id: 'member-4', churchId: 'church-1', email: ' AMA@EXAMPLE.COM ', phone: '024 123 4567',
    })).toMatchObject({ email: 'ama@example.com', phone: '+233241234567' });
  });

  it('drops an unsafe avatar URL instead of fetching it after sign-in', () => {
    expect(normalizeUser({
      id: 'member-4', churchId: 'church-1', avatarUrl: 'http://tracker.example/avatar.jpg',
    }).avatar).toBeUndefined();
    expect(normalizeUser({
      id: 'member-4', churchId: 'church-1', avatarUrl: 'https://cdn.example/avatar.jpg',
    }).avatar).toBe('https://cdn.example/avatar.jpg');
  });

  it('accepts only the signed-in member church when enriching profile display', () => {
    expect(normalizeCurrentChurch({ id: 'church-1', name: ' Grace Chapel ', isActive: true }, 'church-1'))
      .toBe('Grace Chapel');
    expect(() => normalizeCurrentChurch({ id: 'church-2', name: 'Other Church' }, 'church-1'))
      .toThrow('another account');
    expect(() => normalizeCurrentChurch({ id: 'church-1', name: 'Grace', isActive: false }, 'church-1'))
      .toThrow('invalid church details');
  });

  it('requires an exact minimal church-code response before registration', () => {
    expect(normalizeRegistrationChurch({
      data: { id: 'church-1', name: 'Grace Chapel', slug: 'grace-chapel-accra' },
    }, 'grace-chapel-accra')).toEqual({
      id: 'church-1', name: 'Grace Chapel', slug: 'grace-chapel-accra',
    });
    expect(() => normalizeRegistrationChurch(
      { id: 'church-1', name: 'Grace Chapel', slug: 'another-church' },
      'grace-chapel-accra',
    )).toThrow('invalid details');
    expect(() => normalizeRegistrationChurch(
      { id: '', name: 'Grace Chapel', slug: 'grace-chapel-accra' },
      'grace-chapel-accra',
    )).toThrow();
    expect(() => normalizeRegistrationChurch(
      { id: 'church-1', name: 'Grace Chapel', slug: 'grace-chapel-accra', isActive: false },
      'grace-chapel-accra',
    )).toThrow('invalid details');
  });

  it('does not confirm an inactive church even if a stale discovery endpoint returns it', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: {
      id: 'church-1', name: 'Closed Chapel', slug: 'closed-chapel', isActive: false,
    } } as never);

    await expect(resolveChurchCode('closed-chapel')).rejects.toThrow('invalid details');
  });

  it('rejects malformed church codes before making a discovery request', async () => {
    await expect(resolveChurchCode('../admin')).rejects.toThrow('exactly as your church shared it');
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('enriches the current profile with the validated current church name', async () => {
    mockedApi.get
      .mockResolvedValueOnce({ data: { success: true, data: { id: 'member-1', churchId: 'church-1', name: 'Ama Mensah', role: 'MEMBER' } } } as never)
      .mockResolvedValueOnce({ data: { id: 'church-1', name: 'Grace Chapel', isActive: true } } as never);

    await expect(authService.getCurrentUser({ id: 'member-1', churchId: 'church-1' }))
      .resolves.toMatchObject({
      id: 'member-1', churchId: 'church-1', churchName: 'Grace Chapel',
    });
    expect(session.commitAuthenticatedSessionIf).not.toHaveBeenCalled();
  });

  it.each([
    [{ id: 'member-2', churchId: 'church-1' }, 'another member'],
    [{ id: 'member-1', churchId: 'church-2' }, 'another church'],
  ])('rejects a current-profile response for %s', async (returnedUser) => {
    mockedApi.get.mockResolvedValueOnce({ data: {
      ...returnedUser, name: 'Other Member', role: 'MEMBER',
    } } as never);

    const result = authService.getCurrentUser({ id: 'member-1', churchId: 'church-1' });
    await expect(result).rejects.toBeInstanceOf(MemberSessionIdentityError);
    await expect(result).rejects.toThrow('another member');
    expect(session.commitAuthenticatedSessionIf).not.toHaveBeenCalled();
  });

  it('treats a gateway identity contradiction as terminal for the cached session', () => {
    expect(isTerminalMemberSessionError(new MemberSessionIdentityError())).toBe(true);
  });

  it('uses the just-issued token to enrich a new login before secure persistence', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: {
        user: { id: 'member-1', churchId: 'church-1', name: 'Ama Mensah', email: 'ama@example.com', role: 'MEMBER' },
        tokens: { accessToken: 'new-access', refreshToken: 'new-refresh' },
      },
    } as never);
    mockedApi.get.mockResolvedValueOnce({
      data: { id: 'church-1', name: 'Grace Chapel', isActive: true },
    } as never);

    await expect(authService.login({ email: 'ama@example.com', password: 'secret' }))
      .resolves.toMatchObject({ user: { churchName: 'Grace Chapel' } });
    expect(mockedApi.get).toHaveBeenCalledWith('/churches/current', {
      headers: { Authorization: 'Bearer new-access' },
    });
    expect(session.commitAuthenticatedSessionIf).toHaveBeenCalledWith(
      'new-access',
      'new-refresh',
      expect.objectContaining({ churchName: 'Grace Chapel' }),
      expect.any(Function),
    );
  });

  it('canonicalizes Ghana-local phone numbers for OTP lookup', () => {
    expect(normalizePhone('024 123 4567')).toBe('+233241234567');
    expect(canonicalPhone('24 123 4567')).toBe('+233241234567');
    expect(normalizePhone('233241234567')).toBe('+233241234567');
    expect(canonicalPhone('00233 24 123 4567')).toBe('+233241234567');
    expect(normalizePhone('+2348012345678')).toBe('+2348012345678');
  });

  it.each(['', '024', '024123456789', '+123', 'phone 0241234567'])('rejects unusable phone input %s', (value) => {
    expect(canonicalPhone(value)).toBeNull();
  });

  it('rejects an oversized formatted phone before normalization work', () => {
    expect(canonicalPhone(`+233${' '.repeat(40)}241234567`)).toBeNull();
  });

  it('normalizes password-login input and rejects invalid credentials before transport', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {
      user: { id: 'member-1', churchId: 'church-1', email: 'ama@example.com' },
      tokens: { accessToken: 'access', refreshToken: 'refresh' },
    } } as never);
    await authService.login({ email: ' AMA@EXAMPLE.COM ', password: 'secret', method: 'PASSWORD' });
    expect(mockedApi.post).toHaveBeenCalledWith('/auth/login', {
      email: 'ama@example.com', password: 'secret', method: 'PASSWORD',
    });

    jest.clearAllMocks();
    await expect(authService.login({ email: 'not-an-email', password: 'secret', method: 'PASSWORD' }))
      .rejects.toThrow('valid email and password');
    await expect(authService.login({ email: 'ama@example.com', password: 'x'.repeat(73), method: 'PASSWORD' }))
      .rejects.toThrow('valid email and password');
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('matches the gateway 72-byte password boundary for multibyte registration input', async () => {
    await expect(authService.register({
      firstName: 'Ama', lastName: 'Mensah', email: 'ama@example.com', phone: '0241234567',
      password: 'é'.repeat(37), churchCode: 'grace-chapel-accra', confirmedChurchId: 'church-1',
    })).rejects.toThrow('8–72 UTF-8 bytes');
    expect(mockedApi.get).not.toHaveBeenCalled();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('rejects malformed OTP input before verification transport', async () => {
    await expect(authService.verifyOtp({ phone: '0241234567', otp: '12345a' }))
      .rejects.toThrow('full 6-digit code');
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('does not persist a password session returned for another email', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {
      user: { id: 'member-2', churchId: 'church-1', email: 'other@example.com' },
      tokens: { accessToken: 'access', refreshToken: 'refresh' },
    } } as never);

    await expect(authService.login({ email: 'ama@example.com', password: 'secret' }))
      .rejects.toThrow('another member');
    expect(session.commitAuthenticatedSessionIf).not.toHaveBeenCalled();
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('binds OTP verification to the canonical phone and strips injected fields', async () => {
    const input = { phone: '024 123 4567', otp: '123456', churchId: 'other-church' } as {
      phone: string; otp: string; churchId: string;
    };
    mockedApi.post.mockResolvedValueOnce({ data: {
      user: {
        id: 'member-1', churchId: 'church-1', churchName: 'Grace Chapel',
        phone: '+233241234567', role: 'MEMBER',
      },
      tokens: { accessToken: 'access', refreshToken: 'refresh' },
    } } as never);

    await expect(authService.verifyOtp(input)).resolves.toMatchObject({
      user: { id: 'member-1', phone: '+233241234567' },
    });
    expect(mockedApi.post).toHaveBeenCalledWith('/auth/verify-otp', {
      otp: '123456', phone: '+233241234567',
    });
    expect(session.commitAuthenticatedSessionIf).toHaveBeenCalledWith(
      'access', 'refresh', expect.objectContaining({ id: 'member-1' }), expect.any(Function),
    );
  });

  it('does not accept a valid login after its owning screen invalidates the attempt', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {
      user: { id: 'member-1', churchId: 'church-1', email: 'ama@example.com', role: 'MEMBER' },
      tokens: { accessToken: 'access', refreshToken: 'refresh' },
    } } as never);
    mockedApi.get.mockResolvedValueOnce({ data: { id: 'church-1', name: 'Grace Chapel' } } as never);
    (session.commitAuthenticatedSessionIf as jest.Mock).mockResolvedValueOnce(false);

    await expect(authService.login(
      { email: 'ama@example.com', password: 'secret' },
      () => false,
    )).rejects.toThrow('no longer active');
  });

  it('does not persist an OTP session returned for another phone', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {
      user: { id: 'member-2', churchId: 'church-1', phone: '+233501234567' },
      tokens: { accessToken: 'access', refreshToken: 'refresh' },
    } } as never);

    await expect(authService.verifyOtp({ phone: '0241234567', otp: '123456' }))
      .rejects.toThrow('another member');
    expect(session.commitAuthenticatedSessionIf).not.toHaveBeenCalled();
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('bounds church display data before session enrichment', () => {
    expect(() => normalizeCurrentChurch({ id: 'church-1', name: 'x'.repeat(161) }, 'church-1'))
      .toThrow('invalid member identity');
    expect(() => normalizeRegistrationChurch({
      id: 'church-1', name: 'x'.repeat(161), slug: 'grace-chapel-accra',
    }, 'grace-chapel-accra')).toThrow('invalid member identity');
  });

  it('resolves a church code and accepts account creation without an unverified session', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: { data: { id: 'church-1', name: 'Grace Chapel', slug: 'grace-chapel-accra' } },
    } as never);
    mockedApi.post.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          user: {
            id: 'user-1', name: 'Ama Mensah', churchId: 'church-1',
            email: 'ama@example.com', phone: '+233241234567', role: 'MEMBER',
          },
          message: 'Account created. Verify your phone to continue.',
        },
      },
    } as never);

    const result = await authService.register({
      firstName: 'Ama', lastName: 'Mensah', email: 'AMA@example.com',
      phone: '024 123 4567', password: 'password123', churchCode: 'Grace-Chapel-Accra',
      confirmedChurchId: 'church-1',
    });

    expect(mockedApi.get).toHaveBeenCalledWith('/churches/slug/grace-chapel-accra');
    expect(mockedApi.post).toHaveBeenCalledWith('/auth/register', {
      name: 'Ama Mensah', email: 'ama@example.com', phone: '+233241234567',
      password: 'password123', churchId: 'church-1',
    });
    expect(result.user).toMatchObject({ id: 'user-1', firstName: 'Ama', churchId: 'church-1' });
    expect(session.commitAuthenticatedSessionIf).not.toHaveBeenCalled();
  });

  it.each([
    ['email', { email: 'other@example.com' }],
    ['name', { name: 'Another Member' }],
  ])('rejects a registration acknowledgement with changed %s', (_label, changed) => {
    expect(() => normalizeRegistrationResponse({
      user: {
        id: 'user-1', name: 'Ama Mensah', email: 'ama@example.com',
        churchId: 'church-1', phone: '+233241234567', role: 'MEMBER', ...changed,
      },
    }, 'church-1', '+233241234567', 'ama@example.com', 'Ama Mensah'))
      .toThrow('invalid registration result');
  });

  it('refuses a registration result assigned to another tenant or role', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: { id: 'church-1', name: 'Grace Chapel', slug: 'grace-chapel-accra' },
    } as never);
    mockedApi.post.mockResolvedValueOnce({ data: {
      user: {
        id: 'user-1', name: 'Ama Mensah', churchId: 'church-2',
        phone: '+233241234567', role: 'CHURCH_ADMIN',
      },
    } } as never);

    await expect(authService.register({
      firstName: 'Ama', lastName: 'Mensah', email: 'ama@example.com',
      phone: '0241234567', password: 'password123', churchCode: 'grace-chapel-accra',
      confirmedChurchId: 'church-1',
    })).rejects.toThrow('invalid registration result');
    expect(session.commitAuthenticatedSessionIf).not.toHaveBeenCalled();
  });

  it('stops registration when a confirmed code now resolves to another church', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: { id: 'church-2', name: 'Another Grace', slug: 'grace-chapel-accra' },
    } as never);

    await expect(authService.register({
      firstName: 'Ama', lastName: 'Mensah', email: 'ama@example.com',
      phone: '0241234567', password: 'password123', churchCode: 'grace-chapel-accra',
      confirmedChurchId: 'church-1',
    })).rejects.toThrow('Confirm your church again');
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('ends every server session before clearing the same session from this device', async () => {
    (session.getAccessToken as jest.Mock)
      .mockResolvedValueOnce('access-token')
      .mockResolvedValueOnce('access-token');
    mockedApi.post.mockResolvedValueOnce({ data: { message: 'Signed out.' } } as never);

    await expect(authService.logoutEverywhere()).resolves.toBe(true);

    expect(mockedApi.post).toHaveBeenCalledWith('/auth/logout-all', undefined, {
      _sessionBound: true,
      headers: { Authorization: 'Bearer access-token' },
    });
    expect(clearTokens).toHaveBeenCalled();
  });

  it('keeps the current session available when global revocation fails', async () => {
    (session.getAccessToken as jest.Mock).mockResolvedValueOnce('access-token');
    mockedApi.post.mockRejectedValueOnce(new Error('offline'));

    await expect(authService.logoutEverywhere()).rejects.toThrow('offline');
    expect(clearTokens).not.toHaveBeenCalled();
  });

  it('does not clear this device while global revocation is still pending', async () => {
    (session.getAccessToken as jest.Mock)
      .mockResolvedValueOnce('access-token')
      .mockResolvedValueOnce('access-token');
    let resolveRemote!: (value: unknown) => void;
    mockedApi.post.mockReturnValueOnce(new Promise((resolve) => { resolveRemote = resolve; }) as never);

    const logout = authService.logoutEverywhere();
    await Promise.resolve();
    await Promise.resolve();
    expect(clearTokens).not.toHaveBeenCalled();

    resolveRemote({ data: { message: 'Signed out.' } });
    await expect(logout).resolves.toBe(true);
    expect(clearTokens).toHaveBeenCalledTimes(1);
  });

  it('does not clear a newer login after an older global revocation completes', async () => {
    (session.getAccessToken as jest.Mock)
      .mockResolvedValueOnce('old-access-token')
      .mockResolvedValueOnce('new-access-token');
    mockedApi.post.mockResolvedValueOnce({ data: { message: 'Signed out.' } } as never);

    await expect(authService.logoutEverywhere()).resolves.toBe(false);
    expect(clearTokens).not.toHaveBeenCalled();
  });

  it('starts local cleanup without waiting for remote logout to finish', async () => {
    (session.getAccessToken as jest.Mock).mockResolvedValueOnce('access-token');
    let resolveRemote!: (value: unknown) => void;
    mockedApi.post.mockReturnValueOnce(new Promise((resolve) => { resolveRemote = resolve; }) as never);

    const logout = authService.logout();
    await Promise.resolve();
    await Promise.resolve();
    expect(clearTokens).toHaveBeenCalled();

    resolveRemote({ data: { message: 'Signed out.' } });
    await expect(logout).resolves.toBeUndefined();
  });

  it('still clears local credentials when remote revocation fails', async () => {
    (session.getAccessToken as jest.Mock).mockResolvedValueOnce('access-token');
    mockedApi.post.mockRejectedValueOnce(new Error('offline'));

    await expect(authService.logout()).rejects.toThrow('offline');
    expect(clearTokens).toHaveBeenCalled();
  });
});
