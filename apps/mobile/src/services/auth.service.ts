import api from './api';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface LoginRequest {
  email?: string;
  phone?: string;
  password: string;
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

const authService = {
  async login(credentials: LoginRequest): Promise<AuthResponse> {
    const { data } = await api.post<AuthResponse>('/auth/login', credentials);
    await storeAuthData(data);
    return data;
  },

  async register(details: RegisterRequest): Promise<AuthResponse> {
    const { data } = await api.post<AuthResponse>('/auth/register', details);
    await storeAuthData(data);
    return data;
  },

  async verifyOtp(otpData: OtpRequest): Promise<AuthResponse> {
    const { data } = await api.post<AuthResponse>('/auth/verify-otp', otpData);
    await storeAuthData(data);
    return data;
  },

  async requestOtp(phone: string): Promise<{ message: string }> {
    const { data } = await api.post('/auth/request-otp', { phone });
    return data;
  },

  async refreshToken(): Promise<AuthResponse> {
    const refreshToken = await AsyncStorage.getItem('refreshToken');
    const { data } = await api.post<AuthResponse>('/auth/refresh', {
      refreshToken,
    });
    await storeAuthData(data);
    return data;
  },

  async getCurrentUser(): Promise<User> {
    const { data } = await api.get<User>('/auth/me');
    await AsyncStorage.setItem('user', JSON.stringify(data));
    return data;
  },

  async logout(): Promise<void> {
    try {
      await api.post('/auth/logout');
    } catch {
      // Proceed with local logout even if API call fails
    }
    await Promise.all(['accessToken', 'refreshToken', 'user'].map((k) => AsyncStorage.removeItem(k)));
  },

  async getStoredUser(): Promise<User | null> {
    const userJson = await AsyncStorage.getItem('user');
    return userJson ? JSON.parse(userJson) : null;
  },

  async isAuthenticated(): Promise<boolean> {
    const token = await AsyncStorage.getItem('accessToken');
    return !!token;
  },
};

async function storeAuthData(data: AuthResponse) {
  await AsyncStorage.setItem('accessToken', data.accessToken);
  await AsyncStorage.setItem('refreshToken', data.refreshToken);
  await AsyncStorage.setItem('user', JSON.stringify(data.user));
}

export default authService;
