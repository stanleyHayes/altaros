import { Router } from "express";
import { validate } from "../../../infrastructure/middleware/validate.middleware.js";
import { authenticate } from "../../../infrastructure/middleware/auth.middleware.js";
import {
  createMember,
  getMember,
  getMembersByChurch,
  getMembersByFamily,
  updateMember,
  deleteMember,
  countMembers,
  createMemberSchema,
  updateMemberSchema,
  memberQuerySchema,
} from "../controllers/member.controller.js";

const router = Router();

router.post(
  "/",
  authenticate,
  validate({ body: createMemberSchema }),
  createMember,
);
router.get(
  "/church/:churchId",
  authenticate,
  validate({ query: memberQuerySchema }),
  getMembersByChurch,
);
router.get("/church/:churchId/count", authenticate, countMembers);
router.get("/family/:familyId", authenticate, getMembersByFamily);
router.get("/:id", authenticate, getMember);
router.put(
  "/:id",
  authenticate,
  validate({ body: updateMemberSchema }),
  updateMember,
);
router.delete("/:id", authenticate, deleteMember);

export default router;
