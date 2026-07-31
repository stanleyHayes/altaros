import type { Request, Response } from "express";
import { z } from "zod";
import { MongoCommunicationRepository } from "../../../domain/communication/adapters/communication.mongo.adapter.js";
import { CommunicationService } from "../../../domain/communication/application/communication.service.js";
import type { ApiResponse, PaginatedResponse } from "@altar-os/shared-types";

const commRepo = new MongoCommunicationRepository();
const commService = new CommunicationService(commRepo);

export const createMessageSchema = z.object({
  churchId: z.string().min(1),
  senderId: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  channel: z.enum(["PUSH", "SMS", "EMAIL"]),
  targetFilter: z
    .object({
      departmentIds: z.array(z.string()).optional(),
      locations: z.array(z.string()).optional(),
      memberStatuses: z.array(z.string()).optional(),
      activityLevel: z.string().optional(),
    })
    .optional(),
});

export const createAnnouncementSchema = z.object({
  churchId: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  imageUrl: z.string().url().optional(),
  isPinned: z.boolean().optional(),
  expiresAt: z.coerce.date().optional(),
});

export const updateAnnouncementSchema = createAnnouncementSchema.partial();

export async function sendMessage(
  req: Request,
  res: Response,
): Promise<void> {
  const message = await commService.sendMessage(req.body);
  const response: ApiResponse = {
    success: true,
    data: message,
    message: "Message sent",
  };
  res.status(201).json(response);
}

export async function getMessages(
  req: Request,
  res: Response,
): Promise<void> {
  const churchId = req.params.churchId as string;
  const { data, total } = await commService.getMessages(
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

export async function getMessage(
  req: Request,
  res: Response,
): Promise<void> {
  const id = req.params.id as string;
  const message = await commService.getMessageById(id);
  const response: ApiResponse = { success: true, data: message };
  res.json(response);
}

export async function createAnnouncement(
  req: Request,
  res: Response,
): Promise<void> {
  const announcement = await commService.createAnnouncement(req.body);
  const response: ApiResponse = {
    success: true,
    data: announcement,
    message: "Announcement created",
  };
  res.status(201).json(response);
}

export async function getAnnouncements(
  req: Request,
  res: Response,
): Promise<void> {
  const churchId = req.params.churchId as string;
  const { data, total } = await commService.getAnnouncements(
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

export async function updateAnnouncement(
  req: Request,
  res: Response,
): Promise<void> {
  const id = req.params.id as string;
  const announcement = await commService.updateAnnouncement(
    id,
    req.body,
  );
  const response: ApiResponse = {
    success: true,
    data: announcement,
    message: "Announcement updated",
  };
  res.json(response);
}

export async function deleteAnnouncement(
  req: Request,
  res: Response,
): Promise<void> {
  const id = req.params.id as string;
  await commService.deleteAnnouncement(id);
  const response: ApiResponse = {
    success: true,
    message: "Announcement deleted",
  };
  res.json(response);
}
