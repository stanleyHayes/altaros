import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../domain/auth/application/auth.service';
import type { IAuthRepository } from '../domain/auth/ports/auth.repository.port';
import type { IChurchRepository } from '../domain/church/ports/church.repository.port';
import { LoginMethod } from '@altar-os/shared-types';

// Mirrors IAuthRepository exactly. OTP-related methods (createFromPhone,
// updateOtp, findOtp) were previously mocked here but exist on neither the
// port nor the Mongo adapter — AuthService.verifyOtp is still a stub.
// Phone OTP is the primary auth method per the spec; see WP-10.
const mockRepo: IAuthRepository = {
  findByEmail: vi.fn(),
  findByPhone: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  updatePassword: vi.fn(),
};

// Register resolves a church (join by id, or create from name), so the
// service now depends on the church repository too.
const mockChurchRepo: IChurchRepository = {
  findById: vi.fn(),
  findBySlug: vi.fn(),
  findAll: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AuthService(mockRepo, mockChurchRepo);
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
