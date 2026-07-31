import type { Request, Response } from "express";
import { z } from "zod";
import { MongoAuthRepository } from "../../../domain/auth/adapters/auth.mongo.adapter.js";
import { MongoChurchRepository } from "../../../domain/church/adapters/church.mongo.adapter.js";
import { AuthService } from "../../../domain/auth/application/auth.service.js";
import type { ApiResponse } from "@altar-os/shared-types";

const authRepo = new MongoAuthRepository();
const churchRepo = new MongoChurchRepository();
const authService = new AuthService(authRepo, churchRepo);

export const registerSchema = z
  .object({
    email: z.string().email(),
    phone: z.string().min(1),
    name: z.string().min(1),
    password: z.string().min(8),
    churchId: z.string().min(1).optional(),
    churchName: z.string().min(2).optional(),
  })
  .refine((data) => Boolean(data.churchId || data.churchName), {
    message: "Provide either churchId (join a church) or churchName (create one)",
    path: ["churchId"],
  });

export const loginSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().optional(),
  password: z.string().optional(),
  method: z.enum(["PHONE", "EMAIL", "SOCIAL"]),
});

export const otpSchema = z.object({
  phone: z.string().optional(),
  email: z.string().email().optional(),
  otp: z.string().min(4),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export async function register(req: Request, res: Response): Promise<void> {
  const result = await authService.register(req.body);
  const response: ApiResponse = {
    success: true,
    data: result,
    message: "Registration successful",
  };
  res.status(201).json(response);
}

export async function login(req: Request, res: Response): Promise<void> {
  const result = await authService.login(req.body);
  const response: ApiResponse = {
    success: true,
    data: result,
    message: "Login successful",
  };
  res.json(response);
}

export async function verifyOtp(req: Request, res: Response): Promise<void> {
  const result = await authService.verifyOtp(req.body);
  const response: ApiResponse = {
    success: true,
    data: result,
  };
  res.json(response);
}

export async function refreshToken(
  req: Request,
  res: Response,
): Promise<void> {
  const tokens = await authService.refreshToken(req.body.refreshToken);
  const response: ApiResponse = {
    success: true,
    data: tokens,
  };
  res.json(response);
}

export async function getMe(req: Request, res: Response): Promise<void> {
  const user = await authService.getCurrentUser(req.user!.id);
  const response: ApiResponse = {
    success: true,
    data: user,
  };
  res.json(response);
}
