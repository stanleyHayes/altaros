export interface SpiritualScreenOwner {
  churchId?: string;
  memberId?: string;
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
