export interface SermonOutline {
  id: string;
  topic: string;
  title: string;
  scripture: string;
  introduction: string;
  points: { title: string; content: string; scripture: string }[];
  conclusion: string;
  applicationPoints: string[];
  createdAt: string;
}

export interface SermonGenerateRequest {
  topic: string;
  style?: "expository" | "topical" | "narrative" | "textual";
  duration?: "15min" | "30min" | "45min" | "1hr";
  targetAudience?: string;
}

export interface MemberInsight {
  id: string;
  memberId: string;
  memberName: string;
  type: "inactive_warning" | "engagement_drop" | "milestone" | "follow_up";
  severity: "low" | "medium" | "high";
  message: string;
  suggestedAction: string;
  data: Record<string, unknown>;
  createdAt: string;
  isRead: boolean;
}

export interface PrayerChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  scriptures?: { reference: string; text: string }[];
  timestamp: string;
}

export interface PrayerChatRequest {
  message: string;
  conversationId?: string;
}

export interface PrayerChatResponse {
  message: PrayerChatMessage;
  conversationId: string;
}
