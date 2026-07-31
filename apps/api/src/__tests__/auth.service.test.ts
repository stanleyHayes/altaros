import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../domain/auth/application/auth.service';
import type { IAuthRepository } from '../domain/auth/ports/auth.repository.port';
import { LoginMethod } from '@altar-os/shared-types';

const mockRepo: IAuthRepository = {
  findByEmail: vi.fn(),
  findByPhone: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  createFromPhone: vi.fn(),
  updatePassword: vi.fn(),
  updateOtp: vi.fn(),
  findOtp: vi.fn(),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AuthService(mockRepo);
  });

  it('should throw if user already exists on register', async () => {
    (mockRepo.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: '1',
      email: 'test@test.com',
    });

    await expect(
      service.register({
        email: 'test@test.com',
        phone: '+1234567890',
        password: 'Password123!',
        name: 'Test User',
        churchId: 'church-1',
      }),
    ).rejects.toThrow();
  });

  it('should throw if login credentials are invalid', async () => {
    (mockRepo.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(
      service.login({ email: 'nonexistent@test.com', password: 'wrong', method: LoginMethod.EMAIL }),
    ).rejects.toThrow();
  });
});
