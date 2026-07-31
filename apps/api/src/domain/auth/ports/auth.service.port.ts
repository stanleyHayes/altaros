import type {
  User,
  AuthTokens,
  RegisterRequest,
  LoginRequest,
  OtpVerifyRequest,
} from "@altar-os/shared-types";

export interface AuthResult {
  user: User;
  tokens: AuthTokens;
}

export interface IAuthService {
  register(data: RegisterRequest): Promise<AuthResult>;
  login(data: LoginRequest): Promise<AuthResult>;
  verifyOtp(data: OtpVerifyRequest): Promise<AuthResult>;
  refreshToken(token: string): Promise<AuthTokens>;
  getCurrentUser(userId: string): Promise<User>;
}
