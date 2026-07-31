import { get, post } from "./api";

export type RsvpStatus = "going" | "maybe" | "not_going";

export interface ChurchEvent {
  id: string;
  title: string;
  description: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  imageUrl?: string;
  category: string;
  rsvpCount: number;
  myRsvp?: RsvpStatus;
  isRecurring: boolean;
}

export interface EventCheckIn {
  id: string;
  eventId: string;
  checkedInAt: string;
}

const EventService = {
  async getEvents(upcoming = true): Promise<ChurchEvent[]> {
    // TODO: Replace with actual API call
    return get<ChurchEvent[]>(`/events?upcoming=${upcoming}`);
  },

  async getEvent(id: string): Promise<ChurchEvent> {
    // TODO: Replace with actual API call
    return get<ChurchEvent>(`/events/${id}`);
  },

  async rsvp(eventId: string, status: RsvpStatus): Promise<void> {
    // TODO: Replace with actual API call
    return post(`/events/${eventId}/rsvp`, { status });
  },

  async checkIn(eventId: string): Promise<EventCheckIn> {
    // TODO: Replace with actual API call
    return post<EventCheckIn>(`/events/${eventId}/check-in`);
  },

  async getMyAttendance(): Promise<EventCheckIn[]> {
    // TODO: Replace with actual API call
    return get<EventCheckIn[]>("/events/my-attendance");
  },
};

export default EventService;
