import api from './api';

export type WelfareCategory = 'medical' | 'financial' | 'bereavement' | 'food' | 'other';
export type WelfareStatus = 'submitted' | 'in_review' | 'approved' | 'closed';

export interface WelfareRequest {
  id: string;
  category: WelfareCategory;
  summary: string;
  details?: string;
  status: WelfareStatus;
  submittedAt: string;
}

const welfareService = {
  async listMine(): Promise<WelfareRequest[]> {
    const { data } = await api.get<WelfareRequest[]>('/welfare/requests/me');
    return data;
  },
  async create(payload: { category: WelfareCategory; summary: string; details?: string }): Promise<WelfareRequest> {
    const { data } = await api.post<WelfareRequest>('/welfare/requests', payload);
    return data;
  },
  async emergency(details?: string): Promise<void> {
    await api.post('/welfare/emergency', { details });
  },
};

export default welfareService;
