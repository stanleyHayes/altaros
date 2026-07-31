import { get, post, put } from "./api";

export type WelfareCategory =
  | "financial"
  | "medical"
  | "food"
  | "housing"
  | "counseling"
  | "other";

export type WelfareUrgency = "low" | "medium" | "high" | "critical";

export type WelfareStatus = "pending" | "under_review" | "approved" | "fulfilled" | "declined";

export interface WelfareRequest {
  id: string;
  category: WelfareCategory;
  description: string;
  urgency: WelfareUrgency;
  isAnonymous: boolean;
  status: WelfareStatus;
  createdAt: string;
}

export interface CreateWelfareRequestPayload {
  category: WelfareCategory;
  description: string;
  urgency: WelfareUrgency;
  anonymous: boolean;
}

export interface EmergencyAlert {
  id: string;
  title: string;
  description: string;
  isActive: boolean;
  createdAt: string;
}

export interface SendEmergencyAlertPayload {
  latitude?: number;
  longitude?: number;
  message?: string;
}

export interface VolunteerOpportunity {
  id: string;
  title: string;
  description: string;
  date: string;
  spotsAvailable: number;
  spotsTotal: number;
}

const WelfareService = {
  /** Submit a new welfare/assistance request */
  async submitRequest(payload: CreateWelfareRequestPayload): Promise<WelfareRequest> {
    // TODO: Replace with actual API call
    return post<WelfareRequest>("/welfare/requests", payload);
  },

  /** Get all welfare requests for the current user */
  async getMyRequests(): Promise<WelfareRequest[]> {
    // TODO: Replace with actual API call
    return get<WelfareRequest[]>("/welfare/my-requests");
  },

  /** Send an emergency alert to church leadership */
  async sendEmergencyAlert(payload: SendEmergencyAlertPayload): Promise<{ success: boolean }> {
    // TODO: Replace with actual API call
    return post<{ success: boolean }>("/welfare/emergency-alert", payload);
  },

  /** Get recent emergency alerts from the church */
  async getEmergencyAlerts(): Promise<EmergencyAlert[]> {
    // TODO: Replace with actual API call
    return get<EmergencyAlert[]>("/welfare/emergency-alerts");
  },

  /** Get available volunteer opportunities */
  async getVolunteerOpportunities(): Promise<VolunteerOpportunity[]> {
    // TODO: Replace with actual API call
    return get<VolunteerOpportunity[]>("/welfare/volunteer-opportunities");
  },

  /** Sign up for a specific volunteer opportunity */
  async signUpForVolunteer(opportunityId: string): Promise<{ success: boolean }> {
    // TODO: Replace with actual API call
    return post<{ success: boolean }>(`/welfare/volunteer-opportunities/${opportunityId}/signup`);
  },

  /** Update the current user's volunteer availability status */
  async updateVolunteerAvailability(available: boolean): Promise<{ success: boolean }> {
    // TODO: Replace with actual API call
    return put<{ success: boolean }>("/welfare/volunteer-availability", { available });
  },
};

export default WelfareService;
