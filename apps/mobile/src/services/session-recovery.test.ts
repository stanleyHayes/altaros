import {
  canCommitSessionResult,
  canRevealCachedMember,
  shouldRecoverPendingIdentity,
} from './session-recovery';

describe('cached member startup reveal', () => {
  it('reveals only an atomic session and validated cached member pair', () => {
    expect(canRevealCachedMember(true, true)).toBe(true);
    expect(canRevealCachedMember(true, false)).toBe(false);
    expect(canRevealCachedMember(false, true)).toBe(false);
    expect(canRevealCachedMember(false, false)).toBe(false);
  });
});

describe('session result revision guard', () => {
  it('allows the current authenticated reconciliation to commit', () => {
    expect(canCommitSessionResult(3, 3, true)).toBe(true);
  });

  it.each([
    [3, 4, true],
    [4, 3, true],
    [3, 3, false],
    [-1, -1, true],
    [1.5, 1.5, true],
  ] as const)('rejects stale or sessionless result revision=%s current=%s session=%s', (
    startedRevision, currentRevision, hasSession,
  ) => {
    expect(canCommitSessionResult(startedRevision, currentRevision, hasSession)).toBe(false);
  });
});

describe('pending session identity recovery', () => {
  it('retries a token-backed identity when connectivity returns', () => {
    expect(shouldRecoverPendingIdentity(true, false, {
      isConnected: true,
      isInternetReachable: true,
    })).toBe(true);
  });

  it('allows unknown reachability because it is not proof of offline state', () => {
    expect(shouldRecoverPendingIdentity(true, false, {
      isConnected: true,
      isInternetReachable: null,
    })).toBe(true);
  });

  it.each([
    [false, false, true, true],
    [true, true, true, true],
    [true, false, false, null],
    [true, false, true, false],
  ] as const)('does not retry when session=%s user=%s connected=%s reachable=%s', (
    hasSession, hasUser, isConnected, isInternetReachable,
  ) => {
    expect(shouldRecoverPendingIdentity(hasSession, hasUser, {
      isConnected,
      isInternetReachable,
    })).toBe(false);
  });
});
