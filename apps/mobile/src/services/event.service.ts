import api from './api';
import { envelopeTotal, unwrapApiData } from './api-envelope';

export interface ChurchEvent {
  id: string;
  churchId: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  location: string;
  isRsvped: boolean;
  rsvpStatusKnown: boolean;
  attendeeCount: number;
  maxAttendees?: number;
}

export interface RsvpResponse {
  eventId: string;
  status: 'confirmed' | 'cancelled';
  attendeeCount?: number;
}

export interface EventMapAction {
  url: string | null;
  disabled: boolean;
  busy: boolean;
  label: string;
  hint?: string;
}

interface WireEvent {
  id: string;
  churchId: string;
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  location?: string;
  capacity?: number;
  rsvpCount?: number;
}

interface WireRsvp {
  id: string;
  eventId: string;
  memberId: string;
  status: 'GOING' | 'MAYBE' | 'NOT_GOING';
}

const RSVP_STATUSES = new Set<WireRsvp['status']>(['GOING', 'MAYBE', 'NOT_GOING']);
const MAX_EVENT_PAGE_SIZE = 50;
const DEFAULT_EVENT_PAGE_SIZE = 20;
export const EVENT_PAGE_SIZE = 25;
const MAX_EVENT_ID_LENGTH = 128;
const MAX_EVENT_TITLE_LENGTH = 200;
const MAX_EVENT_DESCRIPTION_LENGTH = 5_000;
const MAX_EVENT_LOCATION_LENGTH = 300;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function boundedText(value: unknown, maxLength: number, allowLineBreaks = false): value is string {
  if (typeof value !== 'string' || value.length > maxLength) return false;
  const unsafeControls = allowLineBreaks
    ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
    : /[\u0000-\u001F\u007F]/;
  return !unsafeControls.test(value);
}

function validEventId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= MAX_EVENT_ID_LENGTH
    && SAFE_ID.test(value);
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function requestedPageSize(params?: { page?: number; limit?: number; upcoming?: boolean; sortOrder?: 'asc' | 'desc' }): number {
  if (params?.page !== undefined && (!Number.isSafeInteger(params.page) || params.page < 1)) {
    throw new Error('The requested event page is invalid.');
  }
  if (params?.limit !== undefined
    && (!Number.isSafeInteger(params.limit) || params.limit < 1 || params.limit > MAX_EVENT_PAGE_SIZE)) {
    throw new Error('The requested event page size is invalid.');
  }
  if (params?.upcoming !== undefined && typeof params.upcoming !== 'boolean') {
    throw new Error('The requested event filter is invalid.');
  }
  if (params?.sortOrder !== undefined && params.sortOrder !== 'asc' && params.sortOrder !== 'desc') {
    throw new Error('The requested event sort order is invalid.');
  }
  return params?.limit ?? DEFAULT_EVENT_PAGE_SIZE;
}

function unwrapEventData(value: unknown, errorMessage: string): unknown {
  const canonical = unwrapApiData(value, errorMessage);
  if (canonical !== value) return canonical;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.prototype.hasOwnProperty.call(value, 'data')) {
    return (value as { data?: unknown }).data;
  }
  return value;
}

export function normalizeEvent(value: unknown, expectedChurchId?: string): ChurchEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The server returned an invalid event.');
  }
  const event = value as Partial<WireEvent>;
  const attendeeCount = event.rsvpCount ?? 0;
  const validCapacity = event.capacity === undefined
    || (Number.isSafeInteger(event.capacity) && Number(event.capacity) > 0);
  const valid = validEventId(event.id)
    && validEventId(event.churchId)
    && (!expectedChurchId || event.churchId === expectedChurchId)
    && boundedText(event.title, MAX_EVENT_TITLE_LENGTH)
    && nonEmptyString(event.title)
    && (event.description === undefined || boundedText(event.description, MAX_EVENT_DESCRIPTION_LENGTH, true))
    && (event.location === undefined || boundedText(event.location, MAX_EVENT_LOCATION_LENGTH))
    && validDate(event.startDate)
    && validDate(event.endDate)
    && Date.parse(event.endDate) >= Date.parse(event.startDate)
    && Number.isSafeInteger(attendeeCount)
    && attendeeCount >= 0
    && validCapacity;
  if (!valid) throw new Error('The server returned an invalid event.');
  const wire = event as WireEvent;
  return {
    id: wire.id,
    churchId: wire.churchId,
    title: wire.title,
    description: wire.description ?? '',
    location: wire.location?.trim() || 'Location to be announced',
    startDate: wire.startDate,
    endDate: wire.endDate,
    isRsvped: false,
    rsvpStatusKnown: false,
    attendeeCount,
    ...(wire.capacity !== undefined ? { maxAttendees: wire.capacity } : {}),
  };
}

