import { apiErrorMessage, isAmbiguousMutationFailure } from '../../services/api-error';

export interface WelfareOwner {
  churchId?: string;
  memberId?: string;
}

export interface EmergencyConfirmationGate {
  begin: () => number;
  consume: (token: number) => boolean;
  cancel: (token: number) => boolean;
  invalidate: () => void;
  isActive: () => boolean;
}

export function welfareFormActionState(
  offline: boolean,
  submitting: boolean,
  emergencySubmitting: boolean,
  outcomeUnknown = false,
): {
  controlsDisabled: boolean;
  requestDisabled: boolean;
  emergencyDisabled: boolean;
} {
  const mutationInFlight = submitting || emergencySubmitting;
  return {
    controlsDisabled: mutationInFlight || outcomeUnknown,
    requestDisabled: offline || mutationInFlight,
    emergencyDisabled: offline || mutationInFlight || outcomeUnknown,
  };
}

export function welfareRequestActionState(
  offline: boolean,
  busy: boolean,
  outcomeUnknown: boolean,
): { mode: 'submit' | 'refresh'; label: string; disabled: boolean; hint?: string } {
  return {
    mode: outcomeUnknown ? 'refresh' : 'submit',
    label: outcomeUnknown ? (offline ? 'Reconnect to confirm request' : 'Refresh care history') : 'Submit Request',
    disabled: offline || busy,
    hint: outcomeUnknown
      ? offline
        ? 'Reconnect to confirm whether your private request was recorded.'
        : 'Refreshes your private care history before another request can be submitted.'
      : undefined,
  };
}

export function welfareRefreshOwnsReconciliation(
  startedRevision: number,
  currentRevision: number,
): boolean {
  return startedRevision === currentRevision;
}

export function welfareChoiceAccessibility(selected: boolean, disabled: boolean) {
  return { selected, checked: selected, disabled };
}

/**
 * Native alerts can remain visible while the app is backgrounded. A token
 * makes confirmation single-use and lets the screen expire that prompt
 * without releasing an emergency request that has already started.
 */
export function createEmergencyConfirmationGate(): EmergencyConfirmationGate {
  let version = 0;
  let active = false;
  const finish = (token: number) => {
    if (!active || token !== version) return false;
    active = false;
    return true;
  };
  return {
    begin() {
      version += 1;
      active = true;
      return version;
    },
    consume: finish,
    cancel: finish,
    invalidate() {
      version += 1;
      active = false;
    },
    isActive() {
      return active;
    },
  };
}

export function expireEmergencyConfirmation(
  gate: EmergencyConfirmationGate,
  releaseConfirmationLock: () => void,
): boolean {
  if (!gate.isActive()) return false;
  gate.invalidate();
  releaseConfirmationLock();
  return true;
}

export function welfareStateBelongsToIdentity(
  owner: WelfareOwner | null,
  active: WelfareOwner,
): boolean {
  return owner !== null
    && owner.churchId !== undefined
    && owner.memberId !== undefined
    && owner.churchId === active.churchId
    && owner.memberId === active.memberId;
}

export function welfareMutationCompletionBelongsToIdentity(
  mounted: boolean,
  active: WelfareOwner,
  startedChurchId: string,
  startedMemberId: string,
): boolean {
  return mounted
    && active.churchId === startedChurchId
    && active.memberId === startedMemberId;
}

export type WelfareMutationKind = 'request' | 'emergency';

export function welfareUnknownOutcomeCopy(kind: WelfareMutationKind): {
  title: string;
  message: string;
} {
  return kind === 'emergency'
    ? {
      title: 'Alert status unknown',
      message: 'We could not confirm whether your urgent request reached the pastoral queue. Avoid sending it repeatedly. If you are in immediate danger, contact local emergency services now.',
    }
    : {
      title: 'Request status unknown',
      message: 'We could not confirm whether your request was recorded. Refresh your care history before submitting it again.',
    };
}

export function welfareMutationFailureAlert(
  kind: WelfareMutationKind,
  error: unknown,
): { outcomeUnknown: boolean; title: string; message: string } {
  if (isAmbiguousMutationFailure(error)) {
    return { outcomeUnknown: true, ...welfareUnknownOutcomeCopy(kind) };
  }
  return kind === 'emergency'
    ? {
      outcomeUnknown: false,
      title: 'Alert not sent',
      message: 'Contact local emergency services now if you are in immediate danger.',
    }
    : {
      outcomeUnknown: false,
      title: 'Request not sent',
      message: apiErrorMessage(error, 'Check your connection and try again.'),
    };
}
