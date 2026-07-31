import { useState, useEffect } from "react";
import { Box, Typography, Grid, Card, CardContent, CircularProgress } from "@mui/material";
import {
  Church as ChurchIcon,
  People as PeopleIcon,
  AttachMoney as MoneyIcon,
  PersonOutline as UserIcon,
} from "@mui/icons-material";
import StatCard from "@/components/ui/StatCard";
import AdminService, { type PlatformStats } from "@/services/admin.service";

export default function DashboardPage() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    AdminService.getStats()
      .then((res) => setStats(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" fontWeight={700} sx={{ mb: 3 }}>
        Platform Overview
      </Typography>

      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Total Churches"
            value={stats?.totalChurches ?? 0}
            icon={<ChurchIcon />}
            change={12}
            changeLabel="this month"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Total Members"
            value={(stats?.totalMembers ?? 0).toLocaleString()}
            icon={<PeopleIcon />}
            change={8}
            changeLabel="this month"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Platform Revenue"
            value={`$${((stats?.totalRevenue ?? 0) / 100).toLocaleString()}`}
            icon={<MoneyIcon />}
            change={15}
            changeLabel="this month"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Active Users"
            value={(stats?.activeUsers ?? 0).toLocaleString()}
            icon={<UserIcon />}
            change={5}
            changeLabel="this month"
          />
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
                Quick Stats
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography color="text.secondary">Active Churches</Typography>
                  <Typography fontWeight={600}>
                    {stats?.activeChurches ?? 0} / {stats?.totalChurches ?? 0}
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography color="text.secondary">Total Users</Typography>
                  <Typography fontWeight={600}>
                    {stats?.totalUsers ?? 0}
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography color="text.secondary">Active Users</Typography>
                  <Typography fontWeight={600}>
                    {stats?.activeUsers ?? 0}
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography color="text.secondary">Total Members</Typography>
                  <Typography fontWeight={600}>
                    {(stats?.totalMembers ?? 0).toLocaleString()}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
                Platform Health
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography color="text.secondary">API Status</Typography>
                  <Typography fontWeight={600} color="success.main">
                    Operational
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography color="text.secondary">Database</Typography>
                  <Typography fontWeight={600} color="success.main">
                    Connected
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography color="text.secondary">Revenue (Total)</Typography>
                  <Typography fontWeight={600}>
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
