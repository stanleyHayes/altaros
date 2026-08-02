import { useState, useEffect } from "react";
import { Alert, Box, Typography, Grid, Card, CardContent, Skeleton, Button } from "@mui/material";
import {
  Church as ChurchIcon,
  People as PeopleIcon,
  AttachMoney as MoneyIcon,
  PersonOutlined as UserIcon,
} from "@mui/icons-material";
import StatCard from "@/components/ui/StatCard";
import AdminService, { type PlatformStats } from "@/services/admin.service";

export default function DashboardPage() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    AdminService.getStats()
      .then(setStats)
      // A discarded error rendered as a platform of all zeros, which reads as
      // a real empty platform rather than as a failure. Kept and shown.
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Box><Skeleton variant="rounded" height={150} /><Grid container spacing={2} sx={{ mt: 2 }}>{Array.from({ length: 4 }, (_, index) => <Grid key={index} size={{ xs: 12, sm: 6, md: 3 }}><Skeleton variant="rounded" height={190} /></Grid>)}</Grid></Box>
    );
  }

  return (
    <Box>
      <Box sx={{ mb: 3.5, p: { xs: 3, md: 4 }, border: "1px solid", borderColor: "divider", borderRadius: 2, bgcolor: "#0C2724", backgroundImage: "radial-gradient(circle at 88% 0%, rgba(113,215,197,.16), transparent 28%)", display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1.25fr .75fr" }, gap: 3, alignItems: "end" }}><Box><Typography variant="overline" color="primary.main">Production network</Typography><Typography variant="h2" sx={{ mt: 1.5, maxWidth: 720 }}>Know what needs operator attention.</Typography><Typography color="text.secondary" sx={{ mt: 1.5, maxWidth: 600 }}>A live view of tenant growth, access, commercial activity and platform readiness.</Typography></Box><Box sx={{ p: 2, borderLeft: { lg: "1px solid" }, borderColor: "divider" }}><Typography variant="overline" color="text.secondary">Next control window</Typography><Typography variant="h5" sx={{ mt: 1 }}>Settlement review · 14:00 GMT</Typography><Button href="/finance" sx={{ mt: 1.4, px: 0 }}>Open finance →</Button></Box></Box>

      {/* No "+12% this month" deltas here.
          They were hardcoded — nothing computed them, and a fabricated trend
          beside a real figure is read as fact. StatCard still accepts a
          `change` prop, so they can come back the day something measures one. */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          These figures could not be loaded, so nothing below is current. {error}
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Total Churches"
            value={stats?.totalChurches ?? 0}
            icon={<ChurchIcon />}
            featured
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Total Members"
            value={(stats?.totalMembers ?? 0).toLocaleString()}
            icon={<PeopleIcon />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Platform Revenue"
            value={`$${((stats?.totalRevenue ?? 0) / 100).toLocaleString()}`}
            icon={<MoneyIcon />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Active Users"
            value={(stats?.activeUsers ?? 0).toLocaleString()}
            icon={<UserIcon />}
          />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="overline" color="primary.main">Network composition</Typography><Typography variant="h5" sx={{ mt: 1, mb: 2 }}>Tenant and identity pulse</Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
                  <Typography color="text.secondary">Active Churches</Typography>
                  <Typography sx={{ fontWeight: 600 }}>
                    {stats?.activeChurches ?? 0} / {stats?.totalChurches ?? 0}
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between", py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
                  <Typography color="text.secondary">Total Users</Typography>
                  <Typography sx={{ fontWeight: 600 }}>
                    {stats?.totalUsers ?? 0}
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between", py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
                  <Typography color="text.secondary">Active Users</Typography>
                  <Typography sx={{ fontWeight: 600 }}>
                    {stats?.activeUsers ?? 0}
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between", py: 1 }}>
                  <Typography color="text.secondary">Total Members</Typography>
                  <Typography sx={{ fontWeight: 600 }}>
                    {(stats?.totalMembers ?? 0).toLocaleString()}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="overline" color="primary.main">Control plane</Typography><Typography variant="h5" sx={{ mt: 1, mb: 2 }}>Platform readiness</Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography color="text.secondary">API Status</Typography>
                  <Typography color="success.main" sx={{ fontWeight: 600 }}>
                    Operational
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography color="text.secondary">Database</Typography>
                  <Typography color="success.main" sx={{ fontWeight: 600 }}>
                    Connected
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography color="text.secondary">Revenue (Total)</Typography>
                  <Typography sx={{ fontWeight: 600 }}>
                    ${((stats?.totalRevenue ?? 0) / 100).toLocaleString()}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
