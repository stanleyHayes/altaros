import type { ReactNode } from 'react';
import { RequirePermission } from '@altar-os/permissions';
import NotFoundPage from '@/pages/NotFoundPage';
import PageSkeleton from '@/components/ui/PageSkeleton';
import { requirementFor } from '@/navigation';

/**
 * Wraps a route element in the permission its path declares.
 *
 * The requirement is looked up from the shared NAV_ITEMS list rather than
 * passed in, which is what stops the sidebar and the router disagreeing. Adding
 * a page means adding one entry, and both halves of requirement 7 — the item
 * does not appear, the route does not render — follow from it.
 *
 * The fallback is the NOT-FOUND page, never a "forbidden" page, matching what
 * the gateway does. A 403 confirms the resource exists, and "this church has
 * giving you may not see" is a disclosure that "no such page" is not.
 */
export default function Guarded({ path, children }: { path: string; children: ReactNode }) {
  const requires = requirementFor(path);
  if (!requires?.length) return <>{children}</>;

  return (
    <RequirePermission do={requires} notFound={<NotFoundPage />} loading={<PageSkeleton />}>
      {children}
    </RequirePermission>
  );
}
