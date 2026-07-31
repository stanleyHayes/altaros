import type { Request, Response } from "express";
import { z } from "zod";
import { MongoFinanceRepository } from "../../../domain/finance/adapters/finance.mongo.adapter.js";
import { FinanceService } from "../../../domain/finance/application/finance.service.js";
import type { ApiResponse, PaginatedResponse } from "@altar-os/shared-types";

const financeRepo = new MongoFinanceRepository();
const financeService = new FinanceService(financeRepo);

export const createTransactionSchema = z.object({
  churchId: z.string().min(1),
  memberId: z.string().optional(),
  type: z.enum(["TITHE", "OFFERING", "DONATION", "EXPENSE"]),
  amount: z.number().positive(),
  currency: z.string().min(1),
  paymentMethod: z.enum([
    "MOBILE_MONEY",
    "CARD",
    "CRYPTO",
    "BANK_TRANSFER",
    "CASH",
  ]),
  reference: z.string().min(1),
  description: z.string().optional(),
  campaignId: z.string().optional(),
});

export const transactionQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  type: z.enum(["TITHE", "OFFERING", "DONATION", "EXPENSE"]).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

export const createCampaignSchema = z.object({
  churchId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  targetAmount: z.number().positive(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
});

export const updateCampaignSchema = createCampaignSchema
  .partial()
  .extend({
    isActive: z.boolean().optional(),
    currentAmount: z.number().optional(),
  });

export async function createTransaction(
  req: Request,
  res: Response,
): Promise<void> {
  const transaction = await financeService.recordTransaction(req.body);
  const response: ApiResponse = {
    success: true,
    data: transaction,
    message: "Transaction recorded",
  };
  res.status(201).json(response);
}

export async function getTransactions(
  req: Request,
  res: Response,
): Promise<void> {
  const churchId = req.params.churchId as string;
  const { data, total } = await financeService.getTransactions(
    churchId,
    req.query as never,
  );
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const response: PaginatedResponse = {
    success: true,
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
  res.json(response);
}

export async function getTransactionSummary(
  req: Request,
  res: Response,
): Promise<void> {
  const churchId = req.params.churchId as string;
  const startDate = req.query.startDate
    ? new Date(req.query.startDate as string)
    : undefined;
  const endDate = req.query.endDate
    ? new Date(req.query.endDate as string)
    : undefined;
  const summary = await financeService.getSummary(
    churchId,
    startDate,
    endDate,
  );
  const response: ApiResponse = { success: true, data: summary };
  res.json(response);
}

export async function createCampaign(
  req: Request,
  res: Response,
): Promise<void> {
  const campaign = await financeService.createCampaign(req.body);
  const response: ApiResponse = {
    success: true,
    data: campaign,
    message: "Campaign created",
  };
  res.status(201).json(response);
}

export async function getCampaigns(
  req: Request,
  res: Response,
): Promise<void> {
  const churchId = req.params.churchId as string;
  const campaigns = await financeService.getCampaigns(churchId);
  const response: ApiResponse = { success: true, data: campaigns };
  res.json(response);
}

export async function updateCampaign(
  req: Request,
  res: Response,
): Promise<void> {
  const id = req.params.id as string;
  const campaign = await financeService.updateCampaign(
    id,
    req.body,
  );
  const response: ApiResponse = {
    success: true,
    data: campaign,
    message: "Campaign updated",
  };
  res.json(response);
}
