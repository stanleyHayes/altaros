import api from './api';

export type GivingType = 'tithe' | 'offering' | 'donation' | 'campaign' | 'pledge_payment';
export type PaymentChannel = 'mobile_money' | 'card' | 'bank_transfer' | 'ussd';
export type PaymentStatus = 'pending' | 'success' | 'failed' | 'reversed';

export interface GivingRecord {
  id: string;
  churchId: string;
  memberId?: string;
  type: GivingType;
  channel: PaymentChannel;
  grossMinor: number;
  levyMinor: number;
  netMinor: number;
  currency: string;
  status: PaymentStatus;
  providerRef?: string;
  idempotencyKey: string;
  note?: string;
  occurredAt: string;
  createdAt: string;
}

export interface GiveRequest {
  amount: string;
  currency: 'GHS';
  type: GivingType;
  channel: PaymentChannel;
  email?: string;
  note?: string;
  anonymous?: boolean;
  callbackUrl?: string;
}

interface MoneyAmount { minor: number; currency: string }
export interface LevyQuote {
  levy: MoneyAmount;
  total: MoneyAmount;
  exempt: boolean;
  reason: string;
}

export interface GiveResult {
  transaction: GivingRecord;
  authorizationUrl?: string;
  accessCode?: string;
  levy: LevyQuote;
}

const givingService = {
  async give(payload: GiveRequest): Promise<GiveResult> {
    const { data } = await api.post<GiveResult>('/finance/give', payload);
    return data;
  },

  async getHistory(params?: { from?: string; to?: string }): Promise<GivingRecord[]> {
    const { data } = await api.get<GivingRecord[]>('/finance/me/giving', { params });
    return data;
  },

  async getTransaction(reference: string): Promise<GivingRecord> {
    const { data } = await api.get<GivingRecord>(`/finance/transactions/${reference}`);
    return data;
  },
};

export function formatMoney(minor: number, currency = 'GHS'): string {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency }).format(minor / 100);
}

export default givingService;
