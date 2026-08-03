import { AxiosError, AxiosHeaders } from 'axios';
import {
  eventActionCompletionBelongsToContext,
  eventDetailBelongsToContext,
  eventFocusLoadMode,
  eventListRecoveryAction,
  eventListBelongsToIdentity,
  eventRsvpFailure,
  eventRsvpAction,
} from './event-screen-state';

describe('event screen ownership', () => {
  it('loads once on first focus and refreshes authoritative RSVP state on return', () => {
    expect(eventFocusLoadMode(false, false)).toBe('initial');
    expect(eventFocusLoadMode(false, true)).toBe('initial');
    expect(eventFocusLoadMode(true, false)).toBe('refresh');
    expect(eventFocusLoadMode(true, true)).toBe('skip');
  });

  it('renders member RSVP lists only for their exact owner', () => {
    const active = { churchId: 'church-1', memberId: 'member-1' };
    expect(eventListBelongsToIdentity(active, active)).toBe(true);
    expect(eventListBelongsToIdentity(null, active)).toBe(false);
    expect(eventListBelongsToIdentity({ ...active, memberId: 'member-2' }, active)).toBe(false);
    expect(eventListBelongsToIdentity({ ...active, churchId: 'church-2' }, active)).toBe(false);
  });

  it('renders event detail only for the exact route, church, and member', () => {
    const active = { eventId: 'event-1', churchId: 'church-1', memberId: 'member-1' };
    expect(eventDetailBelongsToContext(active, active)).toBe(true);
    expect(eventDetailBelongsToContext({ ...active, eventId: 'event-2' }, active)).toBe(false);
    expect(eventDetailBelongsToContext({ ...active, memberId: 'member-2' }, active)).toBe(false);
    expect(eventDetailBelongsToContext({ ...active, churchId: 'church-2' }, active)).toBe(false);
    expect(eventDetailBelongsToContext(null, active)).toBe(false);
  });

  it('accepts action completion only while the initiating detail remains mounted and active', () => {
    const started = { eventId: 'event-1', churchId: 'church-1', memberId: 'member-1' };
    expect(eventActionCompletionBelongsToContext(true, started, started)).toBe(true);
    expect(eventActionCompletionBelongsToContext(false, started, started)).toBe(false);
    expect(eventActionCompletionBelongsToContext(true, { ...started, eventId: 'event-2' }, started))
      .toBe(false);
    expect(eventActionCompletionBelongsToContext(true, { ...started, memberId: 'member-2' }, started))
      .toBe(false);
  });

  it('blocks blind RSVP retries when the gateway response is lost', () => {
    const timeout = new AxiosError('timeout', 'ECONNABORTED');
    expect(eventRsvpFailure(timeout)).toEqual({
      outcomeUnknown: true,
      message: 'We could not confirm whether your RSVP changed. Refresh attendance status before trying again.',
    });
  });

  it('keeps ordinary retry behavior for an explicit RSVP rejection', () => {
    const rejected = new AxiosError(
      'Request failed',
      'ERR_BAD_REQUEST',
      { headers: new AxiosHeaders() },
      undefined,
      { data: {}, status: 409, statusText: 'Conflict', headers: {}, config: { headers: new AxiosHeaders() } },
    );
    expect(eventRsvpFailure(rejected)).toEqual({
      outcomeUnknown: false,
      message: 'We could not update that RSVP. Try again.',
    });
  });
});

describe('event list recovery', () => {
  it('keeps list and detail RSVP actions explicit while unavailable or busy', () => {
    const available = { allowed: true, label: 'RSVP' };
    expect(eventRsvpAction(available, false, true, false, false)).toEqual({
      label: 'Reconnect to RSVP',
      disabled: true,
      hint: 'Reconnect to update your RSVP.',
    });
    expect(eventRsvpAction({ allowed: true, label: 'Cancel RSVP' }, true, false, true, false).label)
      .toBe('Cancelling your RSVP…');
    expect(eventRsvpAction(available, false, false, false, true).label)
      .toBe('Another RSVP is updating…');
    expect(eventRsvpAction(available, false, false, false, false, true)).toEqual({
      label: 'RSVP to this event',
      disabled: false,
      hint: undefined,
    });
    expect(eventRsvpAction({ allowed: false, label: 'Event full', reason: 'At capacity.' }, false, false, false, false))
      .toEqual({ label: 'Event full', disabled: true, hint: 'At capacity.' });
  });

  it('distinguishes list refresh from RSVP-status reconciliation', () => {
    expect(eventListRecoveryAction(false, 'load')).toEqual({
      label: 'Refresh to continue',
      hint: 'Refreshes upcoming events from the first page.',
      disabled: false,
    });
    expect(eventListRecoveryAction(false, 'rsvp')).toEqual({
      label: 'Refresh RSVP status',
      hint: 'Loads your latest attendance status before another RSVP change.',
      disabled: false,
    });
    expect(eventListRecoveryAction(true, 'rsvp')).toEqual({
      label: 'Reconnect to refresh',
      hint: 'Reconnect to refresh your attendance status.',
      disabled: true,
    });
  });
});
