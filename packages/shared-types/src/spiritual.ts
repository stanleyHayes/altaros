export interface Devotional {
  id: string;
  churchId: string;
  title: string;
  scripture: string;
  scriptureText: string;
  content: string;
  date: Date;
  author: string;
  imageUrl?: string;
}

export interface Sermon {
  id: string;
  churchId: string;
  title: string;
  speaker: string;
  date: Date;
  duration: string;
  thumbnailUrl?: string;
  audioUrl?: string;
  videoUrl?: string;
  description: string;
  series?: string;
}

export interface PrayerRequest {
  id: string;
  churchId: string;
  memberId: string;
  title: string;
  description: string;
  isAnonymous: boolean;
  prayerCount: number;
  authorName?: string;
  createdAt: Date;
}
