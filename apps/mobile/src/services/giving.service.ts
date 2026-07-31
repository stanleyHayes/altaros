import api from './api';

export interface GivingRecord {
  id: string;
  amount: number;
  currency: string;
  type: 'tithe' | 'offering' | 'donation' | 'pledge' | 'building_fund';
  paymentMethod: 'card' | 'bank' | 'mobile_money' | 'cash' | 'ussd' | 'crypto';
  status: 'completed' | 'pending' | 'failed';
  reference: string;
  note?: string;
  createdAt: string;
}

export interface GiveRequest {
  amount: number;
  currency?: string;
  type: GivingRecord['type'];
  paymentMethod: GivingRecord['paymentMethod'];
  note?: string;
}

export interface GivingSummary {
  totalGiven: number;
  thisMonth: number;
  thisYear: number;
  lastGift: GivingRecord | null;
}

const givingService = {
  async give(payload: GiveRequest): Promise<GivingRecord> {
    const { data } = await api.post<GivingRecord>('/giving', payload);
    return data;
  },

  async getHistory(params?: {
    page?: number;
    limit?: number;
    type?: string;
  }): Promise<{ records: GivingRecord[]; total: number }> {
    const { data } = await api.get('/giving/history', { params });
    return data;
  },

  async getSummary(): Promise<GivingSummary> {
    const { data } = await api.get<GivingSummary>('/giving/summary');
    return data;
  },

  async getReceipt(recordId: string): Promise<{ url: string }> {
    const { data } = await api.get(`/giving/${recordId}/receipt`);
    return data;
  },
};

export default givingService;
