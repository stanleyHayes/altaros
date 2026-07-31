import type { Request, Response, NextFunction } from "express";
import type { ApiResponse } from "@altar-os/shared-types";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public errors?: string[],
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error("[Error]", err);

  if (err instanceof AppError) {
    const body: ApiResponse = {
      success: false,
      message: err.message,
      errors: err.errors,
    };
    res.status(err.statusCode).json(body);
    return;
  }

  const body: ApiResponse = {
    success: false,
    message:
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
  };
  res.status(500).json(body);
}
