import { Router } from "express";
import authRoutes from "./auth.routes.js";
import churchRoutes from "./church.routes.js";
import memberRoutes from "./member.routes.js";
import financeRoutes from "./finance.routes.js";
import eventRoutes from "./event.routes.js";
import communicationRoutes from "./communication.routes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/churches", churchRoutes);
router.use("/members", memberRoutes);
router.use("/finance", financeRoutes);
router.use("/events", eventRoutes);
router.use("/communication", communicationRoutes);

export default router;
