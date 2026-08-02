export interface HomeContentOwner {
  churchId?: string;
  memberId?: string;
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
