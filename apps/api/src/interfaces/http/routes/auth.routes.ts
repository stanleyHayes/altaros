import { Router } from "express";
import { validate } from "../../../infrastructure/middleware/validate.middleware.js";
import { authenticate } from "../../../infrastructure/middleware/auth.middleware.js";
import {
  register,
  login,
  verifyOtp,
  refreshToken,
  getMe,
  registerSchema,
  loginSchema,
  otpSchema,
  refreshTokenSchema,
} from "../controllers/auth.controller.js";

const router = Router();

router.post("/register", validate({ body: registerSchema }), register);
router.post("/login", validate({ body: loginSchema }), login);
router.post("/verify-otp", validate({ body: otpSchema }), verifyOtp);
router.post(
  "/refresh-token",
  validate({ body: refreshTokenSchema }),
  refreshToken,
);
router.get("/me", authenticate, getMe);

export default router;
