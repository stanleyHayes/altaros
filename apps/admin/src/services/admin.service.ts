import { get, patch, put } from "./api";

export interface PlatformStats {
  totalChurches: number;
  activeChurches: number;
  totalUsers: number;
  activeUsers: number;
  totalMembers: number;
  totalRevenue: number;
}

export interface ChurchRow {
  id: string;
  name: string;
  slug: string;
  city: string;
  country: string;
  plan: string;
  isActive: boolean;
  memberCount: number;
  totalRevenue: number;
  createdAt: string;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  churchId?: string;
  isActive: boolean;
  avatarUrl?: string;
  createdAt: string;
}

export interface SystemHealth {
  status: string;
  uptime: number;
  timestamp: string;
  database: string;
  memory: { heapUsed: number; heapTotal: number; rss: number };
  nodeVersion: string;
}

export interface OperationsSnapshot {
  notificationsTotal: number;
  notificationsFailed: number;
  notificationsQueued: number;
  auditEvents: number;
  inactiveChurches: number;
  churchesMissingLocation: number;
}

export interface AuditRow {
  id: string;
  churchId: string;
  actorId: string;
  actorRole: string;
  action: string;
  resource: string;
  resourceId?: string;
  reason?: string;
  createdAt: string;
}

export interface PlatformSettingsResponse {
  settings: {
    commissionBasisPoints: number;
    defaultFeeBearer: string;
    providerFees: Record<string, { basisPoints: number; flatMinor: number; capMinor: number; waiveBelowMinor: number }>;
    messagingRates: Record<string, { minor: number; currency: string }>;
    updatedAt: string;
  };
  note: string;
  maxCommissionBasisPoints: number;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * A paginated list, as the API returns it once the envelope is off.
 *
 * The envelope types that used to live here (`{ success, data, pagination }`)
 * were the bug api.ts warns about, one layer up: `get()` unwraps to `data`, so
 * declaring the envelope as the type parameter meant every call site read
 * `response.data` as `undefined`. On the dashboard that surfaced as a platform
 * overview of all zeros — indistinguishable from a real empty platform, and
 * made worse by a `.catch(() => {})` that discarded the reason.
 *
 * Pagination therefore has to travel INSIDE the payload, not beside it, or
 * unwrapping loses it.
 */
export interface Page<T> {
  items: T[];
  pagination: Pagination;
}

const AdminService = {
  async getStats(): Promise<PlatformStats> {
    return get<PlatformStats>("/admin/stats");
  },

  async getChurches(page = 1, limit = 20): Promise<Page<ChurchRow>> {
    return get<Page<ChurchRow>>(`/admin/churches?page=${page}&limit=${limit}`);
  },

  async updateChurchStatus(id: string, isActive: boolean): Promise<void> {
    await patch(`/admin/churches/${id}/status`, { isActive });
  },

  async getUsers(page = 1, limit = 20, role?: string, search?: string): Promise<Page<UserRow>> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (role) params.set("role", role);
    if (search) params.set("search", search);
    return get<Page<UserRow>>(`/admin/users?${params}`);
  },

  async getHealth(): Promise<SystemHealth> {
    return get<SystemHealth>("/admin/health");
  },

  async getOperations(): Promise<OperationsSnapshot> {
    return get<OperationsSnapshot>("/admin/operations");
  },

  async getAudit(page = 1, limit = 50): Promise<Page<AuditRow>> {
    return get<Page<AuditRow>>(`/admin/audit?page=${page}&limit=${limit}`);
  },

  async getPlatformSettings(): Promise<PlatformSettingsResponse> {
    return get<PlatformSettingsResponse>("/platform/settings");
  },

  async updatePlatformSettings(payload: { commissionBasisPoints: number; defaultFeeBearer: string }): Promise<PlatformSettingsResponse["settings"]> {
    return put<PlatformSettingsResponse["settings"]>("/platform/settings", payload);
  },
};

export default AdminService;
