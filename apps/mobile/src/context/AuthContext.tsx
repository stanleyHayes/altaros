import React, { createContext, useEffect, useState, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import authService, {
  User,
  LoginRequest,
  RegisterRequest,
  OtpRequest,
} from '../services/auth.service';
import { session } from '../services/session';
import { isTerminalMemberSessionError } from '../services/api-error';
import {
  canCommitSessionResult,
  canRevealCachedMember,
  shouldRecoverPendingIdentity,
} from '../services/session-recovery';

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginRequest, canCommit?: () => boolean) => Promise<void>;
  register: (details: RegisterRequest) => Promise<string>;
  verifyOtp: (otpData: OtpRequest, canCommit?: () => boolean) => Promise<void>;
  logout: () => Promise<void>;
  logoutEverywhere: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const userRef = useRef<User | null>(null);
  const mountedRef = useRef(true);
  const reconciliationRef = useRef<Promise<void> | null>(null);
  const sessionPresentRef = useRef(false);
  const sessionRevisionRef = useRef(0);
  const authAttemptRevisionRef = useRef(0);

  const commitUser = useCallback((nextUser: User | null) => {
    userRef.current = nextUser;
    if (mountedRef.current) setUser(nextUser);
  }, []);

  const reconcileSession = useCallback(async () => {
    if (reconciliationRef.current) return reconciliationRef.current;
    const startedRevision = sessionRevisionRef.current;

    const reconciliation = (async () => {
      try {
        const expectedUser = userRef.current;
        const expectedRefreshToken = await session.getRefreshToken();
        const currentUser = await authService.getCurrentUser(expectedUser ?? undefined);
        if (canCommitSessionResult(
          startedRevision,
          sessionRevisionRef.current,
          sessionPresentRef.current,
        )) {
          if (expectedRefreshToken) {
            await session.replaceUserIfRefreshTokenCurrent(
              expectedRefreshToken,
              currentUser,
              () => canCommitSessionResult(
                startedRevision,
                sessionRevisionRef.current,
                sessionPresentRef.current,
              ),
            ).catch(() => false);
          }
          if (canCommitSessionResult(
            startedRevision,
            sessionRevisionRef.current,
            sessionPresentRef.current,
          )) {
            commitUser(currentUser);
          }
        }
      } catch (error) {
        // Cached identity remains useful through connectivity and service
        // outages. Only the gateway can authoritatively end it.
        if (isTerminalMemberSessionError(error) && canCommitSessionResult(
          startedRevision,
          sessionRevisionRef.current,
          sessionPresentRef.current,
        )) {
          sessionRevisionRef.current += 1;
          sessionPresentRef.current = false;
          await session.clear().catch(() => undefined);
          commitUser(null);
        }
      }
    })();
    reconciliationRef.current = reconciliation;
    try {
      await reconciliation;
    } finally {
      if (reconciliationRef.current === reconciliation) reconciliationRef.current = null;
    }
  }, [commitUser]);

  useEffect(() => {
    mountedRef.current = true;
    const loadStoredUser = async () => {
      try {
        const token = await session.getAccessToken();
        sessionPresentRef.current = Boolean(token);
        if (token) {
          const storedUser = await authService.getStoredUser();
          if (storedUser) {
            commitUser(storedUser);
          }
          if (canRevealCachedMember(Boolean(token), Boolean(storedUser))) {
            // The session vault commits tokens and profile atomically. Reveal
            // that validated cache after the branded splash instead of adding
            // up to the full network timeout, while authoritative rejection
            // can still tear it down through the guarded reconciliation path.
            if (mountedRef.current) setIsLoading(false);
            void reconcileSession();
            return;
          }
          // A token with no cached identity cannot safely choose a navigator.
          // Keep the launch gate closed until the gateway restores the member
          // or definitively rejects the session.
          await reconcileSession();
        }
      } catch {
        sessionPresentRef.current = false;
        await session.clear().catch(() => undefined);
        commitUser(null);
      } finally {
        if (mountedRef.current) setIsLoading(false);
      }
    };

    void loadStoredUser();
    const removeExpiryListener = session.onExpired(() => {
      authAttemptRevisionRef.current += 1;
      sessionRevisionRef.current += 1;
      sessionPresentRef.current = false;
      commitUser(null);
    });
    let previousState = AppState.currentState;
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      const returningToForeground = /inactive|background/.test(previousState) && nextState === 'active';
      previousState = nextState;
      if (returningToForeground && sessionPresentRef.current) void reconcileSession();
    });
    const connectivitySubscription = NetInfo.addEventListener((state) => {
      if (shouldRecoverPendingIdentity(
        sessionPresentRef.current,
        Boolean(userRef.current),
        state,
      )) {
        void reconcileSession();
      }
    });

    return () => {
      mountedRef.current = false;
      removeExpiryListener();
      appStateSubscription.remove();
      connectivitySubscription();
    };
  }, [commitUser, reconcileSession]);

  const login = useCallback(async (credentials: LoginRequest, screenCanCommit: () => boolean = () => true) => {
    const attempt = ++authAttemptRevisionRef.current;
    const response = await authService.login(
      credentials,
      () => attempt === authAttemptRevisionRef.current && mountedRef.current && screenCanCommit(),
    );
    if (attempt !== authAttemptRevisionRef.current || !mountedRef.current || !screenCanCommit()) {
      throw new Error('The sign-in attempt is no longer active.');
    }
    sessionRevisionRef.current += 1;
    sessionPresentRef.current = true;
    commitUser(response.user);
  }, [commitUser]);

  const register = useCallback(async (details: RegisterRequest) => {
    const response = await authService.register(details);
    return response.user.phone || details.phone;
  }, []);

  const verifyOtp = useCallback(async (otpData: OtpRequest, screenCanCommit: () => boolean = () => true) => {
    const attempt = ++authAttemptRevisionRef.current;
    const response = await authService.verifyOtp(
      otpData,
      () => attempt === authAttemptRevisionRef.current && mountedRef.current && screenCanCommit(),
    );
    if (attempt !== authAttemptRevisionRef.current || !mountedRef.current || !screenCanCommit()) {
      throw new Error('The verification attempt is no longer active.');
    }
    sessionRevisionRef.current += 1;
    sessionPresentRef.current = true;
    commitUser(response.user);
  }, [commitUser]);

  const logout = useCallback(async () => {
    // Remove the authenticated tree synchronously; remote revocation and local
    // secure-store cleanup continue without keeping private screens visible.
    authAttemptRevisionRef.current += 1;
    sessionRevisionRef.current += 1;
    sessionPresentRef.current = false;
    commitUser(null);
    await authService.logout();
  }, [commitUser]);

  const logoutEverywhere = useCallback(async () => {
    authAttemptRevisionRef.current += 1;
    const startedRevision = sessionRevisionRef.current;
    const endedCurrentSession = await authService.logoutEverywhere();
    if (!endedCurrentSession || startedRevision !== sessionRevisionRef.current) {
      throw new Error('The active session changed while global logout was being confirmed.');
    }
    sessionRevisionRef.current += 1;
    sessionPresentRef.current = false;
    commitUser(null);
  }, [commitUser]);

  const refreshUser = useCallback(async () => {
    const startedRevision = sessionRevisionRef.current;
    const expectedUser = userRef.current;
    if (!expectedUser) throw new Error('The member session is no longer active.');
    const expectedRefreshToken = await session.getRefreshToken();
    const freshUser = await authService.getCurrentUser(expectedUser);
    if (canCommitSessionResult(
      startedRevision,
      sessionRevisionRef.current,
      sessionPresentRef.current,
    )) {
      if (expectedRefreshToken) {
        await session.replaceUserIfRefreshTokenCurrent(
          expectedRefreshToken,
          freshUser,
          () => canCommitSessionResult(
            startedRevision,
            sessionRevisionRef.current,
            sessionPresentRef.current,
          ),
        ).catch(() => false);
      }
      if (canCommitSessionResult(
        startedRevision,
        sessionRevisionRef.current,
        sessionPresentRef.current,
      )) {
        commitUser(freshUser);
      }
    }
  }, [commitUser]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        register,
        verifyOtp,
        logout,
        logoutEverywhere,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
