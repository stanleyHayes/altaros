export enum UserRole {
  SUPER_ADMIN = "SUPER_ADMIN",
  CHURCH_ADMIN = "CHURCH_ADMIN",
  DEPARTMENT_LEADER = "DEPARTMENT_LEADER",
  MEMBER = "MEMBER",
}

export enum LoginMethod {
  PHONE = "PHONE",
  EMAIL = "EMAIL",
  SOCIAL = "SOCIAL",
}

export interface User {
  id: string;
  churchId: string;
  email: string;
  phone: string;
  name: string;
  role: UserRole;
  avatarUrl?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginRequest {
  email?: string;
  phone?: string;
  password?: string;
  method: LoginMethod;
}

export interface RegisterRequest {
  email: string;
  phone: string;
  name: string;
  password: string;
  churchId: string;
}

export interface OtpVerifyRequest {
  phone?: string;
  email?: string;
  otp: string;
}
