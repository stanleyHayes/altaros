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
 * canonical contract the API is built against and the source WP-04 generates
 * the Go types from.
 *
 * This module previously declared its own drifted copies, and every one of the
 * differences was a runtime failure that typechecked cleanly: a login payload
 * with no `method` (which the API requires), a `User` with `firstName` and
 * `lastName` (the API returns a single `name`), a refresh call to `/auth/
 * refresh` (the route is `/auth/refresh-token`), and an OTP field named `code`
 * (the API reads `otp`).
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
  phone?: string;
  email?: string;
  otp: string;
}

export interface AuthResponse {
  user: User;
  tokens: AuthTokens;
}

/**
 * Display-name helpers. The API returns one `name`, so anything that wants
 * initials or a first name derives them here rather than expecting fields the
 * API does not send.
 */
export function initialsOf(user: Pick<User, "name">): string {
  return user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function firstNameOf(user: Pick<User, "name">): string {
  return user.name.split(/\s+/)[0] ?? user.name;
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

  async requestOtp(phone: string): Promise<void> {
    return post<void>("/auth/request-otp", { phone });
  },

  async verifyOtp(payload: OtpPayload): Promise<AuthResponse> {
    return post<AuthResponse>("/auth/verify-otp", payload);
  },

  async refreshToken(refreshToken: string): Promise<AuthTokens> {
    // The route is /auth/refresh-token, not /auth/refresh.
    return post<AuthTokens>("/auth/refresh-token", { refreshToken });
  },

  async getCurrentUser(): Promise<User> {
    return get<User>("/auth/me");
  },

  async logout(): Promise<void> {
    return post<void>("/auth/logout");
  },
};

export default AuthService;
