export interface EventMemberContext {
  churchId?: string;
  memberId?: string;
}

export interface EventDetailContext extends EventMemberContext {
  eventId: string;
}

export function eventListBelongsToIdentity(
  owner: EventMemberContext | null,
  active: EventMemberContext,
): boolean {
  return owner !== null
    && owner.churchId !== undefined
    && owner.memberId !== undefined
    && owner.churchId === active.churchId
    && owner.memberId === active.memberId;
}

export function eventDetailBelongsToContext(
  owner: EventDetailContext | null,
  active: EventDetailContext,
): boolean {
  return owner !== null
    && owner.churchId !== undefined
    && owner.memberId !== undefined
    && owner.eventId === active.eventId
    && owner.churchId === active.churchId
    && owner.memberId === active.memberId;
}

export function eventActionCompletionBelongsToContext(
  mounted: boolean,
  active: EventDetailContext,
  started: EventDetailContext,
): boolean {
  return mounted && eventDetailBelongsToContext(active, started);
}
