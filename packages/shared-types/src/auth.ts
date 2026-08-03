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
  /** Linked congregation-roster identity used by member-owned domains. */
  memberId?: string;
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
  /** Join an existing church. Provide this OR `churchName`, not neither. */
  churchId?: string;
  /**
   * Register a new church and become its first CHURCH_ADMIN. Used by the
   * self-signup flow, where the registrant knows their church's name but
   * has no id yet.
   */
  churchName?: string;
  /** Optional founding profile captured during church onboarding. */
  churchCity?: string;
  churchDenomination?: string;
  averageWeeklyAttendance?: number;
  ministryPriorities?: string[];
  /** Package intent. Paid access is activated separately after billing. */
  requestedPlan?: "free" | "basic" | "pro" | "enterprise";
}

export interface OtpVerifyRequest {
  phone?: string;
  email?: string;
  otp: string;
}
