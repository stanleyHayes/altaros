export interface CommunityFeedOwner {
  churchId?: string;
  memberId?: string;
}

export function communityPartialRecoveryAction(
  offline: boolean,
  surface: 'feed' | 'comments',
): { label: string; hint: string; disabled: boolean } {
  if (offline) {
    return {
      label: 'Reconnect to refresh',
      hint: surface === 'feed'
        ? 'Reconnect to refresh the community feed.'
        : 'Reconnect to refresh this comment thread.',
      disabled: true,
    };
  }
  return surface === 'feed'
    ? {
      label: 'Refresh community',
      hint: 'Refreshes community posts and reaction status from the newest page.',
      disabled: false,
    }
    : {
      label: 'Refresh thread',
      hint: 'Refreshes comments and mutation status from the first page.',
      disabled: false,
    };
}

export function communityFeedBelongsToIdentity(
  owner: CommunityFeedOwner | null,
  active: CommunityFeedOwner,
): boolean {
  return owner !== null
    && owner.churchId !== undefined
    && owner.memberId !== undefined
    && owner.churchId === active.churchId
    && owner.memberId === active.memberId;
}

export function nextCommunityPage(
  loadedPage: number,
  visibleCount: number,
  total: number,
  unavailable: boolean,
): number | null {
  if (unavailable || !Number.isSafeInteger(loadedPage) || loadedPage < 1
    || !Number.isSafeInteger(visibleCount) || visibleCount < 0
    || !Number.isSafeInteger(total) || total < 0 || visibleCount >= total) return null;
  return loadedPage + 1;
}