function normalizeRsvp(
  value: unknown,
  eventId: string,
  memberId: string,
  expectedStatus?: WireRsvp['status'],
): WireRsvp {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The server returned an invalid RSVP.');
  }
  const rsvp = value as Partial<WireRsvp>;
  if (!validEventId(rsvp.id)
    || rsvp.eventId !== eventId
    || rsvp.memberId !== memberId
    || !RSVP_STATUSES.has(rsvp.status as WireRsvp['status'])
    || (expectedStatus !== undefined && rsvp.status !== expectedStatus)) {
    throw new Error('The server returned an invalid RSVP.');
  }
  return {
    id: rsvp.id,
    eventId: rsvp.eventId,
    memberId: rsvp.memberId,
    status: rsvp.status,
  } as WireRsvp;
}

export function eventRsvpAvailability(
  event: Pick<ChurchEvent, 'isRsvped' | 'attendeeCount' | 'maxAttendees' | 'endDate'>
    & Partial<Pick<ChurchEvent, 'rsvpStatusKnown'>>,
  now = Date.now(),
): { allowed: boolean; label: string; reason?: string } {
  if (event.rsvpStatusKnown === false) {
    return {
      allowed: false,
      label: 'RSVP unavailable',
      reason: 'Your attendance status could not be confirmed. Refresh before updating your RSVP.',
    };
  }
  if (event.isRsvped) return { allowed: true, label: 'Cancel RSVP' };
  const endTime = new Date(event.endDate).getTime();
  if (!Number.isFinite(endTime) || endTime <= now) {
    return { allowed: false, label: 'Event ended', reason: 'RSVP is closed because this event has ended.' };
  }
  if (event.maxAttendees && event.attendeeCount >= event.maxAttendees) {
    return { allowed: false, label: 'Event full', reason: 'This event has reached capacity.' };
  }
  return { allowed: true, label: 'RSVP' };
}

