import { get, post, put, del } from "./api";

export interface Message {
  id: string;
  subject: string;
  body: string;
  type: "email" | "sms" | "push";
  recipients: string[];
  recipientCount: number;
  status: "draft" | "scheduled" | "sent" | "failed";
  scheduledAt?: string;
  sentAt?: string;
  churchId: string;
  createdBy: string;
  createdAt: string;
}

export interface CreateMessagePayload {
  subject: string;
  body: string;
  type: Message["type"];
  recipients: string[];
  scheduledAt?: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  priority: "low" | "normal" | "high" | "urgent";
  isPublished: boolean;
  publishedAt?: string;
  expiresAt?: string;
  churchId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAnnouncementPayload {
  title: string;
  content: string;
  priority?: Announcement["priority"];
  isPublished?: boolean;
  expiresAt?: string;
}

export type UpdateAnnouncementPayload = Partial<CreateAnnouncementPayload>;

const CommunicationService = {
  async getMessages(): Promise<Message[]> {
    return get<Message[]>("/communications/messages");
  },

  async getMessageById(id: string): Promise<Message> {
    return get<Message>(`/communications/messages/${id}`);
  },

  async createMessage(payload: CreateMessagePayload): Promise<Message> {
    return post<Message>("/communications/messages", payload);
  },

  async sendMessage(id: string): Promise<Message> {
    return post<Message>(`/communications/messages/${id}/send`);
  },

  async getAnnouncements(): Promise<Announcement[]> {
    return get<Announcement[]>("/communications/announcements");
  },

  async getAnnouncementById(id: string): Promise<Announcement> {
    return get<Announcement>(`/communications/announcements/${id}`);
  },

  async createAnnouncement(
    payload: CreateAnnouncementPayload,
  ): Promise<Announcement> {
    return post<Announcement>("/communications/announcements", payload);
  },

  async updateAnnouncement(
    id: string,
    payload: UpdateAnnouncementPayload,
  ): Promise<Announcement> {
    return put<Announcement>(`/communications/announcements/${id}`, payload);
  },

  async deleteAnnouncement(id: string): Promise<void> {
    return del<void>(`/communications/announcements/${id}`);
  },
};

export default CommunicationService;
