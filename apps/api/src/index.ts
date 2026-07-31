import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./infrastructure/config/env.js";
import { connectDatabase } from "./infrastructure/database/connection.js";
import { errorHandler } from "./infrastructure/middleware/error.middleware.js";
import apiRoutes from "./interfaces/http/routes/index.js";

const app = express();

// Security & parsing middleware
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// API routes
app.use("/api/v1", apiRoutes);

// Global error handler (must be registered after routes)
app.use(errorHandler);

// Start server
async function main(): Promise<void> {
  await connectDatabase();

  app.listen(env.PORT, () => {
    console.log(`[Server] ALTAR OS API running on port ${env.PORT}`);
  });
}

main().catch((err) => {
  console.error("[Server] Failed to start:", err);
  process.exit(1);
});
