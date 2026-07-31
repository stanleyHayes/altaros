import { Router } from "express";
import { validate } from "../../../infrastructure/middleware/validate.middleware.js";
import { authenticate } from "../../../infrastructure/middleware/auth.middleware.js";
import {
  sendMessage,
  getMessages,
  getMessage,
  createAnnouncement,
  getAnnouncements,
  updateAnnouncement,
  deleteAnnouncement,
  createMessageSchema,
  createAnnouncementSchema,
  updateAnnouncementSchema,
} from "../controllers/communication.controller.js";

const router = Router();

// Messages
router.post(
  "/messages",
  authenticate,
  validate({ body: createMessageSchema }),
  sendMessage,
);
router.get("/messages/church/:churchId", authenticate, getMessages);
router.get("/messages/:id", authenticate, getMessage);

// Announcements
router.post(
  "/announcements",
  authenticate,
  validate({ body: createAnnouncementSchema }),
  createAnnouncement,
);
router.get(
  "/announcements/church/:churchId",
  authenticate,
  getAnnouncements,
);
router.put(
  "/announcements/:id",
  authenticate,
  validate({ body: updateAnnouncementSchema }),
  updateAnnouncement,
);
router.delete("/announcements/:id", authenticate, deleteAnnouncement);

export default router;
