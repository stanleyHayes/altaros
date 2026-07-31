import mongoose, { Schema, type Document } from "mongoose";
import type {
  Transaction,
  Campaign,
  TransactionType,
  PaymentMethod,
  PaymentStatus,
} from "@altar-os/shared-types";
import type {
  IFinanceRepository,
  CreateTransactionData,
  TransactionFilterQuery,
  TransactionSummary,
  CreateCampaignData,
  UpdateCampaignData,
} from "../ports/finance.repository.port.js";
import type { PaginatedResult } from "../../church/ports/church.repository.port.js";

// --- Transaction Schema ---

interface TransactionDocument extends Document {
  churchId: mongoose.Types.ObjectId;
  memberId?: mongoose.Types.ObjectId;
  type: TransactionType;
  amount: number;
  currency: string;
  paymentMethod: PaymentMethod;
  status: PaymentStatus;
  reference: string;
  description?: string;
  campaignId?: mongoose.Types.ObjectId;
  createdAt: Date;
}

const transactionSchema = new Schema<TransactionDocument>(
  {
    churchId: { type: Schema.Types.ObjectId, ref: "Church", required: true },
    memberId: { type: Schema.Types.ObjectId, ref: "Member" },
    type: {
      type: String,
      enum: ["TITHE", "OFFERING", "DONATION", "EXPENSE"],
      required: true,
    },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    paymentMethod: {
      type: String,
      enum: ["MOBILE_MONEY", "CARD", "CRYPTO", "BANK_TRANSFER", "CASH"],
      required: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "COMPLETED", "FAILED", "REFUNDED"],
      default: "COMPLETED",
    } as unknown as typeof Schema.Types.String,
    reference: { type: String, required: true, unique: true },
    description: { type: String },
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

transactionSchema.index({ churchId: 1, createdAt: -1 });
transactionSchema.index({ churchId: 1, type: 1 });

const TransactionModel =
  mongoose.models.Transaction ||
  mongoose.model<TransactionDocument>("Transaction", transactionSchema);

function toTransaction(doc: TransactionDocument): Transaction {
  return {
    id: doc._id.toString(),
    churchId: doc.churchId.toString(),
    memberId: doc.memberId?.toString(),
    type: doc.type,
    amount: doc.amount,
    currency: doc.currency,
    paymentMethod: doc.paymentMethod,
    status: doc.status,
    reference: doc.reference,
    description: doc.description,
    campaignId: doc.campaignId?.toString(),
    createdAt: doc.createdAt,
  };
}

// --- Campaign Schema ---

interface CampaignDocument extends Document {
  churchId: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  targetAmount: number;
  currentAmount: number;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
}

const campaignSchema = new Schema<CampaignDocument>(
  {
    churchId: { type: Schema.Types.ObjectId, ref: "Church", required: true },
    title: { type: String, required: true },
    description: { type: String },
    targetAmount: { type: Number, required: true },
    currentAmount: { type: Number, default: 0 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: false },
);

campaignSchema.index({ churchId: 1 });

const CampaignModel =
  mongoose.models.Campaign ||
  mongoose.model<CampaignDocument>("Campaign", campaignSchema);

function toCampaign(doc: CampaignDocument): Campaign {
  return {
    id: doc._id.toString(),
    churchId: doc.churchId.toString(),
    title: doc.title,
    description: doc.description,
    targetAmount: doc.targetAmount,
    currentAmount: doc.currentAmount,
    startDate: doc.startDate,
    endDate: doc.endDate,
    isActive: doc.isActive,
  };
}

// --- Repository ---

export class MongoFinanceRepository implements IFinanceRepository {
  async createTransaction(data: CreateTransactionData): Promise<Transaction> {
    const doc = await TransactionModel.create(data);
    return toTransaction(doc as TransactionDocument);
  }

  async findTransactionsByChurchId(
    churchId: string,
    query: TransactionFilterQuery,
  ): Promise<PaginatedResult<Transaction>> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;
    const sortOrder = query.sortOrder === "asc" ? 1 : -1;

    const filter: Record<string, unknown> = { churchId };

    if (query.type) {
      filter.type = query.type;
    }

    if (query.startDate || query.endDate) {
      filter.createdAt = {} as Record<string, Date>;
      if (query.startDate) {
        (filter.createdAt as Record<string, Date>).$gte = query.startDate;
      }
      if (query.endDate) {
        (filter.createdAt as Record<string, Date>).$lte = query.endDate;
      }
    }

    const [docs, total] = await Promise.all([
      TransactionModel.find(filter)
        .sort({ createdAt: sortOrder })
        .skip(skip)
        .limit(limit),
      TransactionModel.countDocuments(filter),
    ]);

    return {
      data: docs.map((d) => toTransaction(d as TransactionDocument)),
      total,
    };
  }

  async getTransactionSummary(
    churchId: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<TransactionSummary> {
    const match: Record<string, unknown> = {
      churchId: new mongoose.Types.ObjectId(churchId),
    };

    if (startDate || endDate) {
      match.createdAt = {} as Record<string, Date>;
      if (startDate)
        (match.createdAt as Record<string, Date>).$gte = startDate;
      if (endDate) (match.createdAt as Record<string, Date>).$lte = endDate;
    }

    const result = await TransactionModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$type",
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    const byType: Record<string, { amount: number; count: number }> = {};
    let totalAmount = 0;
    let count = 0;

    for (const row of result) {
      byType[row._id] = { amount: row.totalAmount, count: row.count };
      totalAmount += row.totalAmount;
      count += row.count;
    }

    return { totalAmount, count, byType };
  }

  async createCampaign(data: CreateCampaignData): Promise<Campaign> {
    const doc = await CampaignModel.create(data);
    return toCampaign(doc as CampaignDocument);
  }

  async findCampaigns(churchId: string): Promise<Campaign[]> {
    const docs = await CampaignModel.find({ churchId }).sort({
      startDate: -1,
    });
    return docs.map((d) => toCampaign(d as CampaignDocument));
  }

  async updateCampaign(
    id: string,
    data: UpdateCampaignData,
  ): Promise<Campaign | null> {
    const doc = await CampaignModel.findByIdAndUpdate(id, data, { new: true });
    return doc ? toCampaign(doc as CampaignDocument) : null;
  }
}
