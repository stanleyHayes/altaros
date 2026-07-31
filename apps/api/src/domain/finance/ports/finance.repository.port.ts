import type {
  Transaction,
  Campaign,
  TransactionType,
  PaginationQuery,
} from "@altar-os/shared-types";
import type { PaginatedResult } from "../../church/ports/church.repository.port.js";

export interface CreateTransactionData {
  churchId: string;
  memberId?: string;
  type: TransactionType;
  amount: number;
  currency: string;
  paymentMethod: string;
  reference: string;
  description?: string;
  campaignId?: string;
}

export interface TransactionFilterQuery extends PaginationQuery {
  type?: TransactionType;
  startDate?: Date;
  endDate?: Date;
}

export interface TransactionSummary {
  totalAmount: number;
  count: number;
  byType: Record<string, { amount: number; count: number }>;
}

export interface CreateCampaignData {
  churchId: string;
  title: string;
  description?: string;
  targetAmount: number;
  startDate: Date;
  endDate: Date;
}

export interface UpdateCampaignData extends Partial<CreateCampaignData> {
  isActive?: boolean;
  currentAmount?: number;
}

export interface IFinanceRepository {
  createTransaction(data: CreateTransactionData): Promise<Transaction>;
  findTransactionsByChurchId(
    churchId: string,
    query: TransactionFilterQuery,
  ): Promise<PaginatedResult<Transaction>>;
  getTransactionSummary(
    churchId: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<TransactionSummary>;
  createCampaign(data: CreateCampaignData): Promise<Campaign>;
  findCampaigns(churchId: string): Promise<Campaign[]>;
  updateCampaign(
    id: string,
    data: UpdateCampaignData,
  ): Promise<Campaign | null>;
}
