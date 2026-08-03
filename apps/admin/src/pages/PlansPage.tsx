import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Grid,
  LinearProgress,
  Skeleton,
  Typography,
} from '@mui/material';
import { ChurchRounded, WorkspacePremiumRounded } from '@mui/icons-material';
import AdminService, { type ChurchRow } from '@/services/admin.service';
import PageIntro from '@/components/ui/PageIntro';

const plans = [
  { id: 'free', label: 'Starter', price: 'GHS 0', memberLimit: '100 members' },
  { id: 'basic', label: 'Growth', price: 'GHS 249 / month', memberLimit: '500 members' },
  { id: 'pro', label: 'Ministry', price: 'GHS 749 / month', memberLimit: 'Unlimited members' },
  { id: 'enterprise', label: 'Enterprise', price: 'Contract', memberLimit: 'Multi-organisation' },
];

export default function PlansPage() {
  const [churches, setChurches] = useState<ChurchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    void AdminService.getChurches(1, 100)
      .then((response) => setChurches(response.items))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Plan data could not be loaded'),
      )
      .finally(() => setLoading(false));
  }, []);
  const counts = useMemo(
    () =>
      churches.reduce<Record<string, number>>((result, church) => {
        const plan = church.plan?.trim().toLowerCase() || 'free';
        result[plan] = (result[plan] ?? 0) + 1;
        return result;
      }, {}),
    [churches],
  );
  const paid = churches.filter((church) => church.plan && church.plan !== 'free').length;
  if (loading)
    return (
      <Grid container spacing={2}>
        {plans.map((plan) => (
          <Grid key={plan.id} size={{ xs: 12, sm: 6 }}>
            <Skeleton variant="rounded" height={210} />
          </Grid>
        ))}
      </Grid>
    );
  return (
    <Box>
      <PageIntro
        eyebrow="Subscription operations"
        title="Plans and adoption"
        copy="See which package every church is using and where paid activation is concentrated."
        action={
          <Chip icon={<WorkspacePremiumRounded />} label={`${paid} paid tenants`} color="primary" />
        }
      />
      {error && (
        <Alert severity="error" sx={{ mb: 2.5 }}>
          {error}
        </Alert>
      )}
      <Grid container spacing={2}>
        {plans.map((plan) => {
          const count = counts[plan.id] ?? 0;
          const share = churches.length ? (count / churches.length) * 100 : 0;
          return (
            <Grid key={plan.id} size={{ xs: 12, sm: 6 }}>
              <Card
                sx={{
                  height: '100%',
                  position: 'relative',
                  overflow: 'hidden',
                  isolation: 'isolate',
                }}
              >
                <Box
                  aria-hidden
                  sx={{
                    position: 'absolute',
                    right: -22,
                    bottom: -35,
                    zIndex: 0,
                    color: 'primary.main',
                    opacity: 0.055,
                    transform: 'rotate(-8deg)',
                    '& .MuiSvgIcon-root': { fontSize: 154 },
                  }}
                >
                  <WorkspacePremiumRounded />
                </Box>
                <CardContent sx={{ position: 'relative', zIndex: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                    <Box>
                      <Typography variant="overline" color="primary.main">
                        {plan.id}
                      </Typography>
                      <Typography variant="h4" sx={{ mt: 1 }}>
                        {plan.label}
                      </Typography>
                    </Box>
                    <Box
                      sx={{
                        width: 40,
                        height: 40,
                        borderRadius: 1,
                        bgcolor: 'rgba(113,215,197,.09)',
                        color: 'primary.main',
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      <ChurchRounded />
                    </Box>
                  </Box>
                  <Typography
                    sx={{
                      mt: 2,
                      fontSize: '2.4rem',
                      fontWeight: 760,
                      letterSpacing: '-.05em',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {count}
                  </Typography>
                  <Typography sx={{ fontSize: '.68rem', color: 'text.secondary' }}>
                    churches · {share.toFixed(1)}% of loaded tenants
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={share}
                    sx={{ mt: 2.2, height: 5, borderRadius: 1, bgcolor: 'rgba(196,230,222,.08)' }}
                  />
                  <Box
                    sx={{
                      mt: 2.2,
                      pt: 1.6,
                      borderTop: '1px solid',
                      borderColor: 'divider',
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 2,
                    }}
                  >
                    <Typography sx={{ fontSize: '.68rem', color: 'text.secondary' }}>
                      {plan.memberLimit}
                    </Typography>
                    <Typography sx={{ fontSize: '.68rem', fontWeight: 700 }}>
                      {plan.price}
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>
      <Typography sx={{ mt: 2, fontSize: '.65rem', color: 'text.secondary' }}>
        This view reads the first 100 tenants from the live church directory. Empty or unknown
        legacy plan values are safely treated as Starter.
      </Typography>
    </Box>
  );
}
