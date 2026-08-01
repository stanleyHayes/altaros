import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { NO_PERMISSIONS, PermissionSet } from './permission';

/**
 * How the host app fetches the caller's permissions.
 *
 * Injected rather than imported so this package stays free of any particular
 * HTTP client — dashboard, admin and web each have their own axios instance
 * with their own interceptors, and a second one here would authenticate
 * differently from the rest of the app.
 */
export type FetchPermissions = (signal: AbortSignal) => Promise<string[]>;

export interface PermissionsValue {
  /** The resolved set. Empty while loading and after a failure. */
  permissions: PermissionSet;
  /**
   * True until the first resolution settles.
   *
   * Callers must branch on this rather than treating an empty set as "denied",
   * or every screen flashes its unauthorised state for one frame on load.
   */
  isLoading: boolean;
  /**
   * Set when resolution failed. The set stays EMPTY in this case, so the UI
   * degrades to showing nothing rather than showing everything — the same call
   * the server's resolvePermissions middleware makes.
   */
  error: Error | null;
  /** Re-resolves. Called after anything that could change them. */
  refresh: () => void;
}

const PermissionsContext = createContext<PermissionsValue | undefined>(undefined);

export interface PermissionsProviderProps {
  children: ReactNode;
  fetchPermissions: FetchPermissions;
  /**
   * Whether there is a signed-in user to resolve permissions for.
   *
   * Without this the provider fires a request on the login screen, gets a 401,
   * and records an error for a state that is not an error.
   */
  enabled?: boolean;
}

export function PermissionsProvider({
  children,
  fetchPermissions,
  enabled = true,
}: PermissionsProviderProps) {
  const [permissions, setPermissions] = useState<PermissionSet>(NO_PERMISSIONS);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  // Identifies the resolution this effect owns. A refresh, a sign-out, or an
  // account switch can land while a request is in flight, and without this the
  // slow earlier response overwrites the newer one — the previous user's
  // permissions applied to the current session.
  const generation = useRef(0);

  useEffect(() => {
    if (!enabled) {
      // Signed out. Clear rather than keep the last set, so a shared machine
      // does not show the previous person's navigation to the next one.
      generation.current += 1;
      setPermissions(NO_PERMISSIONS);
      setIsLoading(false);
      setError(null);
      return;
    }

    generation.current += 1;
    const mine = generation.current;
    const controller = new AbortController();

    setIsLoading(true);
    fetchPermissions(controller.signal)
      .then((list) => {
        if (generation.current !== mine) return;
        setPermissions(new PermissionSet(list));
        setError(null);
      })
      .catch((cause: unknown) => {
        if (generation.current !== mine) return;
        if (controller.signal.aborted) return;
        // Fail closed. An unresolvable permission set means we cannot say what
        // this person may do, and the safe answer is "nothing" rather than
        // "carry on" — the server denies here too.
        setPermissions(NO_PERMISSIONS);
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      })
      .finally(() => {
        if (generation.current !== mine) return;
        setIsLoading(false);
      });

    return () => controller.abort();
  }, [enabled, fetchPermissions, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const value = useMemo<PermissionsValue>(
    () => ({ permissions, isLoading, error, refresh }),
    [permissions, isLoading, error, refresh],
  );

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

/**
 * Reads the caller's permissions.
 *
 * Throws outside a provider rather than returning an empty set: a silent empty
 * set renders a plausible-looking screen with everything hidden, which is
 * diagnosed as a permissions bug on the server instead of a missing provider.
 */
export function usePermissions(): PermissionsValue {
  const value = useContext(PermissionsContext);
  if (!value) {
    throw new Error('usePermissions must be used inside a <PermissionsProvider>.');
  }
  return value;
}

/** Whether the caller holds every listed permission. False while loading. */
export function useCan(...required: string[]): boolean {
  const { permissions, isLoading } = usePermissions();
  return !isLoading && permissions.hasAll(required);
}
