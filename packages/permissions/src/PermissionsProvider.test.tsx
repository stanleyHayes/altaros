import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Can } from './Can';
import { PermissionsProvider, usePermissions } from './PermissionsProvider';
import { RequirePermission } from './RequirePermission';

/** Renders whatever the provider resolved, for assertions. */
function Readout() {
  const { permissions, isLoading, error } = usePermissions();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="error">{error ? 'error' : 'none'}</span>
      <span data-testid="held">{permissions.list().join(',')}</span>
    </div>
  );
}

describe('PermissionsProvider', () => {
  it('resolves and expands what the server returned', async () => {
    render(
      <PermissionsProvider fetchPermissions={async () => ['finance:update']}>
        <Readout />
      </PermissionsProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('held')).toHaveTextContent('finance:read,finance:update');
  });

  // The property that matters most. The server's resolvePermissions denies on
  // a resolution failure rather than continuing; the client has to make the
  // same call, or a failed request renders every control on the screen.
  it('fails CLOSED when resolution fails', async () => {
    render(
      <PermissionsProvider
        fetchPermissions={async () => {
          throw new Error('gateway unreachable');
        }}
      >
        <Readout />
        <Can do="finance:delete">
          <button type="button">Delete</button>
        </Can>
      </PermissionsProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('error')).toHaveTextContent('error');
    expect(screen.getByTestId('held')).toHaveTextContent('');
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  // Signing out has to clear them. Keeping the last set means the next person
  // on a shared church office machine sees the previous person's navigation
  // before their own resolves.
  it('clears permissions when disabled', async () => {
    const { rerender } = render(
      <PermissionsProvider fetchPermissions={async () => ['finance:read']}>
        <Readout />
      </PermissionsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('held')).toHaveTextContent('finance:read'));

    rerender(
      <PermissionsProvider enabled={false} fetchPermissions={async () => ['finance:read']}>
        <Readout />
      </PermissionsProvider>,
    );
    expect(screen.getByTestId('held')).toHaveTextContent('');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  // A slow response for the previous session must not overwrite a newer one.
  // Without the generation guard this applies the signed-out user's
  // permissions to whoever signed in next.
  it('a stale in-flight response cannot overwrite a newer one', async () => {
    let releaseSlow: (value: string[]) => void = () => {};
    const slow = new Promise<string[]>((resolve) => {
      releaseSlow = resolve;
    });

    const fetchSlow = () => slow;
    const fetchFast = async () => ['member:read'];

    const { rerender } = render(
      <PermissionsProvider fetchPermissions={fetchSlow}>
        <Readout />
      </PermissionsProvider>,
    );

    rerender(
      <PermissionsProvider fetchPermissions={fetchFast}>
        <Readout />
      </PermissionsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('held')).toHaveTextContent('member:read'));

    // The first request now lands, carrying an administrator's permissions.
    releaseSlow(['finance:read', 'finance:delete', 'settings:update']);
    await Promise.resolve();

    await waitFor(() => expect(screen.getByTestId('held')).toHaveTextContent('member:read'));
  });

  it('does not resolve while signed out', () => {
    const fetchPermissions = vi.fn(async () => ['member:read']);
    render(
      <PermissionsProvider enabled={false} fetchPermissions={fetchPermissions}>
        <Readout />
      </PermissionsProvider>,
    );
    expect(fetchPermissions).not.toHaveBeenCalled();
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('throws outside a provider rather than silently denying everything', () => {
    // A silent empty set renders a plausible screen with everything hidden,
    // which gets diagnosed as a server permissions bug for an hour.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Readout />)).toThrow(/PermissionsProvider/);
    consoleError.mockRestore();
  });
});

describe('Can', () => {
  const withPermissions = (list: string[], children: React.ReactNode) =>
    render(
      <PermissionsProvider fetchPermissions={async () => list}>{children}</PermissionsProvider>,
    );

  // Requirement 7: the button is ABSENT, not disabled. A disabled button still
  // tells someone the action exists and that they are not trusted with it.
  it('renders nothing at all — not a disabled control', async () => {
    withPermissions(
      ['member:read'],
      <Can do="member:delete">
        <button type="button">Remove member</button>
      </Can>,
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove member' })).toBeNull());
    expect(document.body.textContent).not.toContain('Remove');
  });

  it('renders children when the permission is held', async () => {
    withPermissions(
      ['member:read', 'member:delete'],
      <Can do="member:delete">
        <button type="button">Remove member</button>
      </Can>,
    );
    await screen.findByRole('button', { name: 'Remove member' });
  });

  it('requires every permission in a list', async () => {
    withPermissions(
      ['member:update'],
      <Can do={['member:update', 'church:read']}>
        <button type="button">Move to department</button>
      </Can>,
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Move to department' })).toBeNull(),
    );
  });

  // A Delete that appears and then vanishes is worse than one that appears
  // late, because someone may have clicked it in between.
  it('shows nothing by default while permissions resolve', () => {
    render(
      <PermissionsProvider fetchPermissions={() => new Promise(() => {})}>
        <Can do="member:delete">
          <button type="button">Remove member</button>
        </Can>
      </PermissionsProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Remove member' })).toBeNull();
  });
});

describe('RequirePermission', () => {
  // 404, not 403 — matching the server. A 403 confirms the resource exists,
  // which is the difference between "you may not see this church's giving" and
  // "this church has giving you may not see".
  it('renders the not-found element for an unreadable route', async () => {
    render(
      <PermissionsProvider fetchPermissions={async () => ['member:read']}>
        <RequirePermission do="finance:read" notFound={<p>Page not found</p>}>
          <p>Church books</p>
        </RequirePermission>
      </PermissionsProvider>,
    );

    await screen.findByText('Page not found');
    expect(screen.queryByText('Church books')).toBeNull();
  });

  it('renders the page when the permission is held', async () => {
    render(
      <PermissionsProvider fetchPermissions={async () => ['finance:read']}>
        <RequirePermission do="finance:read" notFound={<p>Page not found</p>}>
          <p>Church books</p>
        </RequirePermission>
      </PermissionsProvider>,
    );

    await screen.findByText('Church books');
  });

  // Showing the not-found page for one frame before permissions arrive teaches
  // people the app is broken.
  it('shows the loading element rather than the not-found page while resolving', () => {
    render(
      <PermissionsProvider fetchPermissions={() => new Promise(() => {})}>
        <RequirePermission
          do="finance:read"
          notFound={<p>Page not found</p>}
          loading={<p>Loading the books</p>}
        >
          <p>Church books</p>
        </RequirePermission>
      </PermissionsProvider>,
    );

    expect(screen.getByText('Loading the books')).toBeTruthy();
    expect(screen.queryByText('Page not found')).toBeNull();
  });
});
