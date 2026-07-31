import { get, post, put, del } from "./api";

export interface Member {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  address?: string;
  dateOfBirth?: string;
  memberSince: string;
  status: "active" | "inactive" | "visitor";
  role?: string;
  groups?: string[];
  avatarUrl?: string;
  churchId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMemberPayload {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  address?: string;
  dateOfBirth?: string;
  status?: "active" | "inactive" | "visitor";
  role?: string;
  groups?: string[];
}

export type UpdateMemberPayload = Partial<CreateMemberPayload>;

export interface MemberSearchParams {
  query?: string;
  status?: string;
  group?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const MemberService = {
  async getAll(
    params?: MemberSearchParams,
  ): Promise<PaginatedResponse<Member>> {
    return get<PaginatedResponse<Member>>("/members", { params });
  },

  async getById(id: string): Promise<Member> {
    return get<Member>(`/members/${id}`);
  },

  async create(payload: CreateMemberPayload): Promise<Member> {
    return post<Member>("/members", payload);
  },

  async update(id: string, payload: UpdateMemberPayload): Promise<Member> {
    return put<Member>(`/members/${id}`, payload);
  },

  async remove(id: string): Promise<void> {
    return del<void>(`/members/${id}`);
  },

  async search(query: string): Promise<Member[]> {
    return get<Member[]>("/members/search", { params: { q: query } });
  },
};

export default MemberService;
