import { get, post, patch, del } from "./api";

/**
 * One check-in.
 *
 * Records who DID attend, keyed by member id — there is no name on it and no
 * row for someone who stayed away. A screen listing the whole roster with a
 * present/absent mark therefore has to join this against the members list;
 * attendance alone cannot answer "who was missing".
 */
export interface AttendanceRecord {
  id: string;
  eventId: string;
  memberId: string;
  occurrenceAt: string;
  method: string;
}

export interface Event {
  id: string;
  title: string;
  description?: string;
  location?: string;
  startDate: string;
  endDate?: string;
  isRecurring: boolean;
  recurrenceRule?: string;
  capacity?: number;
  rsvpCount: number;
  attendanceCount: number;
  churchId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEventPayload {
  title: string;
  description?: string;
  location?: string;
  startDate: string;
  endDate?: string;
  isRecurring?: boolean;
  recurrenceRule?: string;
  capacity?: number;
}

export type UpdateEventPayload = Partial<CreateEventPayload>;

export interface RsvpPayload {
  eventId: string;
  memberId: string;
  status: "attending" | "declined" | "maybe";
}

export interface CheckInPayload {
  memberIds: string[];
  date: string;
}

export interface EventSearchParams {
  from?: string;
  to?: string;
  limit?: number;
}

const EventService = {
  async getAll(
    params?: EventSearchParams,
  ): Promise<{ events: Event[] }> {
    return get<{ events: Event[] }>("/events", { params });
  },

  /**
   * The next occurrences, already expanded.
   *
   * A dedicated endpoint rather than filtering getAll: recurring events are
   * stored as a rule, so "the next four things happening" cannot be derived
   * client-side from the event list without re-implementing the recurrence
   * expansion the server already does.
   */
  async upcoming(limit?: number): Promise<Event[]> {
    const res = await get<{ events: Event[] }>("/events/upcoming", {
      params: limit ? { limit } : undefined,
    });
    return res?.events ?? [];
  },

  async getById(id: string): Promise<Event> {
    return get<Event>(`/events/${id}`);
  },

  async create(payload: CreateEventPayload): Promise<Event> {
    return post<Event>("/events", payload);
  },

  async update(id: string, payload: UpdateEventPayload): Promise<Event> {
    return patch<Event>(`/events/${id}`, payload);
  },

  async remove(id: string): Promise<void> {
    return del<void>(`/events/${id}`);
  },

  async submitRsvp(payload: RsvpPayload): Promise<void> {
    return post<void>(`/events/${payload.eventId}/rsvp`, payload);
  },

  async checkIn(eventId: string, payload: CheckInPayload): Promise<void> {
    return post<void>(`/events/${eventId}/check-in`, payload);
  },

  /**
   * Check-ins for an event.
   *
   * The declared return type used to promise `memberName` on every row. The
   * endpoint has never sent one — attendance is keyed by member id — so any
   * screen that trusted the type rendered undefined where a name should be.
   */
  async getAttendance(
    eventId: string,
  ): Promise<{ attendance: AttendanceRecord[]; total: number }> {
    return get<{ attendance: AttendanceRecord[]; total: number }>(
      `/events/${eventId}/attendance`,
    );
  },
};

export default EventService;
