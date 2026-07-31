import { post, get } from "./api";

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  churchName?: string;
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
  firstName: string;
  lastName: string;
  role: string;
  churchId?: string;
  avatarUrl?: string;
}

const AuthService = {
  async login(payload: LoginPayload): Promise<AuthResponse> {
    return post<AuthResponse>("/auth/login", payload);
  },

  async register(payload: RegisterPayload): Promise<AuthResponse> {
    return post<AuthResponse>("/auth/register", payload);
  },

  async verifyOtp(payload: OtpPayload): Promise<AuthResponse> {
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
