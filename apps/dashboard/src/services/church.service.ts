import { get, post, put, del } from "./api";

export interface Church {
  id: string;
  name: string;
  slug: string;
  description?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  logoUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateChurchPayload {
  name: string;
  description?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
}

export type UpdateChurchPayload = Partial<CreateChurchPayload>;

export interface VisibleChurch {
  id: string;
  churchId: string;
  churchName: string;
  city: string;
  country: string;
  denomination: string;
  memberCount: number;
  logoUrl?: string;
  description: string;
  services: { day: string; time: string; name: string }[];
  isVerified: boolean;
  rating: number;
  reviewCount: number;
}

const ChurchService = {
  async getAll(): Promise<Church[]> {
    return get<Church[]>("/churches");
  },

  async getById(id: string): Promise<Church> {
    return get<Church>(`/churches/${id}`);
  },

  async getCurrent(): Promise<Church> {
    return get<Church>("/churches/current");
  },

  async getVisible(): Promise<VisibleChurch[]> {
    return get<VisibleChurch[]>("/churches/visible");
  },

  async create(payload: CreateChurchPayload): Promise<Church> {
    return post<Church>("/churches", payload);
  },

  async update(id: string, payload: UpdateChurchPayload): Promise<Church> {
    return put<Church>(`/churches/${id}`, payload);
  },

  async remove(id: string): Promise<void> {
    return del<void>(`/churches/${id}`);
  },
};

export default ChurchService;
