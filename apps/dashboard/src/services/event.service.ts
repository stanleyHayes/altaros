import { get, post, put, del } from "./api";

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
  status: "upcoming" | "ongoing" | "completed" | "cancelled";
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

export interface AttendancePayload {
  eventId: string;
  memberIds: string[];
  date: string;
}

export interface EventSearchParams {
  status?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const EventService = {
  async getAll(
    params?: EventSearchParams,
  ): Promise<PaginatedResponse<Event>> {
    return get<PaginatedResponse<Event>>("/events", { params });
  },

  async getById(id: string): Promise<Event> {
    return get<Event>(`/events/${id}`);
  },

  async create(payload: CreateEventPayload): Promise<Event> {
    return post<Event>("/events", payload);
  },

  async update(id: string, payload: UpdateEventPayload): Promise<Event> {
    return put<Event>(`/events/${id}`, payload);
  },

  async remove(id: string): Promise<void> {
    return del<void>(`/events/${id}`);
  },

  async submitRsvp(payload: RsvpPayload): Promise<void> {
    return post<void>(`/events/${payload.eventId}/rsvp`, payload);
  },

  async recordAttendance(payload: AttendancePayload): Promise<void> {
    return post<void>(`/events/${payload.eventId}/attendance`, payload);
  },

  async getAttendance(
    eventId: string,
  ): Promise<{ memberId: string; memberName: string; date: string }[]> {
    return get(`/events/${eventId}/attendance`);
  },
};

export default EventService;
