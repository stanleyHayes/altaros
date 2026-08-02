import type { NetInfoState } from '@react-native-community/netinfo';
import { isKnownOffline } from './connectivity';

/**
 * An atomically stored token/profile pair is sufficient to restore the member
 * shell while the gateway reconciles in the background. A token without a
 * validated cached identity must keep the launch gate closed to avoid briefly
 * presenting the signed-out navigator before recovery completes.
 */
export function canRevealCachedMember(
  hasSession: boolean,
  hasCachedUser: boolean,
): boolean {
  return hasSession && hasCachedUser;
}

/**
 * A token pair can outlive a missing profile cache. Retry only when a session
 * still exists, no validated member is mounted, and connectivity is not known
 * to be offline. Unknown reachability remains permissive like the API layer.
 */
export function shouldRecoverPendingIdentity(
  hasSession: boolean,
  hasUser: boolean,
  state: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>,
): boolean {
  return hasSession && !hasUser && !isKnownOffline(state);
}

/**
 * Network identity lookups may finish after logout, token expiry, or a newer
 * login. Only the session revision that started a lookup may commit it, and a
 * local session must still exist. This prevents stale profile responses from
 * remounting the authenticated navigator after credentials were cleared.
 */
export function canCommitSessionResult(
  startedRevision: number,
  currentRevision: number,
  hasSession: boolean,
): boolean {
  return Number.isSafeInteger(startedRevision)
    && Number.isSafeInteger(currentRevision)
    && startedRevision >= 0
    && currentRevision >= 0
    && startedRevision === currentRevision
    && hasSession;
}
