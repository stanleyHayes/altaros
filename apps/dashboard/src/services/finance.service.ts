import { get, post, put, del } from "./api";

export interface Transaction {
  id: string;
  type: "tithe" | "offering" | "donation" | "expense" | "other";
  amount: number;
  currency: string;
  description?: string;
  category?: string;
  memberId?: string;
  memberName?: string;
  date: string;
  method: "cash" | "card" | "bank_transfer" | "online" | "check";
  status: "completed" | "pending" | "failed" | "refunded";
  churchId: string;
  createdAt: string;
}

export interface CreateTransactionPayload {
  type: Transaction["type"];
  amount: number;
  currency?: string;
  description?: string;
  category?: string;
  memberId?: string;
  date?: string;
  method: Transaction["method"];
}

export interface Campaign {
  id: string;
  name: string;
  description?: string;
  goalAmount: number;
  currentAmount: number;
  startDate: string;
  endDate?: string;
  status: "active" | "completed" | "paused";
  churchId: string;
  createdAt: string;
}

export interface CreateCampaignPayload {
  name: string;
  description?: string;
  goalAmount: number;
  startDate: string;
  endDate?: string;
}

export interface TransactionSearchParams {
  type?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const FinanceService = {
  async getTransactions(
    params?: TransactionSearchParams,
  ): Promise<PaginatedResponse<Transaction>> {
    return get<PaginatedResponse<Transaction>>("/finance/transactions", {
      params,
    });
  },

  async getTransactionById(id: string): Promise<Transaction> {
    return get<Transaction>(`/finance/transactions/${id}`);
  },

  async createTransaction(
    payload: CreateTransactionPayload,
  ): Promise<Transaction> {
    return post<Transaction>("/finance/transactions", payload);
  },

  async getCampaigns(): Promise<Campaign[]> {
    return get<Campaign[]>("/finance/campaigns");
  },

  async getCampaignById(id: string): Promise<Campaign> {
    return get<Campaign>(`/finance/campaigns/${id}`);
  },

  async createCampaign(payload: CreateCampaignPayload): Promise<Campaign> {
    return post<Campaign>("/finance/campaigns", payload);
  },

  async updateCampaign(
    id: string,
    payload: Partial<CreateCampaignPayload>,
  ): Promise<Campaign> {
    return put<Campaign>(`/finance/campaigns/${id}`, payload);
  },

  async deleteCampaign(id: string): Promise<void> {
    return del<void>(`/finance/campaigns/${id}`);
  },
};

export default FinanceService;
