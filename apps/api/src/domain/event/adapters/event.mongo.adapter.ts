import mongoose, { Schema, type Document } from "mongoose";
import type {
  Event,
  RSVP,
  Attendance,
  RsvpStatus,
  CheckInMethod,
} from "@altar-os/shared-types";
import type {
  IEventRepository,
  CreateEventData,
  UpdateEventData,
  CreateRsvpData,
  CreateAttendanceData,
  EventQuery,
} from "../ports/event.repository.port.js";
import type { PaginatedResult } from "../../church/ports/church.repository.port.js";

// --- Event Schema ---

interface EventDocument extends Document {
  churchId: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  location?: string;
  startDate: Date;
  endDate: Date;
  isRecurring: boolean;
  recurrenceRule?: string;
  capacity?: number;
  rsvpCount: number;
  createdAt: Date;
}

const eventSchema = new Schema<EventDocument>(
  {
    churchId: { type: Schema.Types.ObjectId, ref: "Church", required: true },
    title: { type: String, required: true },
    description: { type: String },
    location: { type: String },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    isRecurring: { type: Boolean, default: false },
    recurrenceRule: { type: String },
    capacity: { type: Number },
    rsvpCount: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

eventSchema.index({ churchId: 1, startDate: -1 });
eventSchema.index({ churchId: 1, endDate: 1, startDate: 1 });

const EventModel =
  mongoose.models.Event ||
  mongoose.model<EventDocument>("Event", eventSchema);

function toEvent(doc: EventDocument): Event {
  return {
    id: doc._id.toString(),
    churchId: doc.churchId.toString(),
    title: doc.title,
    description: doc.description,
    location: doc.location,
    startDate: doc.startDate,
    endDate: doc.endDate,
    isRecurring: doc.isRecurring,
    recurrenceRule: doc.recurrenceRule,
    capacity: doc.capacity,
    rsvpCount: doc.rsvpCount,
    createdAt: doc.createdAt,
  };
}

// --- RSVP Schema ---

interface RsvpDocument extends Document {
  eventId: mongoose.Types.ObjectId;
  memberId: mongoose.Types.ObjectId;
  status: RsvpStatus;
}

const rsvpSchema = new Schema<RsvpDocument>({
  eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true },
  memberId: { type: Schema.Types.ObjectId, ref: "Member", required: true },
  status: {
    type: String,
    enum: ["GOING", "MAYBE", "NOT_GOING"],
    required: true,
  },
});

rsvpSchema.index({ eventId: 1, memberId: 1 }, { unique: true });

const RsvpModel =
  mongoose.models.RSVP || mongoose.model<RsvpDocument>("RSVP", rsvpSchema);

function toRsvp(doc: RsvpDocument): RSVP {
  return {
    id: doc._id.toString(),
    eventId: doc.eventId.toString(),
    memberId: doc.memberId.toString(),
    status: doc.status,
  };
}

// --- Attendance Schema ---

interface AttendanceDocument extends Document {
  eventId: mongoose.Types.ObjectId;
  memberId: mongoose.Types.ObjectId;
  churchId: mongoose.Types.ObjectId;
  checkedInAt: Date;
  method: CheckInMethod;
}

const attendanceSchema = new Schema<AttendanceDocument>({
  eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true },
  memberId: { type: Schema.Types.ObjectId, ref: "Member", required: true },
  churchId: { type: Schema.Types.ObjectId, ref: "Church", required: true },
  checkedInAt: { type: Date, default: Date.now },
  method: { type: String, enum: ["QR", "MANUAL"], required: true },
});

attendanceSchema.index({ eventId: 1 });

const AttendanceModel =
  mongoose.models.Attendance ||
  mongoose.model<AttendanceDocument>("Attendance", attendanceSchema);

function toAttendance(doc: AttendanceDocument): Attendance {
  return {
    id: doc._id.toString(),
    eventId: doc.eventId.toString(),
    memberId: doc.memberId.toString(),
    churchId: doc.churchId.toString(),
    checkedInAt: doc.checkedInAt,
    method: doc.method,
  };
}

export function eventListFilter(churchId: string, query: EventQuery, now = new Date()) {
  return {
    churchId,
    ...(query.upcoming ? { endDate: { $gte: now } } : {}),
  };
}

// --- Repository ---

export class MongoEventRepository implements IEventRepository {
  async create(data: CreateEventData): Promise<Event> {
    const doc = await EventModel.create(data);
    return toEvent(doc as EventDocument);
  }

  async findById(id: string): Promise<Event | null> {
    const doc = await EventModel.findById(id);
    return doc ? toEvent(doc as EventDocument) : null;
  }

  async findByChurchId(
    churchId: string,
    query: EventQuery,
  ): Promise<PaginatedResult<Event>> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;
    const sortOrder = query.sortOrder === "asc" ? 1 : -1;

    const filter = eventListFilter(churchId, query);
    const [docs, total] = await Promise.all([
      EventModel.find(filter)
        .sort({ startDate: sortOrder })
        .skip(skip)
        .limit(limit),
      EventModel.countDocuments(filter),
    ]);

    return {
      data: docs.map((d) => toEvent(d as EventDocument)),
      total,
    };
  }

  async update(id: string, data: UpdateEventData): Promise<Event | null> {
    const doc = await EventModel.findByIdAndUpdate(id, data, { new: true });
    return doc ? toEvent(doc as EventDocument) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await EventModel.findByIdAndDelete(id);
    return result !== null;
  }

  async createRsvp(data: CreateRsvpData): Promise<RSVP> {
    const doc = await RsvpModel.findOneAndUpdate(
      { eventId: data.eventId, memberId: data.memberId },
      { status: data.status },
      { upsert: true, new: true },
    );

    // Update RSVP count on the event
    const count = await RsvpModel.countDocuments({
      eventId: data.eventId,
      status: "GOING",
    });
    await EventModel.findByIdAndUpdate(data.eventId, { rsvpCount: count });

    return toRsvp(doc as RsvpDocument);
  }

  async findRsvpsByMember(memberId: string, eventIds?: string[]): Promise<RSVP[]> {
    const filter: Record<string, unknown> = { memberId };
    if (eventIds?.length) filter.eventId = { $in: eventIds };
    const docs = await RsvpModel.find(filter);
    return docs.map((doc) => toRsvp(doc as RsvpDocument));
  }

  async createAttendance(data: CreateAttendanceData): Promise<Attendance> {
    const doc = await AttendanceModel.create(data);
    return toAttendance(doc as AttendanceDocument);
  }

  async getAttendanceByEvent(eventId: string): Promise<Attendance[]> {
    const docs = await AttendanceModel.find({ eventId });
    return docs.map((d) => toAttendance(d as AttendanceDocument));
  }
}
