import type { Member, MemberStatus, PaginationQuery } from "@altar-os/shared-types";
import type { PaginatedResult } from "../../church/ports/church.repository.port.js";

export interface CreateMemberData {
  churchId: string;
  userId?: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  dateOfBirth?: Date;
  gender?: string;
  address?: string;
  familyId?: string;
  departmentIds?: string[];
  status?: MemberStatus;
  joinDate?: Date;
  notes?: string;
}

export type UpdateMemberData = Partial<CreateMemberData>;

export interface MemberSearchQuery extends PaginationQuery {
  search?: string;
  status?: MemberStatus;
}

export interface IMemberRepository {
  findById(id: string): Promise<Member | null>;
  findByChurchId(
    churchId: string,
    query: MemberSearchQuery,
  ): Promise<PaginatedResult<Member>>;
  findByFamilyId(familyId: string): Promise<Member[]>;
  create(data: CreateMemberData): Promise<Member>;
  update(id: string, data: UpdateMemberData): Promise<Member | null>;
  delete(id: string): Promise<boolean>;
  countByChurchId(churchId: string): Promise<number>;
}
