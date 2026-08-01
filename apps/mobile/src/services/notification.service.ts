import api from './api';

export interface MemberNotification {
  id: string;
  title: string;
  body: string;
  readAt?: string;
  createdAt: string;
  deepLink?: string;
}

const notificationService = {
  async list(): Promise<MemberNotification[]> {
    const { data } = await api.get<MemberNotification[]>('/notifications/me');
    return data;
  },
  async markRead(id: string): Promise<void> {
    await api.post(`/notifications/${id}/read`);
  },
  async registerDevice(expoPushToken: string): Promise<void> {
    await api.post('/notifications/devices', { token: expoPushToken, platform: 'expo' });
  },
};

export default notificationService;
