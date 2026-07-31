import { LoginMethod } from "@altar-os/shared-types";
import type {
  AuthTokens,
  LoginRequest,
  RegisterRequest,
  User,
} from "@altar-os/shared-types";
import { post, get } from "./api";

/**
 * Auth request/response shapes come from @altar-os/shared-types, which is the
 * canonical contract the API is built against. This module previously declared
 * its own drifted copies (a `User` with firstName/lastName, a login payload
 * with no `method`), which made every auth call fail against the real API.
 */
export type { AuthTokens, User };

/** What the login form collects. `method` is derived in `login()`. */
export interface LoginPayload {
  email?: string;
  phone?: string;
  password: string;
}

export type RegisterPayload = RegisterRequest;

export interface OtpPayload {
  phone: string;
  code: string;
}

export interface AuthResponse {
  user: User;
  tokens: AuthTokens;
}

/** Display name helpers — the API returns a single `name`, not first/last. */
export function initialsOf(user: Pick<User, "name">): string {
  return user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

const AuthService = {
  async login(payload: LoginPayload): Promise<AuthResponse> {
    // The API requires an explicit method; infer it from what was supplied so
    // callers don't have to restate it at every call site.
    const body: LoginRequest = {
      ...payload,
      method: payload.email ? LoginMethod.EMAIL : LoginMethod.PHONE,
    };
    return post<AuthResponse>("/auth/login", body);
  },

  async register(payload: RegisterPayload): Promise<AuthResponse> {
    return post<AuthResponse>("/auth/register", payload);
  },

  async verifyOtp(payload: OtpPayload): Promise<AuthResponse> {
    return post<AuthResponse>("/auth/verify-otp", payload);
  },

  async refreshToken(refreshToken: string): Promise<AuthTokens> {
    // Route is /auth/refresh-token on the API, not /auth/refresh.
    return post<AuthTokens>("/auth/refresh-token", { refreshToken });
  },

  async getCurrentUser(): Promise<User> {
    return get<User>("/auth/me");
  },
};

export default AuthService;
