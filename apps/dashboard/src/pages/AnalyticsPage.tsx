import { useState, useEffect, useCallback } from "react";
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  CircularProgress,
  Alert,
  Button,
} from "@mui/material";
import {
  People as PeopleIcon,
  TrendingUp as TrendIcon,
  Favorite as EngagementIcon,
  Groups as GroupsIcon,
} from "@mui/icons-material";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import StatCard from "@/components/ui/StatCard";
import AnalyticsService, {
  type Trend,
  type Engagement,
} from "@/services/analytics.service";

interface LoadingState {
  attendance: boolean;
  giving: boolean;
  engagement: boolean;
}

interface ErrorState {
  attendance: string | null;
  giving: string | null;
  engagement: string | null;
}

export default function AnalyticsPage() {
  const [loading, setLoading] = useState<LoadingState>({
    attendance: true,
    giving: true,
    engagement: true,
  });
  const [errors, setErrors] = useState<ErrorState>({
    attendance: null,
    giving: null,
    engagement: null,
  });

  const [attendance, setAttendance] = useState<Trend | null>(null);
  const [giving, setGiving] = useState<Trend | null>(null);
  const [engagement, setEngagement] = useState<Engagement | null>(null);

  const loadAttendance = useCallback(async () => {
    setLoading((prev) => ({ ...prev, attendance: true }));
    setErrors((prev) => ({ ...prev, attendance: null }));
    try {
      const data = await AnalyticsService.attendanceTrend({ grain: "week" });
      setAttendance(data);
    } catch (_err) {
      setErrors((prev) => ({
        ...prev,
        attendance: "Could not load attendance data. Please try again.",
      }));
    } finally {
      setLoading((prev) => ({ ...prev, attendance: false }));
    }
  }, []);

  const loadGiving = useCallback(async () => {
    setLoading((prev) => ({ ...prev, giving: true }));
    setErrors((prev) => ({ ...prev, giving: null }));
    try {
      const data = await AnalyticsService.givingTrend({ grain: "week" });
      setGiving(data);
    } catch (_err) {
      setErrors((prev) => ({
        ...prev,
        giving: "Could not load giving data. Please try again.",
      }));
    } finally {
      setLoading((prev) => ({ ...prev, giving: false }));
    }
  }, []);

  const loadEngagement = useCallback(async () => {
    setLoading((prev) => ({ ...prev, engagement: true }));
    setErrors((prev) => ({ ...prev, engagement: null }));
    try {
      const data = await AnalyticsService.engagement({ days: 56 });
      setEngagement(data);
    } catch (_err) {
      setErrors((prev) => ({
        ...prev,
        engagement: "Could not load engagement data. Please try again.",
      }));
    } finally {
      setLoading((prev) => ({ ...prev, engagement: false }));
    }
  }, []);

  useEffect(() => {
    void loadAttendance();
    void loadGiving();
    void loadEngagement();
  }, [loadAttendance, loadGiving, loadEngagement]);

  // Format money in minor units (pesewas) as GHS currency
  const formatMoney = (minor: number) => {
    return new Intl.NumberFormat("en-GH", {
      style: "currency",
      currency: "GHS",
    }).format(minor / 100);
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 3 }}>
        Analytics
      </Typography>

      {/* Stat Cards - based on real data */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        {/* Average attendance from the attendance trend */}
        {loading.attendance ? (
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card>
              <CardContent
                sx={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  py: 6,
                }}
              >
                <CircularProgress size={40} />
              </CardContent>
            </Card>
          </Grid>
        ) : errors.attendance ? (
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card>
              <CardContent
                sx={{ display: "flex", alignItems: "center", justifyContent: "center", py: 3 }}
              >
                <Typography variant="body2" color="error" sx={{ textAlign: "center" }}>
                  Could not load
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ) : attendance ? (
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatCard
              title="Avg. Attendance"
              value={Math.round(attendance.average).toString()}
              icon={<PeopleIcon />}
              change={attendance.changePercent ?? undefined}
              changeLabel={attendance.changePercent !== null ? "trend" : undefined}
              iconBgColor="info.light"
              iconColor="info.main"
            />
          </Grid>
        ) : null}

        {/* Total members from engagement */}
        {loading.engagement ? (
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card>
              <CardContent
                sx={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  py: 6,
                }}
              >
                <CircularProgress size={40} />
              </CardContent>
            </Card>
          </Grid>
        ) : errors.engagement ? (
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card>
              <CardContent
                sx={{ display: "flex", alignItems: "center", justifyContent: "center", py: 3 }}
              >
                <Typography variant="body2" color="error" sx={{ textAlign: "center" }}>
                  Could not load
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ) : engagement ? (
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatCard
              title="Total Members"
              value={engagement.members.toString()}
              icon={<GroupsIcon />}
              iconBgColor="success.light"
              iconColor="success.main"
            />
          </Grid>
        ) : null}

        {/* Recent engagement from engagement stats */}
        {loading.engagement ? (
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card>
              <CardContent
                sx={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  py: 6,
                }}
              >
                <CircularProgress size={40} />
              </CardContent>
            </Card>
          </Grid>
        ) : errors.engagement ? (
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card>
              <CardContent
                sx={{ display: "flex", alignItems: "center", justifyContent: "center", py: 3 }}
              >
                <Typography variant="body2" color="error" sx={{ textAlign: "center" }}>
                  Could not load
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ) : engagement ? (
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatCard
              title="Engaged (56 days)"
              value={engagement.engaged.toString()}
              icon={<EngagementIcon />}
              iconBgColor="warning.light"
              iconColor="warning.main"
            />
          </Grid>
        ) : null}

        {/* Drifting members from engagement stats */}
        {loading.engagement ? (
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card>
              <CardContent
                sx={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  py: 6,
                }}
              >
                <CircularProgress size={40} />
              </CardContent>
            </Card>
          </Grid>
        ) : errors.engagement ? (
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card>
              <CardContent
                sx={{ display: "flex", alignItems: "center", justifyContent: "center", py: 3 }}
              >
                <Typography variant="body2" color="error" sx={{ textAlign: "center" }}>
                  Could not load
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ) : engagement ? (
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatCard
              title="Drifting"
              value={engagement.drifting.toString()}
              icon={<TrendIcon />}
              iconBgColor="error.light"
              iconColor="error.main"
            />
          </Grid>
        ) : null}
      </Grid>

      {/* Attendance Trend Chart */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
                Attendance Trend
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Weekly attendance over the last 3 months
              </Typography>

              {errors.attendance && (
                <Alert
                  severity="error"
                  sx={{ mb: 2 }}
                  action={
                    <Button color="inherit" size="small" onClick={() => void loadAttendance()}>
                      Retry
                    </Button>
                  }
                >
                  {errors.attendance}
                </Alert>
              )}

              {loading.attendance ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
                  <CircularProgress />
                </Box>
              ) : attendance && attendance.points.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={attendance.points}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="bucket"
                      axisLine={false}
                      tickLine={false}
                      fontSize={12}
                    />
                    <YAxis axisLine={false} tickLine={false} fontSize={12} />
                    <Tooltip />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="value"
                      name="Attendance"
                      stroke="#1976d2"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <Box sx={{ py: 6, textAlign: "center" }}>
                  <Typography variant="body2" color="text.secondary">
                    No attendance data available yet.
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Giving Trend Chart */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
                Giving Trend
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Weekly giving (gross) over the last 3 months
              </Typography>

              {errors.giving && (
                <Alert
                  severity="error"
                  sx={{ mb: 2 }}
                  action={
                    <Button color="inherit" size="small" onClick={() => void loadGiving()}>
                      Retry
                    </Button>
                  }
                >
                  {errors.giving}
                </Alert>
              )}

              {loading.giving ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
                  <CircularProgress />
                </Box>
              ) : giving && giving.points.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={giving.points}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="bucket"
                        axisLine={false}
                        tickLine={false}
                        fontSize={12}
                      />
                      <YAxis axisLine={false} tickLine={false} fontSize={12} />
                      <Tooltip
                      formatter={(value) =>
                        typeof value === "number" ? [formatMoney(value)] : value
                      }
                    />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="value"
                        name="Giving"
                        stroke="#2e7d32"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                  <Box sx={{ textAlign: "center", mt: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                      Total: {formatMoney(giving.total)} | Average: {formatMoney(giving.average)}
                    </Typography>
                  </Box>
                </>
              ) : (
                <Box sx={{ py: 6, textAlign: "center" }}>
                  <Typography variant="body2" color="text.secondary">
                    No giving data available yet.
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Engagement Summary */}
      {!errors.engagement && engagement && (
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                  Engagement Summary
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  Last {engagement.windowDays} days
                </Typography>

                <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                    <Typography variant="body2">Members:</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {engagement.members}
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                    <Typography variant="body2">Attended:</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {engagement.attendedRecently} (
                      {((engagement.attendedRecently / Math.max(engagement.members, 1)) * 100).toFixed(
                        1,
                      )}
                      %)
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                    <Typography variant="body2">Gave:</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {engagement.gaveRecently} (
                      {((engagement.gaveRecently / Math.max(engagement.members, 1)) * 100).toFixed(
                        1,
                      )}
                      %)
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                    <Typography variant="body2">Engaged (either):</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {engagement.engaged} (
                      {((engagement.engaged / Math.max(engagement.members, 1)) * 100).toFixed(1)}%)
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", pt: 1, borderTop: "1px solid" , borderColor: "divider" }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: "error.main" }}>
                      Drifting:
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 600, color: "error.main" }}
                    >
                      {engagement.drifting}
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                  What This Means
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8 }}>
                  <strong>Engaged:</strong> Members who attended a service or gave in the last{" "}
                  {engagement.windowDays} days.
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, lineHeight: 1.8 }}>
                  <strong>Drifting:</strong> Members who were engaged in the previous{" "}
                  {engagement.windowDays}-day period but have not attended or given since. These
                  are the members to follow up with.
                </Typography>
                <Alert severity="info" sx={{ mt: 2 }}>
                  This dashboard shows real data from your church. All figures are based on actual
                  attendance records and giving transactions.
                </Alert>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
    </Box>
  );
}
