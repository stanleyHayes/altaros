import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import type {
  User,
  AuthTokens,
  RegisterRequest,
  LoginRequest,
  OtpVerifyRequest,
  LoginMethod,
} from "@altar-os/shared-types";
import type { IAuthService, AuthResult } from "../ports/auth.service.port.js";
import type { IAuthRepository } from "../ports/auth.repository.port.js";
import type { AuthPayload } from "../../../infrastructure/middleware/auth.middleware.js";
import { env } from "../../../infrastructure/config/env.js";
import { AppError } from "../../../infrastructure/middleware/error.middleware.js";

const SALT_ROUNDS = 12;

export class AuthService implements IAuthService {
  constructor(private readonly authRepo: IAuthRepository) {}

  async register(data: RegisterRequest): Promise<AuthResult> {
    const existing = await this.authRepo.findByEmail(data.email);
    if (existing) {
      throw new AppError(409, "A user with this email already exists");
    }

    const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

    const user = await this.authRepo.create({
      email: data.email,
      phone: data.phone,
      name: data.name,
      passwordHash,
      churchId: data.churchId,
    });

    const tokens = this.generateTokens(user);
    return { user, tokens };
  }

  async login(data: LoginRequest): Promise<AuthResult> {
    const method = data.method as LoginMethod;

    if (method === "PHONE") {
      // OTP-based flow: in a real implementation this would send an OTP
      throw new AppError(501, "Phone OTP login not yet implemented");
    }

    if (!data.email || !data.password) {
      throw new AppError(400, "Email and password are required for email login");
    }

    const userWithHash = await this.authRepo.findByEmail(data.email);
    if (!userWithHash) {
      throw new AppError(401, "Invalid credentials");
    }

    const passwordValid = await bcrypt.compare(
      data.password,
      userWithHash.passwordHash,
    );
    if (!passwordValid) {
      throw new AppError(401, "Invalid credentials");
    }

    if (!userWithHash.isActive) {
      throw new AppError(403, "Account is deactivated");
    }

    const { passwordHash: _, ...user } = userWithHash;
    const tokens = this.generateTokens(user as User);
    return { user: user as User, tokens };
  }

  async verifyOtp(_data: OtpVerifyRequest): Promise<AuthResult> {
    // Placeholder for OTP verification logic
    throw new AppError(501, "OTP verification not yet implemented");
  }

  async refreshToken(token: string): Promise<AuthTokens> {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as AuthPayload & {
        type: string;
      };

      if (payload.type !== "refresh") {
        throw new AppError(401, "Invalid refresh token");
      }

      const user = await this.authRepo.findById(payload.id);
      if (!user) {
        throw new AppError(401, "User not found");
      }

      return this.generateTokens(user);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(401, "Invalid or expired refresh token");
    }
  }

  async getCurrentUser(userId: string): Promise<User> {
    const user = await this.authRepo.findById(userId);
    if (!user) {
      throw new AppError(404, "User not found");
    }
    return user;
  }

  private generateTokens(user: User): AuthTokens {
    const accessPayload: AuthPayload = {
      id: user.id,
      churchId: user.churchId,
      role: user.role,
    };

    const accessToken = jwt.sign(accessPayload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
    });

    const refreshToken = jwt.sign(
      { ...accessPayload, type: "refresh" },
      env.JWT_SECRET,
      { expiresIn: "30d" },
    );

    return { accessToken, refreshToken };
  }
}
