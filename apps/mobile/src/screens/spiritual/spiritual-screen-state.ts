export interface SpiritualScreenOwner {
  churchId?: string;
  memberId?: string;
}

export function spiritualPartialRecoveryAction(offline: boolean): {
  label: string;
  hint: string;
  disabled: boolean;
} {
  return offline
    ? {
      label: 'Reconnect to refresh',
      hint: 'Reconnect to refresh the sermon library before continuing.',
      disabled: true,
    }
    : {
      label: 'Refresh to continue',
      hint: 'Refreshes the sermon library from its newest page.',
      disabled: false,
    };
}

export function spiritualContentBelongsToIdentity(
  owner: SpiritualScreenOwner | null,
  active: SpiritualScreenOwner,
): boolean {
  return owner !== null
    && owner.churchId !== undefined
    && owner.memberId !== undefined
    && owner.churchId === active.churchId
    && owner.memberId === active.memberId;
}
