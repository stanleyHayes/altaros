import type { Member } from "@altar-os/shared-types";
import type {
  IMemberRepository,
  CreateMemberData,
  UpdateMemberData,
  MemberSearchQuery,
} from "../ports/member.repository.port.js";
import type { PaginatedResult } from "../../church/ports/church.repository.port.js";
import { AppError } from "../../../infrastructure/middleware/error.middleware.js";

export class MemberService {
  constructor(private readonly memberRepo: IMemberRepository) {}

  async create(data: CreateMemberData): Promise<Member> {
    return this.memberRepo.create(data);
  }

  async getById(id: string): Promise<Member> {
    const member = await this.memberRepo.findById(id);
    if (!member) {
      throw new AppError(404, "Member not found");
    }
    return member;
  }

  async getByChurchId(
    churchId: string,
    query: MemberSearchQuery,
  ): Promise<PaginatedResult<Member>> {
    return this.memberRepo.findByChurchId(churchId, query);
  }

  async getByFamilyId(familyId: string): Promise<Member[]> {
    return this.memberRepo.findByFamilyId(familyId);
  }

  async update(id: string, data: UpdateMemberData): Promise<Member> {
    const member = await this.memberRepo.update(id, data);
    if (!member) {
      throw new AppError(404, "Member not found");
    }
    return member;
  }

  async delete(id: string): Promise<void> {
    const deleted = await this.memberRepo.delete(id);
    if (!deleted) {
      throw new AppError(404, "Member not found");
    }
  }

  async countByChurchId(churchId: string): Promise<number> {
    return this.memberRepo.countByChurchId(churchId);
  }
}
