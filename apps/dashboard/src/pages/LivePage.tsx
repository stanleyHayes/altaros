import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import {
  FiberManualRecord as LiveDotIcon,
  Videocam as VideoIcon,
} from '@mui/icons-material';
import liveService, {
  type LiveSession,
  type Recording,
  type RetentionPolicy,
} from '../services/live.service';
import planService, { type PlanState } from '../services/plan.service';

/**
 * Running a live service.
 *
 * Scheduling and going live happen here; the camera is on a phone. The two
 * things this page must never get wrong are the tier gate — a church shown a
 * Go Live button the server refuses learns nothing about why — and the
 * recording decision, which is a data protection choice and not a checkbox
 * about disk space.
 */

function statusChip(session: LiveSession) {
  if (session.status === 'live') {
    return (
      <Chip
        size="small"
        color="error"
        icon={<LiveDotIcon sx={{ fontSize: 12 }} />}
        label="LIVE"
      />
    );
  }
  if (session.status === 'ended') return <Chip size="small" label="Ended" />;
  return <Chip size="small" color="primary" variant="outlined" label="Scheduled" />;
}

function formatWhen(value?: string): string {
  return value ? new Date(value).toLocaleString() : '—';
}

function formatSize(bytes?: number): string {
  if (!bytes) return '—';
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

function ScheduleDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await liveService.schedule({
        title: title.trim(),
        description: description.trim() || undefined,
        kind: 'broadcast',
        recording,
      });
      setTitle('');
      setDescription('');
      setRecording(false);
      onCreated();
      onClose();
    } catch {
      setError('We could not schedule that service. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Schedule a service</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
            autoFocus
            required
          />
          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={2}
          />

          <Divider />

          <FormControlLabel
            control={
              <Switch checked={recording} onChange={(e) => setRecording(e.target.checked)} />
            }
            label="Record this service"
          />
          {/*
            Said plainly at the moment of the decision, not in a policy page.
            A recorded service captures the congregation, and under Act 843
            that is sensitive personal data because it reveals religious
            belief. The person ticking this box is the one who needs to know.
          */}
          <Alert severity={recording ? 'warning' : 'info'} variant="outlined">
            {recording
              ? 'Everyone who joins will be told the service is recorded, and how long ' +
                'the recording is kept, before they connect. Recordings are erased ' +
                'automatically when their retention runs out.'
              : 'Nothing will be recorded. Members are not asked to consent to anything.'}
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          onClick={() => void submit()}
          variant="contained"
          disabled={saving || !title.trim()}
        >
          {saving ? 'Scheduling…' : 'Schedule'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function LivePage() {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [retention, setRetention] = useState<RetentionPolicy | null>(null);
  const [plan, setPlan] = useState<PlanState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionList, recordingResult, planState] = await Promise.all([
        liveService.sessions(),
        liveService.recordings().catch(() => ({ recordings: [], retention: null })),
        planService.current().catch(() => null),
      ]);
      setSessions(sessionList);
      setRecordings(recordingResult.recordings);
      setRetention(recordingResult.retention);
      setPlan(planState);
    } catch {
      setError('We could not load your services. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (id: string, action: 'start' | 'end') => {
      setBusy(id);
      setError(null);
      try {
        if (action === 'start') await liveService.start(id);
        else await liveService.end(id);
        await load();
      } catch (e) {
        const status = (e as { response?: { status?: number } })?.response?.status;
        // 402 is the tier gate, and it is the one failure where the fix is a
        // decision rather than a retry. Saying "something went wrong" here
        // would leave a church pressing a button that will never work.
        setError(
          status === 402
            ? 'Your plan does not include live streaming. Upgrade to start broadcasting.'
            : status === 503
              ? 'Live streaming is not switched on for this server yet.'
              : 'We could not do that. Please try again.',
        );
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  const streaming = plan?.entitlement.streaming ?? false;
  const cap = plan?.entitlement.maxConcurrentViewers ?? 0;

  return (
    <Box>
      <Stack
        direction="row"
       
       
        sx={{ justifyContent: "space-between", alignItems: "center", mb: 3 }}
      >
        <Box>
          <Typography variant="h4">Live services</Typography>
          <Typography variant="body2" color="text.secondary">
            {streaming
              ? `Your plan allows up to ${cap.toLocaleString()} people watching at once.`
              : 'Your plan does not include live streaming.'}
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<VideoIcon />}
          onClick={() => setScheduling(true)}
        >
          Schedule a service
        </Button>
      </Stack>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      {/*
        The tier gate is stated BEFORE anyone presses anything. Scheduling is
        still allowed on any plan — a church planning next Sunday during the
        week should not be stopped — and the refusal comes at start, which is
        the moment it costs us bandwidth.
      */}
      {!streaming ? (
        <Alert severity="info" sx={{ mb: 3 }}>
          You can schedule services on any plan. Starting one needs a plan that
          includes streaming.
        </Alert>
      ) : null}

      {plan && plan.subscription.status === 'past_due' ? (
        <Alert severity="warning" sx={{ mb: 3 }}>
          Your subscription is past due. Streaming stays on for now, but it will
          be withdrawn if the invoice is not settled.
        </Alert>
      ) : null}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Services
          </Typography>
          {sessions.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No services yet. Schedule one to get started.
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Service</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Watching</TableCell>
                  <TableCell align="right">Peak</TableCell>
                  <TableCell>Recorded</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {session.title}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatWhen(session.startedAt ?? session.createdAt)}
                      </Typography>
                    </TableCell>
                    <TableCell>{statusChip(session)}</TableCell>
                    <TableCell align="right">
                      {session.status === 'live'
                        ? `${session.currentViewers} / ${session.maxViewers}`
                        : '—'}
                    </TableCell>
                    <TableCell align="right">{session.peakViewers || '—'}</TableCell>
                    <TableCell>
                      {session.recording ? (
                        <Chip size="small" color="warning" variant="outlined" label="Recording" />
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          No
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {session.status === 'scheduled' ? (
                        <Button
                          size="small"
                          variant="contained"
                          disabled={busy === session.id}
                          onClick={() => void act(session.id, 'start')}
                        >
                          Go live
                        </Button>
                      ) : session.status === 'live' ? (
                        <Button
                          size="small"
                          color="error"
                          variant="outlined"
                          disabled={busy === session.id}
                          onClick={() => void act(session.id, 'end')}
                        >
                          End
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6">Recordings</Typography>
          {retention ? (
            /*
              The retention rule is stated with the list rather than in a
              settings page, so it is visible at the moment somebody is looking
              at what exists — that is what turns automatic erasure from
              mysterious into expected.
            */
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Recordings are erased automatically after {retention.defaultDays} days.
              They cannot be kept longer than {Math.round(retention.maximumDays / 365)} years.
            </Typography>
          ) : null}

          {recordings.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No recordings yet.
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Service</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Size</TableCell>
                  <TableCell>Erased on</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {recordings.map((recording) => (
                  <TableRow key={recording.id}>
                    <TableCell>{recording.title}</TableCell>
                    <TableCell>
                      {/*
                        A deleted recording keeps its ROW. A church that
                        recorded four services and sees three has been told
                        something untrue about its own history.
                      */}
                      <Chip
                        size="small"
                        variant="outlined"
                        color={
                          recording.status === 'ready'
                            ? 'success'
                            : recording.status === 'failed'
                              ? 'error'
                              : 'default'
                        }
                        label={
                          recording.status === 'deleted'
                            ? `Erased ${recording.deletedAt ? new Date(recording.deletedAt).toLocaleDateString() : ''}`
                            : recording.status
                        }
                      />
                    </TableCell>
                    <TableCell align="right">{formatSize(recording.sizeBytes)}</TableCell>
                    <TableCell>
                      {recording.status === 'deleted'
                        ? '—'
                        : new Date(recording.deleteAfter).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ScheduleDialog
        open={scheduling}
        onClose={() => setScheduling(false)}
        onCreated={() => void load()}
      />
    </Box>
  );
}
