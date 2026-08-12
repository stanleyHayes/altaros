import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import { Check as CheckIcon } from '@mui/icons-material';
import planService, {
  commissionPercent,
  isWithdrawn,
  monthlyPrice,
  type PlanState,
  type Tier,
  type TierDetails,
} from '../services/plan.service';

/**
 * The church's plan.
 *
 * Two things are true at once and the page has to say both: what the church is
 * PAYING for, and what it may do right now. They diverge when a subscription
 * goes unpaid — the tier still says Growth and streaming is off — and a page
 * that showed only the tier would leave a church certain it had a feature the
 * server was refusing.
 *
 * This lives on the web and only on the web. Apple's Guideline 3.1.1 requires a
 * digital subscription sold inside an iOS app to go through Apple's in-app
 * purchase and its 30%, and 3.1.3 forbids the app from even pointing here. The
 * mobile app has no tier screen and the API refuses a change that arrives from
 * it. Donations are exempt from all of that, which is why giving is in the app
 * and this is not.
 */

function TierCard({
  tier,
  current,
  onChoose,
  busy,
}: {
  tier: TierDetails;
  current: boolean;
  onChoose: (tier: Tier) => void;
  busy: boolean;
}) {
  return (
    <Card
      variant={current ? 'elevation' : 'outlined'}
      sx={{ flex: 1, minWidth: 220, borderColor: current ? 'primary.main' : undefined }}
    >
      <CardContent>
        <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
          <Typography variant="h6">{tier.name}</Typography>
          {current ? <Chip size="small" color="primary" label="Current" /> : null}
        </Stack>
        <Typography variant="h5" sx={{ my: 1 }}>
          {monthlyPrice(tier)}
          {tier.monthlyMinor > 0 ? (
            <Typography component="span" variant="body2" color="text.secondary">
              {' '}
              / month
            </Typography>
          ) : null}
        </Typography>

        <Divider sx={{ my: 1.5 }} />

        <Stack spacing={1}>
          {/*
            Commission first. It is the number that decides what a church
            actually pays us, and on the free tier it is HIGHER than on the
            paid ones — the free tier is funded by the split, which is the
            honest trade and the one to state plainly rather than bury.
          */}
          <Typography variant="body2">
            <strong>{commissionPercent(tier.commissionBasisPoints)}</strong> of each gift
          </Typography>
          <Typography variant="body2" color={tier.streaming ? 'text.primary' : 'text.secondary'}>
            {tier.streaming ? (
              <>
                <CheckIcon sx={{ fontSize: 14, verticalAlign: 'middle' }} /> Live streaming, up to{' '}
                {tier.maxConcurrentViewers.toLocaleString()} watching
              </>
            ) : (
              'No live streaming'
            )}
          </Typography>
        </Stack>

        {!current ? (
          <Button
            fullWidth
            variant="outlined"
            sx={{ mt: 2 }}
            disabled={busy}
            onClick={() => onChoose(tier.tier)}
          >
            Choose {tier.name}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function PlanPage() {
  const [state, setState] = useState<PlanState | null>(null);
  const [tiers, setTiers] = useState<TierDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [current, list] = await Promise.all([planService.current(), planService.tiers()]);
      setState(current);
      setTiers(list);
    } catch {
      setError('We could not load your plan. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const choose = useCallback(
    async (tier: Tier) => {
      setBusy(true);
      setError(null);
      setSaved(null);
      try {
        const next = await planService.setTier(tier);
        setState(next);
        setSaved(`You are now on ${next.entitlement.name}.`);
      } catch {
        setError('We could not change your plan. Please try again.');
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  const withdrawn = state ? isWithdrawn(state) : false;

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 0.5 }}>
        Plan
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        What you pay us, and what we take from each gift.
      </Typography>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      {saved ? (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSaved(null)}>
          {saved}
        </Alert>
      ) : null}

      {/*
        The divergence, said out loud. A church whose streaming has been
        withdrawn for non-payment must be told that is why, not left to
        discover a Go Live button that refuses.
      */}
      {withdrawn && state ? (
        <Alert severity="warning" sx={{ mb: 3 }}>
          Your subscription is {state.subscription.status.replace('_', ' ')}, so some
          features are switched off. {state.tierGrants.name} includes live
          streaming for up to {state.tierGrants.maxConcurrentViewers.toLocaleString()}{' '}
          people; it will come back when the invoice is settled.{' '}
          <strong>Your commission rate is unchanged.</strong>
        </Alert>
      ) : null}

      {state ? (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="overline" color="text.secondary">
              Right now
            </Typography>
            <Stack direction="row" spacing={4} sx={{ flexWrap: "wrap", mt: 1 }}>
              <Box>
                <Typography variant="h6">{state.entitlement.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  Your plan
                </Typography>
              </Box>
              <Box>
                <Typography variant="h6">
                  {commissionPercent(state.entitlement.commissionBasisPoints)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Our share of each gift
                </Typography>
              </Box>
              <Box>
                <Typography variant="h6">
                  {state.entitlement.streaming
                    ? state.entitlement.maxConcurrentViewers.toLocaleString()
                    : '—'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  People who can watch at once
                </Typography>
              </Box>
            </Stack>
          </CardContent>
        </Card>
      ) : null}

      <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap" }}>
        {tiers.map((tier) => (
          <TierCard
            key={tier.tier}
            tier={tier}
            current={state?.subscription.tier === tier.tier}
            onChoose={(next) => void choose(next)}
            busy={busy}
          />
        ))}
      </Stack>

      {/*
        Stated rather than assumed. A church seeing a percentage taken from
        giving AND a monthly bill deserves to know the two are separate — the
        subscription is never settled out of what the congregation gave.
      */}
      <Alert severity="info" variant="outlined" sx={{ mt: 3 }}>
        Your subscription is billed to your church directly. It is never taken
        out of what your members give — that money settles to your account in
        full, less only the share above.
      </Alert>
    </Box>
  );
}
