import mongoose from "mongoose";
import { env } from "../config/env.js";

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

export async function connectDatabase(): Promise<void> {
  let retries = 0;

  while (retries < MAX_RETRIES) {
    try {
      await mongoose.connect(env.MONGODB_URI);
      console.log("[DB] Connected to MongoDB");
      return;
    } catch (error) {
      retries++;
      console.error(
        `[DB] Connection attempt ${retries}/${MAX_RETRIES} failed:`,
        error instanceof Error ? error.message : error,
      );

      if (retries >= MAX_RETRIES) {
        throw new Error(
          `[DB] Failed to connect after ${MAX_RETRIES} attempts`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}

mongoose.connection.on("disconnected", () => {
  console.warn("[DB] MongoDB disconnected");
});

mongoose.connection.on("error", (err) => {
  console.error("[DB] MongoDB error:", err);
});
