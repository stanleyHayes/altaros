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
  /**
   * The church's events.
   *
   * Takes no "upcoming" flag: it used to, and ignored it, so a caller asking
   * for future events quietly got past ones mixed in. /events/upcoming is the
   * endpoint for that and expands recurrence rules server-side.
   */
  async getEvents(): Promise<ChurchEvent[]> {
    const response = await get<{ events: ChurchEvent[] }>("/events");
    return response?.events ?? [];
  },

  async getEvent(id: string): Promise<ChurchEvent> {
    return get<ChurchEvent>(`/events/${id}`);
  },

  async rsvp(eventId: string, status: RsvpStatus): Promise<void> {
    return post(`/events/${eventId}/rsvp`, { status });
  },

  async checkIn(eventId: string, memberId: string): Promise<EventCheckIn> {
    // POST /events/{id}/check-in expects {memberId, method, checkedInAt}
    return post<EventCheckIn>(`/events/${eventId}/check-in`, {
      memberId,
      method: "manual",
      checkedInAt: new Date().toISOString(),
    });
  },

  async getMyAttendance(): Promise<EventCheckIn[]> {
    return get<EventCheckIn[]>("/events/rsvps/me");
  },
};

export default EventService;
