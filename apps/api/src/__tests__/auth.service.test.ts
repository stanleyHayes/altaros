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

  it('rejects a duplicate phone before creating or resolving a church', async () => {
    (mockRepo.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (mockRepo.findByPhone as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: '2',
      email: 'member@example.com',
      phone: '+233241234567',
    });

    await expect(
      service.register({
        email: 'new@example.com',
        phone: '+233241234567',
        password: 'Password123!',
        name: 'New User',
        // Joining an EXISTING church is the path that can be refused, and so
        // the one where the ordering matters.
        churchId: 'church-1',
      }),
    ).rejects.toThrow('already exists');

    expect(mockChurchRepo.findBySlug).not.toHaveBeenCalled();
    expect(mockChurchRepo.create).not.toHaveBeenCalled();
  });

  // WP-35 / ADR-006. Identity is unique per (church, address), so an address
  // already in use somewhere else is not a reason to refuse. Before workspace
  // scoping this was rejected, which meant a person who attends two churches
  // could not hold an account at the second — and could not found one.
  it('allows an address that exists in another church to found a new one', async () => {
    (mockRepo.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (mockRepo.findByPhone as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (mockChurchRepo.findBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (mockChurchRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'church-2',
      name: 'New Church',
    });
    (mockRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: '3',
      email: 'shared@example.com',
      phone: '+233241234567',
      churchId: 'church-2',
      role: 'CHURCH_ADMIN',
    });

    const result = await service.register({
      email: 'shared@example.com',
      phone: '+233241234567',
      password: 'Password123!',
      name: 'New User',
      churchName: 'New Church',
    });

    expect(result.user.churchId).toBe('church-2');
    // A brand-new church holds nobody, so there was nothing to check against —
    // the lookups are skipped rather than run globally.
    expect(mockRepo.findByEmail).not.toHaveBeenCalled();
    expect(mockRepo.findByPhone).not.toHaveBeenCalled();
  });

  // The scoped lookup is the whole migration. Passing the address without the
  // church would find an account in some OTHER church and refuse a legitimate
  // registration.
  it('scopes the duplicate check to the church being joined', async () => {
    (mockRepo.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (mockRepo.findByPhone as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (mockChurchRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'church-1',
      name: 'Grace Chapel',
    });
    (mockRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: '4',
      email: 'joiner@example.com',
      churchId: 'church-1',
    });

    await service.register({
      email: 'joiner@example.com',
      phone: '+233245550000',
      password: 'Password123!',
      name: 'Joiner',
      churchId: 'church-1',
    });

    expect(mockRepo.findByEmail).toHaveBeenCalledWith('joiner@example.com', 'church-1');
    expect(mockRepo.findByPhone).toHaveBeenCalledWith('+233245550000', 'church-1');
  });

  it('should throw if login credentials are invalid', async () => {
    (mockRepo.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(
      service.login({ email: 'nonexistent@test.com', password: 'wrong', method: LoginMethod.EMAIL }),
    ).rejects.toThrow();
  });
});
