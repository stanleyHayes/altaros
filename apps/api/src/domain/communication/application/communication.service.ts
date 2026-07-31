import type {
  Message,
  Announcement,
  PaginationQuery,
} from "@altar-os/shared-types";
import type {
  ICommunicationRepository,
  CreateMessageData,
  CreateAnnouncementData,
  UpdateAnnouncementData,
} from "../ports/communication.repository.port.js";
import type { PaginatedResult } from "../../church/ports/church.repository.port.js";
import { AppError } from "../../../infrastructure/middleware/error.middleware.js";

export class CommunicationService {
  constructor(private readonly commRepo: ICommunicationRepository) {}

  async sendMessage(data: CreateMessageData): Promise<Message> {
    return this.commRepo.createMessage(data);
  }

  async getMessages(
    churchId: string,
    query: PaginationQuery,
  ): Promise<PaginatedResult<Message>> {
    return this.commRepo.findMessagesByChurchId(churchId, query);
  }

  async getMessageById(id: string): Promise<Message> {
    const message = await this.commRepo.findMessageById(id);
    if (!message) {
      throw new AppError(404, "Message not found");
    }
    return message;
  }

  async createAnnouncement(
    data: CreateAnnouncementData,
  ): Promise<Announcement> {
    return this.commRepo.createAnnouncement(data);
  }

  async getAnnouncements(
    churchId: string,
    query: PaginationQuery,
  ): Promise<PaginatedResult<Announcement>> {
    return this.commRepo.findAnnouncementsByChurchId(churchId, query);
  }

  async updateAnnouncement(
    id: string,
    data: UpdateAnnouncementData,
  ): Promise<Announcement> {
    const announcement = await this.commRepo.updateAnnouncement(id, data);
    if (!announcement) {
      throw new AppError(404, "Announcement not found");
    }
    return announcement;
  }

  async deleteAnnouncement(id: string): Promise<void> {
    const deleted = await this.commRepo.deleteAnnouncement(id);
    if (!deleted) {
      throw new AppError(404, "Announcement not found");
    }
  }
}
