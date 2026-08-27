import { get, post, put } from "./api";

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

export interface Summary {
  currency: string;
  // All amounts are in minor units (pesewas for GHS)
  income: number;
  gross: number;
  expenses: number;
  balance: number;
  providerFees: number;
  platformFees: number;
  levy: number;
  count: number;
  byType: Record<string, number>;
}

export interface CreateCampaignPayload {
  name: string;
  description?: string;
  goalAmount: number;
  startDate: string;
  endDate?: string;
}

/**
 * What GET /finance/transactions actually reads.
 *
 * It previously advertised startDate, endDate, page, sortBy and sortOrder.
 * The endpoint reads none of those — the date range is `from`/`to`, and there
 * is no paging or sorting — so a caller passing startDate got the UNFILTERED
 * ledger back with no error to say the filter was dropped. On a giving screen
 * that is not a cosmetic bug: it silently shows more than was asked for.
 */
export interface TransactionSearchParams {
  memberId?: string;
  type?: string;
  status?: string;
  direction?: "in" | "out";
  from?: string;
  to?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const FinanceService = {
  /** Summary of income, expenses, and fees over an optional window. */
  async getSummary(params?: {
    from?: string;
    to?: string;
    currency?: string;
  }): Promise<Summary> {
    return get<Summary>("/finance/summary", { params });
  },

  /** Transactions. Returns a bare array — the endpoint is not paginated. */
  async getTransactions(
    params?: TransactionSearchParams,
  ): Promise<Transaction[]> {
    const txs = await get<Transaction[]>("/finance/transactions", { params });
    return Array.isArray(txs) ? txs : [];
  },

  /**
   * One member's giving.
   *
   * Requires finance:read — ?memberId= makes the underlying endpoint a
   * congregation-wide giving reader, so it is guarded as one. A caller
   * without that permission gets a 403, which the drawer shows as "not
   * available to you" rather than as an error.
   */
  async getMemberGiving(memberId: string): Promise<Transaction[]> {
    return FinanceService.getTransactions({ memberId, direction: "in" });
  },

  async getTransactionById(id: string): Promise<Transaction> {
    return get<Transaction>(`/finance/transactions/${id}`);
  },

  async createTransaction(
    payload: CreateTransactionPayload,
  ): Promise<Transaction> {
    // POST /finance/transactions does not exist. Money recorded by hand —
    // the notes and coins counted after a service — goes to /finance/cash,
    // which is the only write path that does not run a payment through
    // Paystack. amountMinor is sent explicitly so the server never has to
    // guess whether a decimal string meant cedis or pesewas.
    return post<Transaction>("/finance/cash", payload);
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

  /**
   * Close a campaign. There is no delete, and there should not be.
   *
   * DELETE /finance/campaigns/{id} does not exist: giving is recorded
   * against a campaign, so removing one would leave the church's ledger
   * showing income against a fund that no longer exists. Closing stops new
   * gifts and keeps the history answerable.
   */
  async closeCampaign(id: string): Promise<void> {
    await post<unknown>(`/finance/campaigns/${id}/close`, {});
  },
};

export default FinanceService;
