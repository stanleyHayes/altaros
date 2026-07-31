import { get, patch } from "./api";

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

interface StatsResponse {
  success: boolean;
  data: PlatformStats;
}

interface ChurchesResponse {
  success: boolean;
  data: ChurchRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface UsersResponse {
  success: boolean;
  data: UserRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface HealthResponse {
  success: boolean;
  data: SystemHealth;
}

const AdminService = {
  async getStats(): Promise<StatsResponse> {
    return get<StatsResponse>("/admin/stats");
  },

  async getChurches(page = 1, limit = 20): Promise<ChurchesResponse> {
    return get<ChurchesResponse>(`/admin/churches?page=${page}&limit=${limit}`);
  },

  async updateChurchStatus(id: string, isActive: boolean): Promise<void> {
    await patch(`/admin/churches/${id}/status`, { isActive });
  },

  async getUsers(page = 1, limit = 20, role?: string, search?: string): Promise<UsersResponse> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (role) params.set("role", role);
    if (search) params.set("search", search);
    return get<UsersResponse>(`/admin/users?${params}`);
  },

  async getHealth(): Promise<HealthResponse> {
    return get<HealthResponse>("/admin/health");
  },
};

export default AdminService;
