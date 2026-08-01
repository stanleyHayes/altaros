import {
  isReservedSlug,
  type Church,
  type PaginationQuery,
} from "@altar-os/shared-types";
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
    this.assertUsableSlug(slug);

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
      // Checked on rename too. A church that renames into `api` is the same
      // routing collision as one created there.
      this.assertUsableSlug(data.slug);
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

  /**
   * Refuses a slug that cannot be a church's subdomain (WP-39, §13.1).
   *
   * Under ADR-007 the slug IS the subdomain, so this is a routing decision
   * rather than a naming one — and it has to happen at creation, because a
   * church that has already printed `api.altaros.com` on its bulletins cannot
   * simply be renamed.
   *
   * The reserved list is shared with the Go services through
   * @altar-os/shared-types rather than copied, and a Go test reads that file
   * and fails if the two drift. WP-35 is why: a rule about one collection kept
   * separately by two writers drifts silently, and whichever ran last wins.
   */
  private assertUsableSlug(slug: string): void {
    if (slug.length < 3 || slug.length > 63) {
      throw new AppError(
        400,
        "That church name is too short or too long to use as a web address",
      );
    }
    if (isReservedSlug(slug)) {
      throw new AppError(
        409,
        "That name is reserved by the platform. Please choose another.",
      );
    }
  }
}
