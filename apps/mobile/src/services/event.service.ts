import api from './api';

export interface ChurchEvent {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  location: string;
  address?: string;
  imageUrl?: string;
  category: 'worship' | 'fellowship' | 'outreach' | 'youth' | 'conference' | 'other';
  isRsvped: boolean;
  attendeeCount: number;
  maxAttendees?: number;
  organizer: string;
}

export interface RsvpResponse {
  eventId: string;
  status: 'confirmed' | 'cancelled';
  attendeeCount: number;
}

const eventService = {
  async getEvents(params?: {
    page?: number;
    limit?: number;
    category?: string;
    upcoming?: boolean;
  }): Promise<{ events: ChurchEvent[]; total: number }> {
    const { data } = await api.get('/events', { params });
    return data;
  },

  async getEvent(id: string): Promise<ChurchEvent> {
    const { data } = await api.get<ChurchEvent>(`/events/${id}`);
    return data;
  },

  async rsvp(eventId: string): Promise<RsvpResponse> {
    const { data } = await api.post<RsvpResponse>(`/events/${eventId}/rsvp`);
    return data;
  },

  async cancelRsvp(eventId: string): Promise<RsvpResponse> {
    const { data } = await api.delete<RsvpResponse>(`/events/${eventId}/rsvp`);
    return data;
  },

  async getUpcoming(limit?: number): Promise<ChurchEvent[]> {
    const { data } = await api.get<ChurchEvent[]>('/events/upcoming', {
      params: { limit: limit || 5 },
    });
    return data;
  },

  async getAttendees(
    eventId: string,
  ): Promise<{ id: string; name: string; avatar?: string }[]> {
    const { data } = await api.get(`/events/${eventId}/attendees`);
    return data;
  },
};

export default eventService;
