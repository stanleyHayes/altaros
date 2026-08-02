import { Router } from "express";
import { validate } from "../../../infrastructure/middleware/validate.middleware.js";
import { authenticate } from "../../../infrastructure/middleware/auth.middleware.js";
import {
  createEvent,
  getEvent,
  getEventsByChurch,
  updateEvent,
  deleteEvent,
  rsvp,
  getMyRsvps,
  checkIn,
  getAttendance,
  createEventSchema,
  updateEventSchema,
  rsvpSchema,
  attendanceSchema,
  eventQuerySchema,
} from "../controllers/event.controller.js";

const router = Router();

router.post(
  "/",
  authenticate,
  validate({ body: createEventSchema }),
  createEvent,
);
router.get(
  "/church/:churchId",
  authenticate,
  validate({ query: eventQuerySchema }),
  getEventsByChurch,
);
// Register the fixed two-segment member route before `/:id`. Express matches
// in declaration order; placing this below `/:id` turns `rsvps` into an event
// identifier and silently prevents mobile from restoring RSVP state.
router.get("/rsvps/me", authenticate, getMyRsvps);
router.get("/:id", authenticate, getEvent);
router.put(
  "/:id",
  authenticate,
  validate({ body: updateEventSchema }),
  updateEvent,
);
router.delete("/:id", authenticate, deleteEvent);

// RSVP & Attendance
router.post("/rsvp", authenticate, validate({ body: rsvpSchema }), rsvp);
router.post(
  "/attendance",
  authenticate,
  validate({ body: attendanceSchema }),
  checkIn,
);
router.get("/attendance/:eventId", authenticate, getAttendance);

export default router;
