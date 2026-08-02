import type { Request, Response } from "express";
import { z } from "zod";
import { MongoEventRepository } from "../../../domain/event/adapters/event.mongo.adapter.js";
import { EventService } from "../../../domain/event/application/event.service.js";
import type { ApiResponse, PaginatedResponse } from "@altar-os/shared-types";

const eventRepo = new MongoEventRepository();
const eventService = new EventService(eventRepo);

export const createEventSchema = z.object({
  churchId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  isRecurring: z.boolean().optional(),
  recurrenceRule: z.string().optional(),
  capacity: z.number().int().positive().optional(),
});

export const updateEventSchema = createEventSchema.partial();

export const eventQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  upcoming: z.enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

export const rsvpSchema = z.object({
  eventId: z.string().min(1),
  // Accepted for rolling-client compatibility but never trusted; the
  // controller always takes identity from the authenticated token.
  memberId: z.string().min(1).optional(),
  status: z.enum(["GOING", "MAYBE", "NOT_GOING"]),
});

export const attendanceSchema = z.object({
  eventId: z.string().min(1),
  memberId: z.string().min(1),
  churchId: z.string().min(1),
  method: z.enum(["QR", "MANUAL"]),
});

export async function createEvent(
  req: Request,
  res: Response,
): Promise<void> {
  const event = await eventService.create(req.body);
  const response: ApiResponse = {
    success: true,
    data: event,
    message: "Event created",
  };
  res.status(201).json(response);
}

export async function getEvent(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const event = await eventService.getById(id);
  if (event.churchId !== req.user!.churchId) {
    res.status(404).json({ success: false, message: "Event not found" });
    return;
  }
  const response: ApiResponse = { success: true, data: event };
  res.json(response);
}

export async function getEventsByChurch(
  req: Request,
  res: Response,
): Promise<void> {
  const churchId = req.params.churchId as string;
  if (churchId !== req.user!.churchId) {
    res.status(403).json({ success: false, message: "You cannot view another church's events" });
    return;
  }
  const { data, total } = await eventService.getByChurchId(
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

export async function updateEvent(
  req: Request,
  res: Response,
): Promise<void> {
  const id = req.params.id as string;
  const event = await eventService.update(id, req.body);
  const response: ApiResponse = {
    success: true,
    data: event,
    message: "Event updated",
  };
  res.json(response);
}

export async function deleteEvent(
  req: Request,
  res: Response,
): Promise<void> {
  const id = req.params.id as string;
  await eventService.delete(id);
  const response: ApiResponse = { success: true, message: "Event deleted" };
  res.json(response);
}

export async function rsvp(req: Request, res: Response): Promise<void> {
  const event = await eventService.getById(req.body.eventId);
  if (event.churchId !== req.user!.churchId) {
    res.status(404).json({ success: false, message: "Event not found" });
    return;
  }
  const result = await eventService.rsvp({
    ...req.body,
    memberId: req.user!.id,
  });
  const response: ApiResponse = {
    success: true,
    data: result,
    message: "RSVP recorded",
  };
  res.status(201).json(response);
}

export async function getMyRsvps(req: Request, res: Response): Promise<void> {
  const eventIds = typeof req.query.eventIds === "string"
    ? req.query.eventIds.split(",").map((id) => id.trim()).filter(Boolean).slice(0, 100)
    : undefined;
  const result = await eventService.getRsvpsForMember(req.user!.id, eventIds);
  const response: ApiResponse = { success: true, data: result };
  res.json(response);
}

export async function checkIn(req: Request, res: Response): Promise<void> {
  const attendance = await eventService.checkIn(req.body);
  const response: ApiResponse = {
    success: true,
    data: attendance,
    message: "Check-in recorded",
  };
  res.status(201).json(response);
}

export async function getAttendance(
  req: Request,
  res: Response,
): Promise<void> {
  const eventId = req.params.eventId as string;
  const attendance = await eventService.getAttendance(eventId);
  const response: ApiResponse = { success: true, data: attendance };
  res.json(response);
}
