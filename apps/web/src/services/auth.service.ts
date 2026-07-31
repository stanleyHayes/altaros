import { post, get } from "./api";

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  churchCode: string;
}

export interface OtpPayload {
  email: string;
  code: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  user: User;
  tokens: AuthTokens;
}

export interface User {
  id: string;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  role: string;
  churchId?: string;
  churchName?: string;
  avatarUrl?: string;
  departments?: string[];
  groups?: string[];
}

const AuthService = {
  async login(payload: LoginPayload): Promise<AuthResponse> {
    // TODO: Replace with actual API call
    return post<AuthResponse>("/auth/login", payload);
  },

  async register(payload: RegisterPayload): Promise<AuthResponse> {
    // TODO: Replace with actual API call
    return post<AuthResponse>("/auth/register", payload);
  },

  async requestOtp(phone: string): Promise<void> {
    return post<void>("/auth/request-otp", { phone });
  },

  async verifyOtp(payload: OtpPayload): Promise<AuthResponse> {
    // TODO: Replace with actual API call
    return post<AuthResponse>("/auth/verify-otp", payload);
  },

  async refreshToken(refreshToken: string): Promise<AuthTokens> {
    return post<AuthTokens>("/auth/refresh", { refreshToken });
  },

  async getCurrentUser(): Promise<User> {
    return get<User>("/auth/me");
  },
};

export default AuthService;
