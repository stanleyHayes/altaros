import type { Church, ChurchPlan, PaginationQuery } from "@altar-os/shared-types";

export interface CreateChurchData {
  name: string;
  slug: string;
  address: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  website?: string;
  logoUrl?: string;
  bannerUrl?: string;
  timezone: string;
  currency: string;
  requestedPlan?: ChurchPlan;
  denomination?: string;
  averageWeeklyAttendance?: number;
  ministryPriorities?: string[];
}

export type UpdateChurchData = Partial<CreateChurchData>;

export interface PaginatedResult<T> {
  data: T[];
  total: number;
}

export interface IChurchRepository {
  findById(id: string): Promise<Church | null>;
  findBySlug(slug: string): Promise<Church | null>;
  findAll(query: PaginationQuery): Promise<PaginatedResult<Church>>;
  create(data: CreateChurchData): Promise<Church>;
  update(id: string, data: UpdateChurchData): Promise<Church | null>;
  delete(id: string): Promise<boolean>;
}
