import { MemberStatus } from "./member";

export enum NotificationChannel {
  PUSH = "PUSH",
  SMS = "SMS",
  EMAIL = "EMAIL",
}

export enum NotificationType {
  EVENT_REMINDER = "EVENT_REMINDER",
  GIVING_REMINDER = "GIVING_REMINDER",
  EMERGENCY_ALERT = "EMERGENCY_ALERT",
  WELCOME = "WELCOME",
  BIRTHDAY = "BIRTHDAY",
  FOLLOW_UP = "FOLLOW_UP",
  ANNOUNCEMENT = "ANNOUNCEMENT",
  CUSTOM = "CUSTOM",
}

export enum NotificationStatus {
  PENDING = "PENDING",
  SENT = "SENT",
  FAILED = "FAILED",
  READ = "READ",
}

export interface Notification {
  id: string;
  churchId: string;
  recipientId: string;
  recipientName: string;
  channel: NotificationChannel;
  type: NotificationType;
  title: string;
  body: string;
  status: NotificationStatus;
  scheduledAt?: Date;
  sentAt?: Date;
  readAt?: Date;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface NotificationPreference {
  id: string;
  userId: string;
  churchId: string;
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
  eventReminders: boolean;
  givingReminders: boolean;
  emergencyAlerts: boolean;
  announcements: boolean;
}

export interface NotificationTemplate {
  id: string;
  churchId: string;
  type: NotificationType;
  channel: NotificationChannel;
  subject: string;
  body: string;
  isDefault: boolean;
}

export interface SendNotificationRequest {
  recipientIds: string[];
  channel: NotificationChannel;
  type: NotificationType;
  title: string;
  body: string;
  scheduledAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface BulkNotificationRequest {
  churchId: string;
  targetFilter: {
    departmentIds?: string[];
    memberStatuses?: MemberStatus[];
    all?: boolean;
  };
  channel: NotificationChannel;
  type: NotificationType;
  title: string;
  body: string;
}
