import type { User } from "@altar-os/shared-types";

export interface CreateUserData {
  email: string;
  phone: string;
  name: string;
  passwordHash: string;
  churchId: string;
}

export interface IAuthRepository {
  findByEmail(email: string): Promise<(User & { passwordHash: string }) | null>;
  findByPhone(phone: string): Promise<(User & { passwordHash: string }) | null>;
  findById(id: string): Promise<User | null>;
  create(data: CreateUserData): Promise<User>;
  updatePassword(id: string, passwordHash: string): Promise<void>;
}
