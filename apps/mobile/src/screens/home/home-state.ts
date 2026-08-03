export interface HomeContentOwner {
  churchId?: string;
  memberId?: string;
}

export function homeSectionRecoveryAction(
  offline: boolean,
  refreshing: boolean,
): { label: string; hint: string; disabled: boolean; busy: boolean } {
  if (offline) {
    return {
      label: 'Reconnect to retry',
      hint: 'Reconnect to refresh this section of your member home.',
      disabled: true,
      busy: false,
    };
  }
  if (refreshing) {
    return {
      label: 'Refreshing…',
      hint: 'Your member home is being refreshed.',
      disabled: true,
      busy: true,
    };
  }
  return {
    label: 'Try again',
    hint: 'Refreshes events, today’s devotional, and recent sermons.',
    disabled: false,
    busy: false,
  };
}

export function homeContentBelongsToIdentity(
  owner: HomeContentOwner | null,
  active: HomeContentOwner,
): boolean {
  return owner !== null
    && owner.churchId !== undefined
    && owner.memberId !== undefined
    && owner.churchId === active.churchId
    && owner.memberId === active.memberId;
}
