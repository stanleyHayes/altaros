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

const ChurchService = {
  async getAll(): Promise<Church[]> {
    return get<Church[]>("/churches");
  },

  async getById(id: string): Promise<Church> {
    return get<Church>(`/churches/${id}`);
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
