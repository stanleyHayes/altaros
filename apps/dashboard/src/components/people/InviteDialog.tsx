import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Skeleton,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { ContentCopy as CopyIcon, Info as InfoIcon } from '@mui/icons-material';
import { useSnackbar } from 'notistack';
import {
  fetchAssignableRoles,
  type AssignableRole,
} from '@/services/permission.service';
import { createUser, invite, type InviteResult } from '@/services/invitation.service';

interface InviteDialogProps {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  /** Whether the caller may create an account outright, not just invite one. */
  canCreateDirectly: boolean;
}

/**
 * Adding someone to the church — requirement 9's two paths, side by side.
 *
 * They are tabs rather than one form with a checkbox because they are genuinely
 * different decisions with different consequences: an invitation lets the person
 * choose their own password and never puts one in an admin's hands, while
 * direct creation is for someone with no reliable email or SMS and leaves the
 * admin knowing a working credential until it is changed.
 */
export default function InviteDialog({
  open,
  onClose,
  onDone,
  canCreateDirectly,
}: InviteDialogProps) {
  const { enqueueSnackbar } = useSnackbar();

  const [tab, setTab] = useState<'invite' | 'create'>('invite');
  const [roles, setRoles] = useState<AssignableRole[] | null>(null);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<InviteResult | null>(null);

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    roleId: '',
    message: '',
    password: '',
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    setRoles(null);
    setRolesError(null);
    fetchAssignableRoles()
      .then((response) => {
        if (cancelled) return;
        setRoles(response.roles);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setRolesError(cause instanceof Error ? cause.message : 'Could not load roles.');
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  // Requirement 7 applied to a dropdown: only roles that will actually be
  // accepted are offered. The escalation rule is a strict subset, so listing
  // every role means listing options that 403 on submit.
  const assignable = useMemo(() => roles?.filter((r) => r.assignable) ?? [], [roles]);

  // The ones held back, and why. Without this the picker silently having two of
  // six roles reads as a bug — which is R-17, and the reason the endpoint
  // reports the missing permissions rather than just filtering server-side.
  // Their names are not a new disclosure: reaching this page needs role:read.
  const withheld = useMemo(() => roles?.filter((r) => !r.assignable) ?? [], [roles]);

  const reset = () => {
    setForm({ name: '', email: '', phone: '', roleId: '', message: '', password: '' });
    setResult(null);
    setSubmitting(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      if (tab === 'invite') {
        const response = await invite({
          name: form.name.trim() || undefined,
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          roleId: form.roleId,
          message: form.message.trim() || undefined,
        });
        // Held on screen rather than closed immediately: the link is the
        // fallback when delivery fails, and it exists nowhere else.
        setResult(response);
        onDone();
      } else {
        const response = await createUser({
          name: form.name.trim(),
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          roleId: form.roleId,
          password: form.password,
        });
        enqueueSnackbar(response.note, { variant: 'success' });
        onDone();
        handleClose();
      }
    } catch (cause: unknown) {
      enqueueSnackbar(
        cause instanceof Error ? cause.message : 'That did not work. Please try again.',
        { variant: 'error' },
      );
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.link);
    enqueueSnackbar('Link copied. It works once and expires in 7 days.', {
      variant: 'success',
    });
  };

  const hasContact = form.email.trim() !== '' || form.phone.trim() !== '';
  const canSubmit =
    !submitting &&
    form.roleId !== '' &&
    hasContact &&
    (tab === 'invite' || (form.name.trim().length >= 2 && form.password.length >= 8));

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        {result ? 'Invitation created' : 'Add someone to your church'}
      </DialogTitle>

      <DialogContent>
        {result ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Alert severity={result.deliveryError ? 'warning' : 'success'}>
              <AlertTitle>
                {result.deliveryError
                  ? 'Created, but not delivered'
                  : `Sent to ${result.invitation.email ?? result.invitation.phone}`}
              </AlertTitle>
              {result.deliveryError ??
                'They can set their own password from the link. It works once and expires in 7 days.'}
            </Alert>

            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
                Share this link if you need to
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <TextField
                  value={result.link}
                  fullWidth
                  size="small"
                  slotProps={{ input: { readOnly: true } }}
                  sx={{ '& input': { fontFamily: 'monospace', fontSize: '0.8125rem' } }}
                />
                <Tooltip title="Copy link">
                  <IconButton onClick={copyLink} sx={{ mt: 0.25 }}>
                    <CopyIcon />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {canCreateDirectly && (
              <Tabs
                value={tab}
                onChange={(_, next) => setTab(next as 'invite' | 'create')}
                sx={{ mb: 1 }}
              >
                <Tab value="invite" label="Send an invitation" />
                <Tab value="create" label="Create the account" />
              </Tabs>
            )}

            <Typography variant="body2" color="text.secondary">
              {tab === 'invite'
                ? 'They choose their own password from a link that works once.'
                : 'You set the password. They will be asked to change it the first time they sign in.'}
            </Typography>

            <TextField
              label="Full name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required={tab === 'create'}
              fullWidth
              size="small"
            />

            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <TextField
                label="Email address"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                fullWidth
                size="small"
                sx={{ flex: '1 1 220px' }}
              />
              <TextField
                label="Phone number"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="024 555 0101"
                fullWidth
                size="small"
                sx={{ flex: '1 1 180px' }}
                helperText={hasContact ? ' ' : 'An email address or a phone number is required'}
              />
            </Box>

            {roles === null && !rolesError ? (
              <Skeleton variant="rounded" height={40} />
            ) : (
              <TextField
                select
                label="Role"
                value={form.roleId}
                onChange={(e) => setForm({ ...form, roleId: e.target.value })}
                required
                fullWidth
                size="small"
                helperText="They get this role's permissions as soon as they join."
              >
                {assignable.map((role) => (
                  <MenuItem key={role.id} value={role.id}>
                    {role.name}
                    {role.description ? ` — ${role.description}` : ''}
                  </MenuItem>
                ))}
              </TextField>
            )}

            {rolesError && <Alert severity="error">{rolesError}</Alert>}

            {withheld.length > 0 && (
              <Alert severity="info" icon={<InfoIcon />}>
                <AlertTitle sx={{ fontSize: '0.875rem' }}>
                  Some roles are not available to you
                </AlertTitle>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  You can only give someone a role whose permissions you hold yourself.
                </Typography>
                {withheld.map((role) => (
                  <Typography key={role.id} variant="caption" component="div" sx={{ mb: 0.25 }}>
                    <strong>{role.name}</strong> needs{' '}
                    {role.missingPermissions?.slice(0, 4).join(', ')}
                    {(role.missingPermissions?.length ?? 0) > 4 &&
                      ` and ${(role.missingPermissions?.length ?? 0) - 4} more`}
                  </Typography>
                ))}
              </Alert>
            )}

            {tab === 'invite' ? (
              <TextField
                label="Add a note (optional)"
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                multiline
                minRows={2}
                fullWidth
                size="small"
                helperText="Shown on the page where they accept. A message from a person they recognise is what stops this reading as phishing."
              />
            ) : (
              <TextField
                label="Password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                fullWidth
                size="small"
                helperText="At least 8 characters. They will be asked to change it at first sign-in."
              />
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        {result ? (
          <Button onClick={handleClose} variant="contained">
            Done
          </Button>
        ) : (
          <>
            <Button onClick={handleClose} color="inherit">
              Cancel
            </Button>
            <Button onClick={submit} variant="contained" disabled={!canSubmit}>
              {tab === 'invite' ? 'Send invitation' : 'Create account'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
