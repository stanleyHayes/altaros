import type { User, UserRole } from "@altar-os/shared-types";

export interface CreateUserData {
  email: string;
  phone: string;
  name: string;
  passwordHash: string;
  churchId: string;
  /** Defaults to MEMBER. Set to CHURCH_ADMIN for whoever creates the church. */
  role?: UserRole;
}

export interface IAuthRepository {
  /**
   * Resolves an account by email, optionally within one church (WP-35).
   *
   * `churchId` is optional rather than required because the sign-in path does
   * not know it — the caller supplies an address and, from now on, a workspace.
   * Registration DOES know it and must pass it, or a person who attends two
   * churches is refused an account at the second.
   *
   * Without a churchId this resolves an account only when EXACTLY ONE holds the
   * address. Two is not "pick either": that signs somebody into a church they
   * did not name.
   */
  findByEmail(
    email: string,
    churchId?: string,
  ): Promise<(User & { passwordHash: string }) | null>;
  findByPhone(
    phone: string,
    churchId?: string,
  ): Promise<(User & { passwordHash: string }) | null>;
  findById(id: string): Promise<User | null>;
  create(data: CreateUserData): Promise<User>;
  updatePassword(id: string, passwordHash: string): Promise<void>;
}
