import { post, get } from "./api";

export type GivingType = "tithe" | "offering" | "donation" | "campaign";
export type PaymentMethod = "card" | "bank_transfer" | "mobile_money" | "ussd";
export type PaymentStatus = "pending" | "success" | "failed";

export interface InitiatePaymentPayload {
  amount: number;
  type: GivingType;
  paymentMethod: PaymentMethod;
  campaignId?: string;
  note?: string;
}

export interface PaymentResponse {
  id: string;
  reference: string;
  authorizationUrl?: string;
  status: PaymentStatus;
}

export interface GivingRecord {
  id: string;
  amount: number;
  type: GivingType;
  paymentMethod: PaymentMethod;
  status: PaymentStatus;
  reference: string;
  date: string;
  note?: string;
}

export interface GivingSummary {
  totalThisMonth: number;
  totalThisYear: number;
  titheThisMonth: number;
  offeringThisMonth: number;
  donationsThisMonth: number;
}

export interface Campaign {
  id: string;
  title: string;
  description: string;
  targetAmount: number;
  raisedAmount: number;
  startDate: string;
  endDate: string;
  imageUrl?: string;
}

const GivingService = {
  async initiatePayment(payload: InitiatePaymentPayload): Promise<PaymentResponse> {
    // TODO: Replace with actual API call
    return post<PaymentResponse>("/giving/initiate", payload);
  },

  async verifyPayment(reference: string): Promise<GivingRecord> {
    // TODO: Replace with actual API call
    return get<GivingRecord>(`/giving/verify/${reference}`);
  },

  async getHistory(page = 1, limit = 20): Promise<{ data: GivingRecord[]; total: number }> {
    // TODO: Replace with actual API call
    return get(`/giving/history?page=${page}&limit=${limit}`);
  },

  async getSummary(): Promise<GivingSummary> {
    // TODO: Replace with actual API call
    return get<GivingSummary>("/giving/summary");
  },

  async getCampaigns(): Promise<Campaign[]> {
    // TODO: Replace with actual API call
    return get<Campaign[]>("/giving/campaigns");
  },
};

export default GivingService;
