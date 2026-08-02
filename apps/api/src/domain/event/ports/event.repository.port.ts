import type {
  Event,
  RSVP,
  Attendance,
  RsvpStatus,
  CheckInMethod,
  PaginationQuery,
} from "@altar-os/shared-types";
import type { PaginatedResult } from "../../church/ports/church.repository.port.js";

export interface CreateEventData {
  churchId: string;
  title: string;
  description?: string;
  location?: string;
  startDate: Date;
  endDate: Date;
  isRecurring?: boolean;
  recurrenceRule?: string;
  capacity?: number;
}

export type UpdateEventData = Partial<CreateEventData>;

export interface CreateRsvpData {
  eventId: string;
  memberId: string;
  status: RsvpStatus;
}

export interface CreateAttendanceData {
  eventId: string;
  memberId: string;
  churchId: string;
  method: CheckInMethod;
}

export interface EventQuery extends PaginationQuery {
  /** Only events whose end time has not passed. */
  upcoming?: boolean;
}

export interface IEventRepository {
  create(data: CreateEventData): Promise<Event>;
  findById(id: string): Promise<Event | null>;
  findByChurchId(
    churchId: string,
    query: EventQuery,
  ): Promise<PaginatedResult<Event>>;
  update(id: string, data: UpdateEventData): Promise<Event | null>;
  delete(id: string): Promise<boolean>;
  createRsvp(data: CreateRsvpData): Promise<RSVP>;
  findRsvpsByMember(memberId: string, eventIds?: string[]): Promise<RSVP[]>;
  createAttendance(data: CreateAttendanceData): Promise<Attendance>;
  getAttendanceByEvent(eventId: string): Promise<Attendance[]>;
}
