import type { Event, RSVP, Attendance } from "@altar-os/shared-types";
import type {
  IEventRepository,
  CreateEventData,
  UpdateEventData,
  CreateRsvpData,
  CreateAttendanceData,
  EventQuery,
} from "../ports/event.repository.port.js";
import type { PaginatedResult } from "../../church/ports/church.repository.port.js";
import { AppError } from "../../../infrastructure/middleware/error.middleware.js";

export class EventService {
  constructor(private readonly eventRepo: IEventRepository) {}

  async create(data: CreateEventData): Promise<Event> {
    return this.eventRepo.create(data);
  }

  async getById(id: string): Promise<Event> {
    const event = await this.eventRepo.findById(id);
    if (!event) {
      throw new AppError(404, "Event not found");
    }
    return event;
  }

  async getByChurchId(
    churchId: string,
    query: EventQuery,
  ): Promise<PaginatedResult<Event>> {
    return this.eventRepo.findByChurchId(churchId, query);
  }

  async update(id: string, data: UpdateEventData): Promise<Event> {
    const event = await this.eventRepo.update(id, data);
    if (!event) {
      throw new AppError(404, "Event not found");
    }
    return event;
  }

  async delete(id: string): Promise<void> {
    const deleted = await this.eventRepo.delete(id);
    if (!deleted) {
      throw new AppError(404, "Event not found");
    }
  }

  async rsvp(data: CreateRsvpData): Promise<RSVP> {
    return this.eventRepo.createRsvp(data);
  }

  async getRsvpsForMember(memberId: string, eventIds?: string[]): Promise<RSVP[]> {
    return this.eventRepo.findRsvpsByMember(memberId, eventIds);
  }

  async checkIn(data: CreateAttendanceData): Promise<Attendance> {
    return this.eventRepo.createAttendance(data);
  }

  async getAttendance(eventId: string): Promise<Attendance[]> {
    return this.eventRepo.getAttendanceByEvent(eventId);
  }
}
