import { get, put } from "./api";
import type {
  Notification,
  NotificationPreference,
} from "@altar-os/shared-types";

export interface NotificationListResponse {
  success: boolean;
  data: Notification[];
}

export interface PreferenceResponse {
  success: boolean;
  data: NotificationPreference;
}

const NotificationService = {
  async getNotifications(): Promise<Notification[]> {
    const res = await get<NotificationListResponse>("/notifications");
    return res.data;
  },

  async markAsRead(id: string): Promise<void> {
    await put(`/notifications/${id}/read`);
  },

  async getPreferences(): Promise<NotificationPreference> {
    const res = await get<PreferenceResponse>("/notifications/preferences");
    return res.data;
  },

  async updatePreferences(
    prefs: Partial<NotificationPreference> & { churchId: string },
  ): Promise<NotificationPreference> {
    const res = await put<PreferenceResponse>(
      "/notifications/preferences",
      prefs,
    );
    return res.data;
  },
};

export default NotificationService;
