import { MemberStatus } from "./member";

export enum MessageChannel {
  PUSH = "PUSH",
  SMS = "SMS",
  EMAIL = "EMAIL",
}

export type ActivityLevel = "active" | "inactive" | "all";

export interface MessageTargetFilter {
  departmentIds?: string[];
  locations?: string[];
  memberStatuses?: MemberStatus[];
  activityLevel?: ActivityLevel;
}

export interface Message {
  id: string;
  churchId: string;
  senderId: string;
  title: string;
  body: string;
  channel: MessageChannel;
  targetFilter?: MessageTargetFilter;
  sentAt?: Date;
  createdAt: Date;
}

export interface Announcement {
  id: string;
  churchId: string;
  title: string;
  body: string;
  imageUrl?: string;
  isPinned: boolean;
  expiresAt?: Date;
  createdAt: Date;
}

export interface GroupChat {
  id: string;
  churchId: string;
  name: string;
  description?: string;
  memberIds: string[];
  createdBy: string;
  imageUrl?: string;
  lastMessageAt?: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  groupId: string;
  senderId: string;
  senderName: string;
  content: string;
  createdAt: string;
}
