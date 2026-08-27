import { get, post, patch } from "./api";

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

/**
 * What GET /members actually accepts.
 *
 * This interface previously advertised query, group, page, sortBy and
 * sortOrder. The endpoint supports none of them — it reads `status` and
 * `limit` and ignores the rest — so the extra fields were a promise the
 * server never made, and any caller trusting them got unfiltered results
 * with no error to explain why.
 */
export interface MemberSearchParams {
  status?: string;
  limit?: number;
}



const MemberService = {
  /** The congregation. Returns a bare array — the endpoint is not paginated. */
  async getAll(params?: MemberSearchParams): Promise<Member[]> {
    const members = await get<Member[]>("/members", { params });
    return Array.isArray(members) ? members : [];
  },

  async getById(id: string): Promise<Member> {
    return get<Member>(`/members/${id}`);
  },

  async create(payload: CreateMemberPayload): Promise<Member> {
    return post<Member>("/members", payload);
  },

  /** Correct a member's details. PATCH, not PUT — there is no PUT route. */
  async update(id: string, payload: UpdateMemberPayload): Promise<Member> {
    return patch<Member>(`/members/${id}`, payload);
  },

  /**
   * Take someone off the active roll.
   *
   * Named for what it does. There is no DELETE route and there should not be
   * one: a church must keep six years of financial records (Act 915 s.28), so
   * a giving history outlives the person's place on the roster. Erasure is a
   * data-subject right exercised through the privacy flow, not a row a church
   * admin can drop from a table.
   */
  async deactivate(id: string): Promise<void> {
    await patch<unknown>(`/members/${id}/status`, { status: "inactive" });
  },
};

export default MemberService;
