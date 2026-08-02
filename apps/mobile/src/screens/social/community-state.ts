export interface CommunityFeedOwner {
  churchId?: string;
  memberId?: string;
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
