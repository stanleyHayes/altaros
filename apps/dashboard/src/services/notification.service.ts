import { get, post, put } from "./api";
import type {
  Notification,
  NotificationTemplate,
  SendNotificationRequest,
  BulkNotificationRequest,
} from "@altar-os/shared-types";

export interface NotificationListResponse {
  success: boolean;
  data: Notification[];
}

export interface NotificationSendResponse {
  success: boolean;
  data: Notification[];
  message: string;
}

export interface BulkSendResponse {
  success: boolean;
  data: { sent: number; failed: number };
  message: string;
}

export interface TemplateResponse {
  success: boolean;
  data: NotificationTemplate;
  message: string;
}

const NotificationService = {
  async send(payload: SendNotificationRequest): Promise<NotificationSendResponse> {
    return post<NotificationSendResponse>("/notifications/send", payload);
  },

  async sendBulk(payload: BulkNotificationRequest): Promise<BulkSendResponse> {
    return post<BulkSendResponse>("/notifications/send-bulk", payload);
  },

  async getNotifications(): Promise<Notification[]> {
    const res = await get<NotificationListResponse>("/notifications");
    return res.data;
  },

  async markAsRead(id: string): Promise<void> {
    await put(`/notifications/${id}/read`);
  },

  async getTemplates(): Promise<NotificationTemplate[]> {
    const res = await get<{ success: boolean; data: NotificationTemplate[] }>(
      "/notifications/templates",
    );
    return res.data;
  },

  async saveTemplate(
    template: Omit<NotificationTemplate, "id">,
  ): Promise<TemplateResponse> {
    return post<TemplateResponse>("/notifications/templates", template);
  },
};

export default NotificationService;
