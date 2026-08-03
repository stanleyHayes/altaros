export interface EventMemberContext {
  churchId?: string;
  memberId?: string;
}

export interface EventDetailContext extends EventMemberContext {
  eventId: string;
}

export type EventFocusLoadMode = 'initial' | 'refresh' | 'skip';

interface EventRsvpAvailability {
  allowed: boolean;
  label: string;
  reason?: string;
}

export function eventRsvpAction(
  availability: EventRsvpAvailability,
  isRsvped: boolean,
  offline: boolean,
  updatingThisEvent: boolean,
  updatingAnotherEvent: boolean,
  detail = false,
) {
  const baseLabel = availability.allowed && !isRsvped && detail
    ? 'RSVP to this event'
    : availability.label;
  return {
    label: updatingThisEvent
      ? isRsvped ? 'Cancelling your RSVP…' : 'Saving your RSVP…'
      : updatingAnotherEvent ? 'Another RSVP is updating…'
        : offline && availability.allowed
          ? isRsvped ? 'Reconnect to cancel RSVP' : 'Reconnect to RSVP'
          : baseLabel,
    disabled: offline || !availability.allowed || updatingThisEvent || updatingAnotherEvent,
    hint: offline && availability.allowed
      ? 'Reconnect to update your RSVP.'
      : updatingThisEvent ? 'Wait while your attendance is being updated.'
        : updatingAnotherEvent ? 'Wait for the other RSVP update to finish.'
          : availability.reason,
  } as const;
}

export function eventListRecoveryAction(
  offline: boolean,
  reason: 'load' | 'rsvp',
): { label: string; hint: string; disabled: boolean } {
  if (offline) {
    return {
      label: 'Reconnect to refresh',
      hint: reason === 'rsvp'
        ? 'Reconnect to refresh your attendance status.'
        : 'Reconnect to refresh upcoming events.',
      disabled: true,
    };
  }
  return reason === 'rsvp'
    ? {
      label: 'Refresh RSVP status',
      hint: 'Loads your latest attendance status before another RSVP change.',
      disabled: false,
    }
    : {
      label: 'Refresh to continue',
      hint: 'Refreshes upcoming events from the first page.',
      disabled: false,
    };
}

export function eventRsvpFailure(error: unknown): { outcomeUnknown: boolean; message: string } {
  if (isAmbiguousMutationFailure(error)) {
    return {
      outcomeUnknown: true,
      message: 'We could not confirm whether your RSVP changed. Refresh attendance status before trying again.',
    };
  }
  return {
    outcomeUnknown: false,
    message: 'We could not update that RSVP. Try again.',
  };
}

export function eventFocusLoadMode(
  hasFocusedBefore: boolean,
  offline: boolean,
): EventFocusLoadMode {
  if (!hasFocusedBefore) return 'initial';
  return offline ? 'skip' : 'refresh';
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
import { isAmbiguousMutationFailure } from '../../services/api-error';
