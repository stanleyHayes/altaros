import type { Request, Response } from "express";
import { z } from "zod";
import { MongoChurchRepository } from "../../../domain/church/adapters/church.mongo.adapter.js";
import { ChurchService } from "../../../domain/church/application/church.service.js";
import type { ApiResponse, PaginatedResponse } from "@altar-os/shared-types";

const churchRepo = new MongoChurchRepository();
const churchService = new ChurchService(churchRepo);

export const createChurchSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  city: z.string().min(1),
  country: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email(),
  website: z.string().url().optional(),
  logoUrl: z.string().url().optional(),
  bannerUrl: z.string().url().optional(),
  timezone: z.string().min(1),
  currency: z.string().min(1),
});

export const updateChurchSchema = createChurchSchema.partial();

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

export async function createChurch(
  req: Request,
  res: Response,
): Promise<void> {
  const church = await churchService.create(req.body);
  const response: ApiResponse = {
    success: true,
    data: church,
    message: "Church created",
  };
  res.status(201).json(response);
}

export async function getChurch(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const church = await churchService.getById(id);
  const response: ApiResponse = { success: true, data: church };
  res.json(response);
}

export async function getChurchBySlug(
  req: Request,
  res: Response,
): Promise<void> {
  const slug = req.params.slug as string;
  const church = await churchService.getBySlug(slug);
  const response: ApiResponse = { success: true, data: church };
  res.json(response);
}

export async function getAllChurches(
  req: Request,
  res: Response,
): Promise<void> {
  const { data, total } = await churchService.getAll(req.query as never);
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

export async function updateChurch(
  req: Request,
  res: Response,
): Promise<void> {
  const id = req.params.id as string;
  const church = await churchService.update(id, req.body);
  const response: ApiResponse = {
    success: true,
    data: church,
    message: "Church updated",
  };
  res.json(response);
}

export async function deleteChurch(
  req: Request,
  res: Response,
): Promise<void> {
  const id = req.params.id as string;
  await churchService.delete(id);
  const response: ApiResponse = {
    success: true,
    message: "Church deleted",
  };
  res.json(response);
}
