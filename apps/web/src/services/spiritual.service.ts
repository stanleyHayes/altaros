import { get, post } from "./api";

export interface Devotional {
  id: string;
  title: string;
  scripture: string;
  scriptureText: string;
  content: string;
  date: string;
  author: string;
  imageUrl?: string;
}

export interface Sermon {
  id: string;
  title: string;
  speaker: string;
  date: string;
  duration: string;
  thumbnailUrl?: string;
  audioUrl?: string;
  videoUrl?: string;
  description: string;
  series?: string;
}

export interface PrayerRequest {
  id: string;
  title: string;
  description: string;
  isAnonymous: boolean;
  createdAt: string;
  prayerCount: number;
}

export interface CreatePrayerRequestPayload {
  title: string;
  description: string;
  isAnonymous: boolean;
}

const SpiritualService = {
  async getDevotionals(page = 1): Promise<{ data: Devotional[]; total: number }> {
    // TODO: Replace with actual API call
    return get(`/spiritual/devotionals?page=${page}`);
  },

  async getDevotional(id: string): Promise<Devotional> {
    // TODO: Replace with actual API call
    return get<Devotional>(`/spiritual/devotionals/${id}`);
  },

  async getSermons(page = 1): Promise<{ data: Sermon[]; total: number }> {
    // TODO: Replace with actual API call
    return get(`/spiritual/sermons?page=${page}`);
  },

  async getSermon(id: string): Promise<Sermon> {
    // TODO: Replace with actual API call
    return get<Sermon>(`/spiritual/sermons/${id}`);
  },

  async submitPrayerRequest(payload: CreatePrayerRequestPayload): Promise<PrayerRequest> {
    // TODO: Replace with actual API call
    return post<PrayerRequest>("/spiritual/prayer-requests", payload);
  },

  async getPrayerRequests(): Promise<PrayerRequest[]> {
    // TODO: Replace with actual API call
    return get<PrayerRequest[]>("/spiritual/prayer-requests");
  },

  async prayForRequest(id: string): Promise<void> {
    // TODO: Replace with actual API call
    return post(`/spiritual/prayer-requests/${id}/pray`);
  },
};

export default SpiritualService;
