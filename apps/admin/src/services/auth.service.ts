import { LoginMethod } from "@altar-os/shared-types";
import type { AuthTokens, LoginRequest, User } from "@altar-os/shared-types";
import { post, get } from "./api";

/**
 * Auth shapes come from @altar-os/shared-types, which is the contract the API
 * is built against and the source WP-04 generates the Go types from. Declaring
 * local copies is how the other apps ended up calling a login endpoint without
 * the required `method` and reading a `firstName` the API never returns.
 *
 * These no longer describe the `{ success, data }` envelope either — the api
 * helpers unwrap it, so what arrives here is the payload itself.
 */
export type { AuthTokens, User };

export interface LoginPayload {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  tokens: AuthTokens;
}

const AuthService = {
  async login(payload: LoginPayload): Promise<AuthResponse> {
    const body: LoginRequest = { ...payload, method: LoginMethod.EMAIL };
    return post<AuthResponse>("/auth/login", body);
  },

  async getMe(): Promise<User> {
    return get<User>("/auth/me");
  },

  async refreshToken(refreshToken: string): Promise<AuthTokens> {
    // The route is /auth/refresh-token, not /auth/refresh.
    return post<AuthTokens>("/auth/refresh-token", { refreshToken });
  },

  async logout(): Promise<void> {
    return post<void>("/auth/logout");
  },
};

export default AuthService;
