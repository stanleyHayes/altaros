import type { Church, PaginationQuery } from "@altar-os/shared-types";
import type {
  IChurchRepository,
  CreateChurchData,
  UpdateChurchData,
  PaginatedResult,
} from "../ports/church.repository.port.js";
import { AppError } from "../../../infrastructure/middleware/error.middleware.js";

export class ChurchService {
  constructor(private readonly churchRepo: IChurchRepository) {}

  async create(
    data: Omit<CreateChurchData, "slug">,
  ): Promise<Church> {
    const slug = this.generateSlug(data.name);

    const existing = await this.churchRepo.findBySlug(slug);
    if (existing) {
      throw new AppError(409, "A church with this name already exists");
    }

    return this.churchRepo.create({ ...data, slug });
  }

  async getById(id: string): Promise<Church> {
    const church = await this.churchRepo.findById(id);
    if (!church) {
      throw new AppError(404, "Church not found");
    }
    return church;
  }

  async getBySlug(slug: string): Promise<Church> {
    const church = await this.churchRepo.findBySlug(slug);
    if (!church) {
      throw new AppError(404, "Church not found");
    }
    return church;
  }

  async getAll(
    query: PaginationQuery,
  ): Promise<PaginatedResult<Church>> {
    return this.churchRepo.findAll(query);
  }

  async update(
    id: string,
    data: UpdateChurchData,
  ): Promise<Church> {
    if (data.name) {
      data.slug = this.generateSlug(data.name);
    }

    const church = await this.churchRepo.update(id, data);
    if (!church) {
      throw new AppError(404, "Church not found");
    }
    return church;
  }

  async delete(id: string): Promise<void> {
    const deleted = await this.churchRepo.delete(id);
    if (!deleted) {
      throw new AppError(404, "Church not found");
    }
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }
}
