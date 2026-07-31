import { Router } from "express";
import { validate } from "../../../infrastructure/middleware/validate.middleware.js";
import { authenticate } from "../../../infrastructure/middleware/auth.middleware.js";
import {
  createTransaction,
  getTransactions,
  getTransactionSummary,
  createCampaign,
  getCampaigns,
  updateCampaign,
  createTransactionSchema,
  transactionQuerySchema,
  createCampaignSchema,
  updateCampaignSchema,
} from "../controllers/finance.controller.js";

const router = Router();

// Transactions
router.post(
  "/transactions",
  authenticate,
  validate({ body: createTransactionSchema }),
  createTransaction,
);
router.get(
  "/transactions/church/:churchId",
  authenticate,
  validate({ query: transactionQuerySchema }),
  getTransactions,
);
router.get(
  "/transactions/church/:churchId/summary",
  authenticate,
  getTransactionSummary,
);

// Campaigns
router.post(
  "/campaigns",
  authenticate,
  validate({ body: createCampaignSchema }),
  createCampaign,
);
router.get("/campaigns/church/:churchId", authenticate, getCampaigns);
router.put(
  "/campaigns/:id",
  authenticate,
  validate({ body: updateCampaignSchema }),
  updateCampaign,
);

export default router;
