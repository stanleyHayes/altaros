import api from './api';
import eventService, { eventMapAction, eventRsvpAvailability, normalizeEvent } from './event.service';

jest.mock('./api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

const mockedApi = api as jest.Mocked<typeof api>;

describe('event API contract', () => {
  beforeEach(() => jest.clearAllMocks());

  it('allows an existing RSVP to be cancelled even after capacity is reached', () => {
    expect(eventRsvpAvailability({ isRsvped: true, attendeeCount: 20, maxAttendees: 20, endDate: '2020-01-01' }))
      .toEqual({ allowed: true, label: 'Cancel RSVP' });
  });

  it('closes new RSVPs for full and ended events', () => {
    expect(eventRsvpAvailability({ isRsvped: false, attendeeCount: 20, maxAttendees: 20, endDate: '2099-01-01' }, 0))
      .toMatchObject({ allowed: false, label: 'Event full' });
    expect(eventRsvpAvailability({ isRsvped: false, attendeeCount: 0, endDate: '2020-01-01' }, Date.parse('2021-01-01')))
      .toMatchObject({ allowed: false, label: 'Event ended' });
  });

  it('builds an encoded Google Maps search for a published location', () => {
    expect(eventMapAction(' Accra International Conference Centre ', false, false)).toEqual({
      url: 'https://www.google.com/maps/search/?api=1&query=Accra%20International%20Conference%20Centre',
      disabled: false,
      busy: false,
      label: 'Open Accra International Conference Centre in Google Maps',
    });
  });

  it('closes map launching while offline or already opening', () => {
    expect(eventMapAction('Osu Oxford Street', true, false)).toMatchObject({
      disabled: true, hint: 'Reconnect to open this location.',
    });
    expect(eventMapAction('Osu Oxford Street', false, true)).toMatchObject({
      disabled: true, busy: true, hint: 'Opening this location on your device.',
    });
  });

  it('does not create a map action for an unpublished location', () => {
    expect(eventMapAction('Location to be announced', false, false)).toMatchObject({
      url: null, disabled: true, label: 'Event location is not available',
    });
  });

  it('does not allow an RSVP mutation while the member attendance state is unknown', () => {
    expect(eventRsvpAvailability({
      isRsvped: false, rsvpStatusKnown: false, attendeeCount: 0, endDate: '2099-01-01',
    }, 0)).toMatchObject({ allowed: false, label: 'RSVP unavailable' });
  });

  it('loads the authenticated church route and normalizes the legacy envelope', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: {
        data: [{
          id: 'event-1',
          churchId: 'church-1',
          title: 'Sunday worship',
          startDate: '2026-08-02T09:00:00.000Z',
          endDate: '2026-08-02T11:00:00.000Z',
          rsvpCount: 12,
        }],
        pagination: { total: 1 },
      },
    } as never).mockResolvedValueOnce({
      data: { data: [{ id: 'rsvp-1', eventId: 'event-1', memberId: 'member-1', status: 'GOING' }] },
    } as never);

    const result = await eventService.getEvents('church-1', 'member-1', { limit: 20 });

    expect(mockedApi.get).toHaveBeenCalledWith('/events/church/church-1', {
      params: { limit: 20 },
    });
    expect(result).toMatchObject({
      total: 1,
      events: [{ id: 'event-1', attendeeCount: 12, location: 'Location to be announced', isRsvped: true, rsvpStatusKnown: true }],
    });
    expect(mockedApi.get).toHaveBeenNthCalledWith(2, '/events/rsvps/me', {
      params: { eventIds: 'event-1' },
    });
  });

  it('rejects unsafe event and church identifiers before transport', async () => {
    await expect(eventService.getEvent('event/unsafe id', 'church-1', 'member-1'))
      .rejects.toThrow('requested event is invalid');
    await expect(eventService.getEvents('church/unsafe id', 'member-1'))
      .rejects.toThrow('identity is incomplete');
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('rejects a deep-linked detail response owned by another church', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: { data: {
        id: 'event-1', churchId: 'other-church', title: 'Private gathering',
        startDate: '2026-08-02', endDate: '2026-08-02',
      } },
    } as never);

    await expect(eventService.getEvent('event-1', 'church-1', 'member-1'))
      .rejects.toThrow('invalid event');
    expect(mockedApi.get).toHaveBeenCalledTimes(1);
  });

  it('asks the server to paginate upcoming events chronologically and keeps defensive sorting', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { data: [
      { id: 'later', churchId: 'church-1', title: 'Later', startDate: '2099-08-10', endDate: '2099-08-10' },
      { id: 'sooner', churchId: 'church-1', title: 'Sooner', startDate: '2099-08-02', endDate: '2099-08-02' },
    ], pagination: { total: 2 } } } as never).mockResolvedValueOnce({ data: { data: [] } } as never);

    const result = await eventService.getEvents('church-1', 'member-1', { limit: 20, upcoming: true });
    expect(mockedApi.get).toHaveBeenNthCalledWith(1, '/events/church/church-1', {
      params: { limit: 20, upcoming: true, sortOrder: 'asc' },
    });
    expect(result.events.map((event) => event.id)).toEqual(['sooner', 'later']);
  });

  it('fetches a bounded candidate set before selecting the nearest home events', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { data: [
      { id: 'third', churchId: 'church-1', title: 'Third', startDate: '2099-08-03', endDate: '2099-08-03' },
      { id: 'first', churchId: 'church-1', title: 'First', startDate: '2099-08-01', endDate: '2099-08-01' },
      { id: 'second', churchId: 'church-1', title: 'Second', startDate: '2099-08-02', endDate: '2099-08-02' },
    ] } } as never).mockResolvedValueOnce({ data: { data: [] } } as never);

    await expect(eventService.getUpcoming('church-1', 'member-1', 2)).resolves.toMatchObject([{ id: 'first' }, { id: 'second' }]);
    expect(mockedApi.get).toHaveBeenNthCalledWith(1, '/events/church/church-1', {
      params: { limit: 50, upcoming: true, sortOrder: 'asc' },
    });
  });

  it('records cancellation as NOT_GOING on the shared RSVP endpoint', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { success: true, data: { id: 'rsvp-1', eventId: 'event-1', memberId: 'member-1', status: 'NOT_GOING' } },
    } as never);

    await expect(eventService.cancelRsvp('event-1', 'member-1')).resolves.toEqual({
      eventId: 'event-1',
      status: 'cancelled',
    });
    expect(mockedApi.post).toHaveBeenCalledWith('/events/rsvp', {
      eventId: 'event-1', status: 'NOT_GOING',
    });
  });

  it.each([
    { id: 'event-1', churchId: 'church-1', title: '', startDate: '2026-08-02', endDate: '2026-08-02' },
    { id: 'event-1', churchId: 'other-church', title: 'Wrong tenant', startDate: '2026-08-02', endDate: '2026-08-02' },
    { id: 'event-1', churchId: 'church-1', title: 'Backwards', startDate: '2026-08-03', endDate: '2026-08-02' },
    { id: 'event-1', churchId: 'church-1', title: 'Bad count', startDate: '2026-08-02', endDate: '2026-08-02', rsvpCount: -1 },
    { id: 'event-1', churchId: 'church-1', title: 'Bad capacity', startDate: '2026-08-02', endDate: '2026-08-02', capacity: 1.5 },
  ])('rejects malformed or cross-church event data', (event) => {
    expect(() => normalizeEvent(event, 'church-1')).toThrow('invalid event');
  });

  it('rejects an RSVP response that does not echo the requested event and status', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { data: { id: 'rsvp-1', eventId: 'different-event', memberId: 'member-1', status: 'NOT_GOING' } },
    } as never);

    await expect(eventService.rsvp('event-1', 'member-1')).rejects.toThrow('invalid RSVP');
  });

  it('rejects an RSVP mutation response owned by another member', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { data: { id: 'rsvp-1', eventId: 'event-1', memberId: 'member-2', status: 'GOING' } },
    } as never);
    await expect(eventService.rsvp('event-1', 'member-1')).rejects.toThrow('invalid RSVP');
  });

  it('does not apply another member RSVP from self-history', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { data: [{
      id: 'event-1', churchId: 'church-1', title: 'Gathering',
      startDate: '2099-08-02', endDate: '2099-08-02',
    }] } } as never).mockResolvedValueOnce({ data: { data: [{
      id: 'rsvp-1', eventId: 'event-1', memberId: 'member-2', status: 'GOING',
    }] } } as never);

    await expect(eventService.getEvents('church-1', 'member-1'))
      .resolves.toMatchObject({ events: [{ isRsvped: false, rsvpStatusKnown: false }] });
  });

  it('preserves readable events but marks RSVP state unknown when history transport fails', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { data: [{
      id: 'event-1', churchId: 'church-1', title: 'Gathering',
      startDate: '2099-08-02', endDate: '2099-08-02',
    }] } } as never).mockRejectedValueOnce(new Error('offline'));

    await expect(eventService.getEvents('church-1', 'member-1'))
      .resolves.toMatchObject({ events: [{ isRsvped: false, rsvpStatusKnown: false }] });
  });

  it('rejects duplicate event identifiers before FlatList receives unstable keys', async () => {
    const duplicate = { id: 'event-1', churchId: 'church-1', title: 'Event', startDate: '2099-08-02', endDate: '2099-08-02' };
    mockedApi.get.mockResolvedValueOnce({ data: { data: [duplicate, duplicate] } } as never);

    await expect(eventService.getEvents('church-1', 'member-1')).rejects.toThrow('duplicate events');
  });

  it.each([
    ['identifier', { id: 'event-1\u0000suffix', churchId: 'church-1', title: 'Event', startDate: '2099-08-02', endDate: '2099-08-02' }],
    ['title', { id: 'event-1', churchId: 'church-1', title: 'x'.repeat(201), startDate: '2099-08-02', endDate: '2099-08-02' }],
    ['description', { id: 'event-1', churchId: 'church-1', title: 'Event', description: 'x'.repeat(5_001), startDate: '2099-08-02', endDate: '2099-08-02' }],
    ['location', { id: 'event-1', churchId: 'church-1', title: 'Event', location: 'x'.repeat(301), startDate: '2099-08-02', endDate: '2099-08-02' }],
  ])('rejects an unsafe or oversized event %s', (_field, event) => {
    expect(() => normalizeEvent(event, 'church-1')).toThrow('invalid event');
  });

  it('preserves line breaks in a bounded event description', () => {
    expect(normalizeEvent({
      id: 'event-1', churchId: 'church-1', title: 'Retreat',
      description: 'Friday arrival\nSaturday sessions', startDate: '2099-08-02', endDate: '2099-08-03',
    }, 'church-1').description).toContain('\n');
  });

  it('rejects malformed event pagination before transport', async () => {
    await expect(eventService.getEvents('church-1', 'member-1', { page: 0, limit: 101 }))
      .rejects.toThrow('event page');
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('rejects a response that exceeds the requested event page size', async () => {
    const event = (id: string) => ({ id, churchId: 'church-1', title: 'Event', startDate: '2099-08-02', endDate: '2099-08-02' });
    mockedApi.get.mockResolvedValueOnce({ data: { data: [event('event-1'), event('event-2')] } } as never);
    await expect(eventService.getEvents('church-1', 'member-1', { limit: 1 })).rejects.toThrow('too many events');
    expect(mockedApi.get).toHaveBeenCalledTimes(1);
  });

  it('rejects an unsafe upcoming-event count before transport', async () => {
    await expect(eventService.getUpcoming('church-1', 'member-1', 51)).rejects.toThrow('upcoming-event count');
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('rejects an oversized event mutation identifier before transport', async () => {
    await expect(eventService.rsvp('x'.repeat(129), 'member-1')).rejects.toThrow('requested event is invalid');
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('rejects an unsafe RSVP member identity before transport', async () => {
    await expect(eventService.rsvp('event-1', 'member/unsafe'))
      .rejects.toThrow('identity is incomplete');
    expect(mockedApi.post).not.toHaveBeenCalled();
  });
});
