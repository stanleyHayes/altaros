import type { Request, Response } from "express";
import { z } from "zod";
import { MongoMemberRepository } from "../../../domain/member/adapters/member.mongo.adapter.js";
import { MemberService } from "../../../domain/member/application/member.service.js";
import type { ApiResponse, PaginatedResponse } from "@altar-os/shared-types";

const memberRepo = new MongoMemberRepository();
const memberService = new MemberService(memberRepo);

export const createMemberSchema = z.object({
  churchId: z.string().min(1),
  userId: z.string().optional(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  dateOfBirth: z.coerce.date().optional(),
  gender: z.string().optional(),
  address: z.string().optional(),
  familyId: z.string().optional(),
  departmentIds: z.array(z.string()).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "VISITOR", "TRANSFERRED"]).optional(),
  joinDate: z.coerce.date().optional(),
  notes: z.string().optional(),
});

export const updateMemberSchema = createMemberSchema.partial();

export const memberQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  search: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "VISITOR", "TRANSFERRED"]).optional(),
});

export async function createMember(
  req: Request,
  res: Response,
): Promise<void> {
  const member = await memberService.create(req.body);
  const response: ApiResponse = {
    success: true,
    data: member,
    message: "Member created",
  };
  res.status(201).json(response);
}

export async function getMember(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const member = await memberService.getById(id);
  const response: ApiResponse = { success: true, data: member };
  res.json(response);
}

export async function getMembersByChurch(
  req: Request,
  res: Response,
): Promise<void> {
  const churchId = req.params.churchId as string;
  const { data, total } = await memberService.getByChurchId(
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

export async function getMembersByFamily(
  req: Request,
  res: Response,
): Promise<void> {
  const familyId = req.params.familyId as string;
  const members = await memberService.getByFamilyId(familyId);
  const response: ApiResponse = { success: true, data: members };
  res.json(response);
}

export async function updateMember(
  req: Request,
  res: Response,
): Promise<void> {
  const id = req.params.id as string;
  const member = await memberService.update(id, req.body);
  const response: ApiResponse = {
    success: true,
    data: member,
    message: "Member updated",
  };
  res.json(response);
}

export async function deleteMember(
  req: Request,
  res: Response,
): Promise<void> {
  const id = req.params.id as string;
  await memberService.delete(id);
  const response: ApiResponse = { success: true, message: "Member deleted" };
  res.json(response);
}

export async function countMembers(
  req: Request,
  res: Response,
): Promise<void> {
  const churchId = req.params.churchId as string;
  const count = await memberService.countByChurchId(churchId);
  const response: ApiResponse = { success: true, data: { count } };
  res.json(response);
}
