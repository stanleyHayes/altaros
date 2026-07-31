export type WelfareCategory =
  | "financial"
  | "medical"
  | "food"
  | "housing"
  | "counseling"
  | "other";

export type WelfareUrgency = "low" | "medium" | "high" | "critical";

export type WelfareStatus =
  | "pending"
  | "under_review"
  | "approved"
  | "fulfilled"
  | "declined";

export interface WelfareRequest {
  id: string;
  churchId: string;
  memberId: string;
  category: WelfareCategory;
  description: string;
  urgency: WelfareUrgency;
  isAnonymous: boolean;
  status: WelfareStatus;
  createdAt: Date;
}

export interface EmergencyAlert {
  id: string;
  churchId: string;
  memberId: string;
  title: string;
  description: string;
  latitude?: number;
  longitude?: number;
  isActive: boolean;
  createdAt: Date;
}

export interface VolunteerOpportunity {
  id: string;
  churchId: string;
  title: string;
  description: string;
  date: Date;
  spotsAvailable: number;
  spotsTotal: number;
}
