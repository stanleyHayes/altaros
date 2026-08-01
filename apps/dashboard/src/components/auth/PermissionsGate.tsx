import type { ReactNode } from 'react';
import { PermissionsProvider } from '@altar-os/permissions';
import { useAuth } from '@/hooks/useAuth';
import { fetchMyPermissions } from '@/services/permission.service';

/**
 * Connects the shared permissions provider to this app's auth and API client.
 *
 * `enabled` is tied to the session so the provider does not fire a request on
 * the login screen — a 401 there is the expected state, not an error, and
 * recording it as one puts a permanent failure on the context for the rest of
 * the session.
 *
 * It also means signing out CLEARS the permissions rather than leaving the last
 * set in memory, which matters on the shared machine in a church office where
 * the next person to sign in would otherwise see the previous person's
 * navigation until their own resolved.
 */
export default function PermissionsGate({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();

  return (
    <PermissionsProvider enabled={isAuthenticated} fetchPermissions={fetchMyPermissions}>
      {children}
    </PermissionsProvider>
  );
}
