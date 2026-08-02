import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

export class KnownOfflineError extends Error {
  readonly code = 'KNOWN_OFFLINE';

  constructor() {
    super('You are offline. Reconnect and try again.');
    this.name = 'KnownOfflineError';
  }
}

export function connectivityErrorMessage(error: unknown, fallback: string): string {
  return error instanceof KnownOfflineError ? error.message : fallback;
}

export function isKnownOffline(
  state: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>,
): boolean {
  return state.isConnected === false || state.isInternetReachable === false;
}

/** Unknown reachability is allowed; only a definitive offline signal blocks. */
export async function ensureConnectionAvailable(): Promise<void> {
  let state: NetInfoState;
  try {
    state = await NetInfo.fetch();
  } catch {
    // A reachability lookup failure is not evidence that the internet is down.
    return;
  }
  if (isKnownOffline(state)) throw new KnownOfflineError();
}
