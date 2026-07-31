import { Router } from "express";
import { validate } from "../../../infrastructure/middleware/validate.middleware.js";
import { authenticate } from "../../../infrastructure/middleware/auth.middleware.js";
import {
  createChurch,
  getChurch,
  getChurchBySlug,
  getAllChurches,
  updateChurch,
  deleteChurch,
  createChurchSchema,
  updateChurchSchema,
  paginationSchema,
} from "../controllers/church.controller.js";

const router = Router();

router.post(
  "/",
  authenticate,
  validate({ body: createChurchSchema }),
  createChurch,
);
router.get("/", validate({ query: paginationSchema }), getAllChurches);
router.get("/slug/:slug", getChurchBySlug);
router.get("/:id", getChurch);
router.put(
  "/:id",
  authenticate,
  validate({ body: updateChurchSchema }),
  updateChurch,
);
router.delete("/:id", authenticate, deleteChurch);

export default router;
