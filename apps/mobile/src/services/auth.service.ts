import api, { clearTokens } from './api';
import { session } from './session';

export interface LoginRequest {
  email?: string;
  phone?: string;
  password?: string;
  method?: 'PHONE' | 'PASSWORD';
}

export interface RegisterRequest {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  churchCode?: string;
}

export interface OtpRequest {
  phone: string;
  otp: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  avatar?: string;
  churchId?: string;
  churchName?: string;
  role: string;
}

interface WireUser {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  avatar?: string;
  avatarUrl?: string;
  churchId?: string;
  churchName?: string;
  role?: string;
}

interface WireAuthResponse {
  user: WireUser;
  tokens?: { accessToken: string; refreshToken: string };
  accessToken?: string;
  refreshToken?: string;
}

export function normalizeUser(user: WireUser): User {
  const nameParts = (user.name ?? '').trim().split(/\s+/).filter(Boolean);
  return {
    id: user.id,
    firstName: user.firstName ?? nameParts[0] ?? 'Member',
    lastName: user.lastName ?? nameParts.slice(1).join(' '),
    email: user.email ?? '',
    phone: user.phone ?? '',
    avatar: user.avatar ?? user.avatarUrl,
    churchId: user.churchId,
    churchName: user.churchName,
    role: user.role ?? 'MEMBER',
  };
}

export function normalizeAuthResponse(data: WireAuthResponse): AuthResponse {
  const accessToken = data.tokens?.accessToken ?? data.accessToken;
  const refreshToken = data.tokens?.refreshToken ?? data.refreshToken;
  if (!accessToken || !refreshToken || !data.user) {
    throw new Error('The server returned an invalid session. Please try again.');
  }
  return { accessToken, refreshToken, user: normalizeUser(data.user) };
}

async function storeAuthData(data: AuthResponse): Promise<void> {
  await Promise.all([
    session.setTokens(data.accessToken, data.refreshToken),
    session.setUser(data.user),
  ]);
}

const authService = {
  async login(credentials: LoginRequest): Promise<AuthResponse> {
    const { data } = await api.post<WireAuthResponse>('/auth/login', credentials);
    const response = normalizeAuthResponse(data);
    await storeAuthData(response);
    return response;
  },

  async register(details: RegisterRequest): Promise<AuthResponse> {
    const { data } = await api.post<WireAuthResponse>('/auth/register', details);
    const response = normalizeAuthResponse(data);
    await storeAuthData(response);
    return response;
  },

  async verifyOtp(otpData: OtpRequest): Promise<AuthResponse> {
    const { data } = await api.post<WireAuthResponse>('/auth/verify-otp', otpData);
    const response = normalizeAuthResponse(data);
    await storeAuthData(response);
    return response;
  },

  async requestOtp(phone: string): Promise<{ message: string }> {
    const { data } = await api.post<{ message: string }>('/auth/request-otp', { phone });
    return data;
  },

  async getCurrentUser(): Promise<User> {
    const { data } = await api.get<WireUser>('/auth/me');
    const user = normalizeUser(data);
    await session.setUser(user);
    return user;
  },

  async logout(): Promise<void> {
    try {
      await api.post('/auth/logout');
    } finally {
      await clearTokens();
    }
  },

  getStoredUser: () => session.getUser<User>(),
  async isAuthenticated(): Promise<boolean> {
    return Boolean(await session.getAccessToken());
  },
};

export default authService;
