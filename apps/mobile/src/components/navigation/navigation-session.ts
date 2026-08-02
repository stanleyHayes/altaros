export type NavigationIdentity = {
  churchId?: string | null;
  memberId?: string | null;
};

function encodeKeyPart(value: string): string {
  return `${value.length}:${value}`;
}

/**
 * A navigator owns private route history just as screens own private data.
 * Changing either tenant or member must create a fresh root navigation tree.
 */
export function navigationSessionKey(
  isAuthenticated: boolean,
  identity: NavigationIdentity,
): string {
  if (!isAuthenticated) return 'auth-navigation';
  if (!identity.churchId || !identity.memberId) return 'member-navigation-incomplete';
  return `member-navigation:${encodeKeyPart(identity.churchId)}:${encodeKeyPart(identity.memberId)}`;
}
