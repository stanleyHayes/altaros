import api from './api';

export interface Devotional {
  id: string;
  title: string;
  scripture: string;
  scriptureReference: string;
  content: string;
  author: string;
  date: string;
  imageUrl?: string;
}

export interface Sermon {
  id: string;
  title: string;
  speaker: string;
  date: string;
  duration: string;
  audioUrl?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  series?: string;
  description?: string;
}

export interface PrayerRequest {
  id: string;
  title: string;
  description: string;
  isAnonymous: boolean;
  category: 'health' | 'family' | 'finances' | 'spiritual' | 'other';
  prayerCount: number;
  status: 'active' | 'answered' | 'closed';
  createdAt: string;
  authorName?: string;
}

export interface CreatePrayerRequest {
  title: string;
  description: string;
  isAnonymous: boolean;
  category: PrayerRequest['category'];
}

const spiritualService = {
  async getTodayDevotional(): Promise<Devotional> {
    const { data } = await api.get<Devotional>('/spiritual/devotional/today');
    return data;
  },

  async getDevotionals(params?: {
    page?: number;
    limit?: number;
  }): Promise<{ devotionals: Devotional[]; total: number }> {
    const { data } = await api.get('/spiritual/devotionals', { params });
    return data;
  },

  async getSermons(params?: {
    page?: number;
    limit?: number;
    series?: string;
  }): Promise<{ sermons: Sermon[]; total: number }> {
    const { data } = await api.get('/spiritual/sermons', { params });
    return data;
  },

  async getSermon(id: string): Promise<Sermon> {
    const { data } = await api.get<Sermon>(`/spiritual/sermons/${id}`);
    return data;
  },

  async getPrayerRequests(params?: {
    page?: number;
    limit?: number;
    category?: string;
  }): Promise<{ requests: PrayerRequest[]; total: number }> {
    const { data } = await api.get('/spiritual/prayers', { params });
    return data;
  },

  async createPrayerRequest(
    request: CreatePrayerRequest,
  ): Promise<PrayerRequest> {
    const { data } = await api.post<PrayerRequest>(
      '/spiritual/prayers',
      request,
    );
    return data;
  },

  async prayForRequest(requestId: string): Promise<{ prayerCount: number }> {
    const { data } = await api.post(`/spiritual/prayers/${requestId}/pray`);
    return data;
  },
};

export default spiritualService;
