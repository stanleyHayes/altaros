import type {
  Message,
  Announcement,
  PaginationQuery,
} from "@altar-os/shared-types";
import type { PaginatedResult } from "../../church/ports/church.repository.port.js";

export interface CreateMessageData {
  churchId: string;
  senderId: string;
  title: string;
  body: string;
  channel: string;
  targetFilter?: {
    departmentIds?: string[];
    locations?: string[];
    memberStatuses?: string[];
    activityLevel?: string;
  };
}

export interface CreateAnnouncementData {
  churchId: string;
  title: string;
  body: string;
  imageUrl?: string;
  isPinned?: boolean;
  expiresAt?: Date;
}

export type UpdateAnnouncementData = Partial<CreateAnnouncementData>;

export interface ICommunicationRepository {
  createMessage(data: CreateMessageData): Promise<Message>;
  findMessagesByChurchId(
    churchId: string,
    query: PaginationQuery,
  ): Promise<PaginatedResult<Message>>;
  findMessageById(id: string): Promise<Message | null>;
  createAnnouncement(data: CreateAnnouncementData): Promise<Announcement>;
  findAnnouncementsByChurchId(
    churchId: string,
    query: PaginationQuery,
  ): Promise<PaginatedResult<Announcement>>;
  findAnnouncementById(id: string): Promise<Announcement | null>;
  updateAnnouncement(
    id: string,
    data: UpdateAnnouncementData,
  ): Promise<Announcement | null>;
  deleteAnnouncement(id: string): Promise<boolean>;
}
