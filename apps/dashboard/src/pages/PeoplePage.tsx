import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Skeleton,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  PersonAdd as PersonAddIcon,
  Refresh as ResendIcon,
  Close as RevokeIcon,
} from '@mui/icons-material';
import { useSnackbar } from 'notistack';
import { Can, Cannot, useCan } from '@altar-os/permissions';
import DataTable, { type Column } from '@/components/ui/DataTable';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import InviteDialog from '@/components/people/InviteDialog';
import {
  listInvitations,
  resendInvitation,
  revokeInvitation,
  type Invitation,
} from '@/services/invitation.service';

interface InvitationRow extends Invitation {
  [key: string]: unknown;
}

/**
 * Who is in this church, and who has been asked to join.
 *
 * Every control here is gated on a permission and the route itself requires
 * `user:read`, so someone without it never reaches the page — they get the
 * not-found screen, not a "forbidden" one.
 */
export default function PeoplePage() {
  const { enqueueSnackbar } = useSnackbar();
  const canInvite = useCan('user:create');

  const [rows, setRows] = useState<InvitationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [revoking, setRevoking] = useState<Invitation | null>(null);

  const load = useCallback(async () => {
    try {
      const invitations = await listInvitations();
      setRows(invitations as InvitationRow[]);
      setError(null);
    } catch (cause: unknown) {
      setRows([]);
      setError(cause instanceof Error ? cause.message : 'Could not load invitations.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleResend = async (invitation: Invitation) => {
    try {
      await resendInvitation(invitation.id);
      // Said plainly, because "resent" alone would let someone believe the
      // first link still works — it does not, and that is the point of resend.
      enqueueSnackbar('A new link was sent. The previous one no longer works.', {
        variant: 'success',
      });
      await load();
    } catch (cause: unknown) {
      enqueueSnackbar(cause instanceof Error ? cause.message : 'Could not resend.', {
        variant: 'error',
      });
    }
  };

  const handleRevoke = async () => {
    if (!revoking) return;
    try {
      await revokeInvitation(revoking.id);
      enqueueSnackbar('Invitation cancelled. The link no longer works.', {
        variant: 'success',
      });
      setRevoking(null);
      await load();
    } catch (cause: unknown) {
      enqueueSnackbar(cause instanceof Error ? cause.message : 'Could not cancel.', {
        variant: 'error',
      });
    }
  };

  const statusChip = (row: Invitation) => {
    if (row.status === 'accepted') return <Chip size="small" color="success" label="Joined" />;
    if (row.status === 'revoked') return <Chip size="small" label="Cancelled" />;
    if (row.expired) return <Chip size="small" color="warning" label="Expired" />;
    return <Chip size="small" color="info" label="Waiting" />;
  };

  const columns: Column<InvitationRow>[] = [
    {
      id: 'name',
      label: 'Person',
      minWidth: 200,
      sortable: true,
      render: (row) => (
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {row.name || '—'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {row.email ?? row.phone}
          </Typography>
        </Box>
      ),
    },
    { id: 'roleName', label: 'Role', minWidth: 130, sortable: true },
    { id: 'status', label: 'Status', minWidth: 110, render: statusChip },
    {
      id: 'invitedAt',
      label: 'Invited',
      minWidth: 120,
      sortable: true,
      render: (row) => new Date(row.invitedAt).toLocaleDateString(),
    },
    {
      id: 'actions',
      label: '',
      align: 'right',
      minWidth: 100,
      render: (row) => {
        // Nothing to do with an invitation that has been accepted or cancelled,
        // and rendering disabled buttons for them would be clutter that says
        // nothing.
        if (row.status !== 'pending') return null;

        return (
          // Absent, not disabled: someone without user:create sees no controls
          // in this column at all rather than greyed-out ones telling them
          // there is something here they are not trusted with.
          <Can do="user:create">
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
              <Tooltip title="Send a new link (the old one stops working)">
                <IconButton size="small" onClick={() => void handleResend(row)}>
                  <ResendIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Cancel this invitation">
                <IconButton size="small" onClick={() => setRevoking(row)}>
                  <RevokeIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          </Can>
        );
      },
    },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          justifyContent: 'space-between',
          alignItems: { xs: 'flex-start', sm: 'center' },
          gap: 2,
        }}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            People &amp; Roles
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Invite staff and members, and choose what each of them can do.
          </Typography>
        </Box>

        <Can do="user:create">
          <Button
            variant="contained"
            startIcon={<PersonAddIcon />}
            onClick={() => setInviteOpen(true)}
          >
            Add someone
          </Button>
        </Can>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}

      {rows === null ? (
        // Skeleton rows rather than a spinner — the table's shape is known
        // before its contents are.
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <Skeleton variant="rounded" height={56} sx={{ borderRadius: 3 }} />
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton
              key={`invite-skeleton-${i}`}
              variant="rounded"
              height={52}
              sx={{ borderRadius: 2.5, opacity: 1 - i * 0.13 }}
            />
          ))}
        </Box>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          title="Invitations"
          searchable
          searchPlaceholder="Search by name or address"
        />
      )}

      {/* An empty state that only makes sense to someone who cannot fix it.
          Telling an admin to ask an administrator would be noise. */}
      {rows?.length === 0 && (
        <Cannot do="user:create">
          <Alert severity="info">
            Nobody has been invited yet. Ask an administrator to add people to your church.
          </Alert>
        </Cannot>
      )}

      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onDone={() => void load()}
        canCreateDirectly={canInvite}
      />

      <ConfirmDialog
        open={revoking !== null}
        title="Cancel this invitation?"
        message={`The link sent to ${revoking?.email ?? revoking?.phone ?? 'them'} will stop working immediately. You can invite them again afterwards.`}
        confirmLabel="Cancel invitation"
        confirmColor="error"
        onConfirm={() => void handleRevoke()}
        onCancel={() => setRevoking(null)}
      />
    </Box>
  );
}
