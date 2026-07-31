import type { Transaction, Campaign } from "@altar-os/shared-types";
import type {
  IFinanceRepository,
  CreateTransactionData,
  TransactionFilterQuery,
  TransactionSummary,
  CreateCampaignData,
  UpdateCampaignData,
} from "../ports/finance.repository.port.js";
import type { PaginatedResult } from "../../church/ports/church.repository.port.js";
import { AppError } from "../../../infrastructure/middleware/error.middleware.js";

export class FinanceService {
  constructor(private readonly financeRepo: IFinanceRepository) {}

  async recordTransaction(data: CreateTransactionData): Promise<Transaction> {
    return this.financeRepo.createTransaction(data);
  }

  async getTransactions(
    churchId: string,
    query: TransactionFilterQuery,
  ): Promise<PaginatedResult<Transaction>> {
    return this.financeRepo.findTransactionsByChurchId(churchId, query);
  }

  async getSummary(
    churchId: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<TransactionSummary> {
    return this.financeRepo.getTransactionSummary(churchId, startDate, endDate);
  }

  async createCampaign(data: CreateCampaignData): Promise<Campaign> {
    return this.financeRepo.createCampaign(data);
  }

  async getCampaigns(churchId: string): Promise<Campaign[]> {
    return this.financeRepo.findCampaigns(churchId);
  }

  async updateCampaign(
    id: string,
    data: UpdateCampaignData,
  ): Promise<Campaign> {
    const campaign = await this.financeRepo.updateCampaign(id, data);
    if (!campaign) {
      throw new AppError(404, "Campaign not found");
    }
    return campaign;
  }
}
