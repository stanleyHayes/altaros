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
  FormControl,
  FormControlLabel,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { Campaign as CampaignIcon } from '@mui/icons-material';
import campaignService, {
  visibilityLabel,
  visibilityMeaning,
  type Campaign,
  type Visibility,
} from '../services/campaign.service';

/**
 * Fundraising appeals, and who gets shown them.
 *
 * The publishing dialog is the whole point of this page. It asks three separate
 * questions that a single "publish" button would silently answer for a church:
 * who may see this, may the raised figure be shown, and may this appear on
 * ALTAR OS's own marketing site beside other churches. They are different
 * decisions and the last one is not ours to assume.
 */

function money(minor: number, currency: string): string {
  return `${currency} ${(minor / 100).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  })}`;
}

function visibilityColor(visibility: Visibility | ''): 'default' | 'info' | 'success' {
  if (visibility === 'public') return 'success';
  if (visibility === 'members') return 'info';
  return 'default';
}

function PublishDialog({
  campaign,
  onClose,
  onPublished,
}: {
  campaign: Campaign | null;
  onClose: () => void;
  onPublished: () => void;
}) {
  const [visibility, setVisibility] = useState<Visibility>('members');
  const [showProgress, setShowProgress] = useState(false);
  const [listed, setListed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!campaign) return;
    // Seeded from what is stored, so re-opening the dialog shows the current
    // state rather than defaults that would silently change it on save.
    setVisibility(campaign.visibility === '' ? 'members' : campaign.visibility);
    setShowProgress(campaign.showProgress);
    setListed(campaign.listedInDirectory);
  }, [campaign]);

  const submit = async () => {
    if (!campaign) return;
    setSaving(true);
    setError(null);
    try {
      await campaignService.publish(campaign.id, {
        visibility,
        showProgress,
        // An appeal only members can see cannot be on a public marketing
        // site. Enforced here as well as on the server so the two answers a
        // church gives can never contradict each other on screen.
        listedInDirectory: visibility === 'public' ? listed : false,
      });
      onPublished();
      onClose();
    } catch {
      setError('We could not publish that appeal. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={campaign !== null} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Publish “{campaign?.title}”</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}

          {/*
            A closed appeal can be published and will still reach NOBODY: the
            member and public queries both require an active campaign. Without
            this the chip reads "Public", the church believes it announced
            something, and the congregation sees nothing — a silent failure
            with a confident label on it.
          */}
          {campaign && !campaign.isActive ? (
            <Alert severity="warning">
              This appeal is closed, so publishing it will not show it to
              anyone. Reopen it first if you want people to see it.
            </Alert>
          ) : null}

          <FormControl fullWidth>
            <InputLabel id="visibility-label">Who may see this</InputLabel>
            <Select
              labelId="visibility-label"
              label="Who may see this"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as Visibility)}
            >
              <MenuItem value="draft">Draft — nobody</MenuItem>
              <MenuItem value="members">Members only</MenuItem>
              <MenuItem value="public">Public</MenuItem>
            </Select>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
              {visibilityMeaning(visibility)}
            </Typography>
          </FormControl>

          <Divider />

          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={showProgress}
                  onChange={(e) => setShowProgress(e.target.checked)}
                />
              }
              label="Show how much has been raised"
            />
            {/*
              A thermometer cuts both ways, and the church is the one who knows
              which way theirs is pointing. Saying so is what makes this a
              choice rather than a setting nobody understands.
            */}
            <Typography component="p" variant="caption" color="text.secondary">
              “GHS 48,000 of GHS 50,000” brings in the last few givers. “GHS
              1,200 of GHS 50,000”, visible to everyone, says something else.
            </Typography>
          </Box>

          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={listed && visibility === 'public'}
                  disabled={visibility !== 'public'}
                  onChange={(e) => setListed(e.target.checked)}
                />
              }
              label="List on the ALTAR OS website"
            />
            <Typography component="p" variant="caption" color="text.secondary">
              {visibility === 'public'
                ? 'Your appeal appears on our public site alongside other churches. ' +
                  'This is a separate decision from publishing it on your own.'
                : 'Only public appeals can be listed on our website.'}
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={() => void submit()} variant="contained" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CreateDialog({
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
  const [target, setTarget] = useState('');
  const [endDate, setEndDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const targetMajor = Number(target);
    if (!title.trim() || !Number.isFinite(targetMajor) || targetMajor <= 0 || !endDate) return;
    setSaving(true);
    setError(null);
    try {
      await campaignService.create({
        title: title.trim(),
        description: description.trim() || undefined,
        // Converted to MINOR units here. The server stores minor units
        // everywhere; sending 50000 as major would create a GHS 500 appeal
        // whose target reads correctly on this screen and nowhere else.
        targetAmount: Math.round(targetMajor * 100),
        currency: 'GHS',
        startDate: new Date().toISOString(),
        endDate: new Date(endDate).toISOString(),
        isActive: true,
      });
      setTitle('');
      setDescription('');
      setTarget('');
      setEndDate('');
      onCreated();
      onClose();
    } catch {
      setError('We could not create that appeal. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>New appeal</DialogTitle>
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
            rows={3}
          />
          <TextField
            label="Target (GHS)"
            value={target}
            onChange={(e) => setTarget(e.target.value.replace(/[^0-9.]/g, ''))}
            fullWidth
            required
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
          />
          <TextField
            label="Ends on"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            fullWidth
            required
            slotProps={{ inputLabel: { shrink: true } }}
          />
          {/*
            New appeals are DRAFTS. A church typing a title must not thereby
            publish its plans, and the second step is where the audience is
            chosen deliberately.
          */}
          <Alert severity="info" variant="outlined">
            This is saved as a draft. Nobody sees it until you publish it.
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={() => void submit()} variant="contained" disabled={saving}>
          {saving ? 'Creating…' : 'Create draft'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState<Campaign | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCampaigns(await campaignService.list());
    } catch {
      setError('We could not load your appeals. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Box>
          <Typography variant="h4">Appeals</Typography>
          <Typography variant="body2" color="text.secondary">
            Fundraising campaigns, and who has been shown them.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<CampaignIcon />} onClick={() => setCreating(true)}>
          New appeal
        </Button>
      </Stack>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}

      {campaigns.length === 0 ? (
        <Card>
          <CardContent>
            <Typography variant="body2" color="text.secondary">
              No appeals yet. Create one to start raising for a project.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Stack spacing={2}>
          {campaigns.map((campaign) => (
            <Card key={campaign.id}>
              <CardContent>
                <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <Box sx={{ flex: 1, pr: 2 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
                      <Typography variant="h6">{campaign.title}</Typography>
                      <Chip
                        size="small"
                        color={visibilityColor(campaign.visibility)}
                        variant={campaign.visibility === '' ? 'outlined' : 'filled'}
                        label={visibilityLabel(campaign.visibility)}
                      />
                      {campaign.listedInDirectory ? (
                        <Chip size="small" variant="outlined" label="On altaros.com" />
                      ) : null}
                    </Stack>
                    {campaign.description ? (
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                        {campaign.description}
                      </Typography>
                    ) : null}

                    {/*
                      Staff always see the raised figure. showProgress governs
                      what MEMBERS and the public are shown, not what the
                      church can see about its own appeal.
                    */}
                    <LinearProgress
                      variant="determinate"
                      value={Math.min(100, campaign.progress)}
                      sx={{ height: 8, borderRadius: 1, mb: 1 }}
                    />
                    <Typography variant="body2">
                      <strong>{money(campaign.currentAmount, campaign.currency)}</strong>
                      {' of '}
                      {money(campaign.targetAmount, campaign.currency)}
                      {' · '}
                      {campaign.showProgress
                        ? 'members see this figure'
                        : 'members do not see this figure'}
                    </Typography>
                  </Box>

                  <Stack spacing={1}>
                    <Button size="small" variant="contained" onClick={() => setPublishing(campaign)}>
                      {campaign.visibility === '' ? 'Publish' : 'Change audience'}
                    </Button>
                    {campaign.visibility !== '' ? (
                      <Button
                        size="small"
                        color="inherit"
                        onClick={async () => {
                          await campaignService.unpublish(campaign.id);
                          await load();
                        }}
                      >
                        Withdraw
                      </Button>
                    ) : null}
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      <CreateDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => void load()}
      />
      <PublishDialog
        campaign={publishing}
        onClose={() => setPublishing(null)}
        onPublished={() => void load()}
      />
    </Box>
  );
}
