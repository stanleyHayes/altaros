export type GivingType = "tithe" | "offering" | "donation" | "campaign";

export type GivingPaymentMethod =
  | "card"
  | "bank_transfer"
  | "mobile_money"
  | "ussd";

export type GivingPaymentStatus = "pending" | "success" | "failed";

export interface GivingRecord {
  id: string;
  memberId: string;
  churchId: string;
  amount: number;
  type: GivingType;
  paymentMethod: GivingPaymentMethod;
  status: GivingPaymentStatus;
  reference: string;
  note?: string;
  campaignId?: string;
  date: Date;
}

export interface GivingSummary {
  totalThisMonth: number;
  totalThisYear: number;
  titheThisMonth: number;
  offeringThisMonth: number;
  donationsThisMonth: number;
}

export interface GivingCampaign {
  id: string;
  churchId: string;
  title: string;
  description: string;
  targetAmount: number;
  raisedAmount: number;
  startDate: Date;
  endDate: Date;
  imageUrl?: string;
}
