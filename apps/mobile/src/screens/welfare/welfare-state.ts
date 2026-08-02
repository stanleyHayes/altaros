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
