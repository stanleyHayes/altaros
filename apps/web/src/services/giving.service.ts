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
    return post<PaymentResponse>("/finance/give", payload);
  },

  /**
   * The caller's own giving.
   *
   * No page or limit arguments, because the endpoint has no paging and
   * accepting them would be a promise the server never made — a caller
   * asking for page 2 would silently receive page 1 with no error.
   */
  async getHistory(): Promise<GivingRecord[]> {
    const records = await get<GivingRecord[]>("/finance/me/giving");
    return Array.isArray(records) ? records : [];
  },

  async getSummary(): Promise<GivingSummary> {
    // Note: GET /finance/summary requires finance:read permission and is for admins.
    // Members see their own giving via /finance/me/giving. This method should not
    // be called by member-facing UI. Left for potential staff/admin use.
    return get<GivingSummary>("/finance/summary");
  },

  async getCampaigns(): Promise<Campaign[]> {
    // GET /finance/me/campaigns returns {"campaigns": [...]} wrapped format,
    // but api.ts unwraps it to just the array
    const response = await get<{ campaigns: Campaign[] }>("/finance/me/campaigns");
    return response.campaigns || [];
  },
};

export default GivingService;