export function eventMapAction(
  location: string,
  offline: boolean,
  busy: boolean,
): EventMapAction {
  const available = boundedText(location, MAX_EVENT_LOCATION_LENGTH)
    && nonEmptyString(location)
    && location.trim() !== 'Location to be announced';
  const canonicalLocation = available ? location.trim() : '';
  const url = available
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(canonicalLocation)}`
    : null;
  const disabled = !url || offline || busy;
  const label = url ? `Open ${canonicalLocation} in Google Maps` : 'Event location is not available';
  const hint = !url ? 'Your church has not published a map location.'
    : offline ? 'Reconnect to open this location.'
      : busy ? 'Opening this location on your device.' : undefined;
  return { url, disabled, busy, label, ...(hint ? { hint } : {}) };
}

async function rsvpStatuses(
  eventIds: string[],
  memberId: string,
): Promise<Map<string, WireRsvp['status']>> {
  if (!eventIds.length) return new Map();
  if (!validEventId(memberId)
    || eventIds.length > MAX_EVENT_PAGE_SIZE
    || eventIds.some((id) => !validEventId(id))) {
    throw new Error('The requested RSVP history is invalid.');
  }
  const { data } = await api.get<unknown>('/events/rsvps/me', {
    params: { eventIds: eventIds.join(',') },
  });
  const history = unwrapEventData(data, 'The server returned invalid RSVP history.');
  if (!Array.isArray(history)) throw new Error('The server returned invalid RSVP history.');
  if (history.length > eventIds.length) throw new Error('The server returned invalid RSVP history.');
  const requested = new Set(eventIds);
  const entries = history.map((value): [string, WireRsvp['status']] => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('The server returned invalid RSVP history.');
    }
    const candidate = value as Partial<WireRsvp>;
    if (!nonEmptyString(candidate.eventId) || !requested.has(candidate.eventId)) {
      throw new Error('The server returned invalid RSVP history.');
    }
    const rsvp = normalizeRsvp(candidate, candidate.eventId, memberId);
    return [rsvp.eventId, rsvp.status];
  });
  if (new Set(entries.map(([eventId]) => eventId)).size !== entries.length) {
    throw new Error('The server returned invalid RSVP history.');
  }
  return new Map(entries);
}

const eventService = {
  async getEvents(churchId: string, memberId: string, params?: {
    page?: number;
    limit?: number;
    upcoming?: boolean;
    sortOrder?: 'asc' | 'desc';
  }): Promise<{ events: ChurchEvent[]; total: number }> {
    if (!validEventId(churchId) || !validEventId(memberId)) {
      throw new Error('The member identity is incomplete.');
    }
    const pageSize = requestedPageSize(params);
    const upcoming = params?.upcoming;
    const query = {
      ...params,
      ...(upcoming ? { upcoming: true, sortOrder: params?.sortOrder ?? 'asc' } : {}),
    };
    const { data } = await api.get<unknown>(`/events/church/${encodeURIComponent(churchId)}`, { params: query });
    const canonical = unwrapApiData(data, 'The server returned invalid events.');
    let payload: unknown = canonical;
    let pagedTotal: unknown;
    if (params?.page !== undefined) {
      if (typeof canonical !== 'object' || canonical === null || Array.isArray(canonical)) {
        throw new Error('The server returned invalid events.');
      }
      payload = (canonical as { data?: unknown }).data;
      pagedTotal = (canonical as { total?: unknown }).total;
    } else {
      payload = unwrapEventData(data, 'The server returned invalid events.');
    }
    if (!Array.isArray(payload)) throw new Error('The server returned invalid events.');
    if (payload.length > pageSize) throw new Error('The server returned too many events.');
    const normalized = payload.map((wire) => normalizeEvent(wire, churchId));
    if (new Set(normalized.map((event) => event.id)).size !== normalized.length) {
      throw new Error('The server returned duplicate events.');
    }
    const statuses = await rsvpStatuses(normalized.map((event) => event.id), memberId).catch(() => null);
    const events = normalized.map((event) => ({
      ...event,
      isRsvped: statuses?.get(event.id) === 'GOING',
      rsvpStatusKnown: statuses !== null,
    }));
    const visibleEvents = upcoming
      ? events
        .filter((event) => new Date(event.endDate).getTime() >= Date.now())
        .sort((first, second) => new Date(first.startDate).getTime() - new Date(second.startDate).getTime())
      : events;
    if (params?.page !== undefined && pagedTotal === undefined) {
      throw new Error('The server returned an invalid event total.');
    }
    const reportedTotal = pagedTotal ?? envelopeTotal(data) ?? payload.length;
    if (!Number.isSafeInteger(reportedTotal) || Number(reportedTotal) < normalized.length) {
      throw new Error('The server returned an invalid event total.');
    }
    return {
      events: visibleEvents,
      total: params?.page === undefined && upcoming ? visibleEvents.length : Number(reportedTotal),
    };
  },

  async getEvent(id: string, churchId: string, memberId: string): Promise<ChurchEvent> {
    if (!validEventId(id)) throw new Error('The requested event is invalid.');
    if (!validEventId(churchId) || !validEventId(memberId)) {
      throw new Error('The member identity is incomplete.');
    }
    const { data } = await api.get<unknown>(`/events/${encodeURIComponent(id)}`, {
      params: { upcoming: true },
    });
    const event = normalizeEvent(
      unwrapEventData(data, 'The server returned an invalid event.'),
      churchId,
    );
    if (event.id !== id) throw new Error('The server returned the wrong event.');
    const statuses = await rsvpStatuses([id], memberId).catch(() => null);
    return {
      ...event,
      isRsvped: statuses?.get(id) === 'GOING',
      rsvpStatusKnown: statuses !== null,
    };
  },

  async rsvp(eventId: string, memberId: string): Promise<RsvpResponse> {
    if (!validEventId(eventId)) throw new Error('The requested event is invalid.');
    if (!validEventId(memberId)) throw new Error('The member identity is incomplete.');
    const { data } = await api.post<unknown>('/events/rsvp', {
      eventId,
      status: 'GOING',
    });
    const rsvp = normalizeRsvp(unwrapEventData(data, 'The server returned an invalid RSVP.'), eventId, memberId, 'GOING');
    return { eventId: rsvp.eventId, status: 'confirmed' };
  },

  async cancelRsvp(eventId: string, memberId: string): Promise<RsvpResponse> {
    if (!validEventId(eventId)) throw new Error('The requested event is invalid.');
    if (!validEventId(memberId)) throw new Error('The member identity is incomplete.');
    const { data } = await api.post<unknown>('/events/rsvp', {
      eventId,
      status: 'NOT_GOING',
    });
    const rsvp = normalizeRsvp(unwrapEventData(data, 'The server returned an invalid RSVP.'), eventId, memberId, 'NOT_GOING');
    return { eventId: rsvp.eventId, status: 'cancelled' };
  },

  async getUpcoming(churchId: string, memberId: string, limit?: number): Promise<ChurchEvent[]> {
    const requestedLimit = limit ?? 5;
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 50) {
      throw new Error('The requested upcoming-event count is invalid.');
    }
    const result = await this.getEvents(churchId, memberId, { limit: 50, upcoming: true });
    return result.events.slice(0, requestedLimit);
  },

};

export default eventService;
