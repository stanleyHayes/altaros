import {
  eventActionCompletionBelongsToContext,
  eventDetailBelongsToContext,
  eventListBelongsToIdentity,
} from './event-screen-state';

describe('event screen ownership', () => {
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
});
