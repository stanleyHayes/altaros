import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Avatar,
  LinearProgress,
  CircularProgress,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
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
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import StatCard from "@/components/ui/StatCard";

// TODO: Replace all mock data with real API calls

const attendanceTrends = [
  { month: "Oct", sunday: 310, midweek: 95 },
  { month: "Nov", sunday: 325, midweek: 102 },
  { month: "Dec", sunday: 380, midweek: 88 },
  { month: "Jan", sunday: 298, midweek: 110 },
  { month: "Feb", sunday: 342, midweek: 115 },
  { month: "Mar", sunday: 398, midweek: 128 },
];

const givingBreakdown = [
  { name: "Tithes", value: 14200, color: "#1976d2" },
  { name: "Offerings", value: 6380, color: "#2e7d32" },
  { name: "Donations", value: 4000, color: "#ed6c02" },
];

// TODO: Replace with real API calls to GET /members/:id/engagement
const topEngagedMembers = [
  {
    id: "m1",
    name: "Sarah Johnson",
    score: 92,
    breakdown: { attendance: 95, giving: 88, participation: 90, spiritual: 96 },
  },
  {
    id: "m2",
    name: "David Okonkwo",
    score: 87,
    breakdown: { attendance: 90, giving: 82, participation: 88, spiritual: 85 },
  },
  {
    id: "m3",
    name: "Grace Mensah",
    score: 84,
    breakdown: { attendance: 88, giving: 90, participation: 72, spiritual: 88 },
  },
  {
    id: "m4",
    name: "Michael Tetteh",
    score: 79,
    breakdown: { attendance: 78, giving: 85, participation: 76, spiritual: 78 },
  },
  {
    id: "m5",
    name: "Esther Boateng",
    score: 76,
    breakdown: { attendance: 82, giving: 70, participation: 74, spiritual: 80 },
  },
];

const avgEngagementScore = Math.round(
  topEngagedMembers.reduce((sum, m) => sum + m.score, 0) /
    topEngagedMembers.length,
);

const memberGrowth = [
  { month: "Apr '25", total: 1020, new: 18 },
  { month: "May", total: 1045, new: 25 },
  { month: "Jun", total: 1068, new: 23 },
  { month: "Jul", total: 1095, new: 27 },
  { month: "Aug", total: 1110, new: 15 },
  { month: "Sep", total: 1138, new: 28 },
  { month: "Oct", total: 1162, new: 24 },
  { month: "Nov", total: 1185, new: 23 },
  { month: "Dec", total: 1198, new: 13 },
  { month: "Jan '26", total: 1215, new: 17 },
  { month: "Feb", total: 1230, new: 15 },
  { month: "Mar", total: 1248, new: 18 },
];

export default function AnalyticsPage() {
  const totalGiving = givingBreakdown.reduce((sum, g) => sum + g.value, 0);

  return (
    <Box>
      <Typography variant="h4" fontWeight={700} sx={{ mb: 3 }}>
        Analytics
      </Typography>

      {/* Engagement Score Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Avg. Sunday Attendance"
            value="342"
            icon={<PeopleIcon />}
            change={6.8}
            changeLabel="vs last quarter"
            iconBgColor="info.light"
            iconColor="info.main"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Member Retention"
            value="94%"
            icon={<GroupsIcon />}
            change={2.1}
            changeLabel="vs last quarter"
            iconBgColor="success.light"
            iconColor="success.main"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Engagement Score"
            value="7.8/10"
            icon={<EngagementIcon />}
            change={0.4}
            changeLabel="vs last quarter"
            iconBgColor="warning.light"
            iconColor="warning.main"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Growth Rate"
            value="+18"
            icon={<TrendIcon />}
            change={5.9}
            changeLabel="new this month"
            iconBgColor="secondary.light"
            iconColor="secondary.dark"
          />
        </Grid>
      </Grid>

      {/* Charts Row 1 */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="h6" fontWeight={600} sx={{ mb: 0.5 }}>
                Attendance Trends
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 3 }}
              >
                Sunday vs. mid-week attendance (last 6 months)
              </Typography>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={attendanceTrends}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="month"
                    axisLine={false}
                    tickLine={false}
                    fontSize={12}
                  />
                  <YAxis axisLine={false} tickLine={false} fontSize={12} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="sunday"
                    name="Sunday"
                    stroke="#1976d2"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="midweek"
                    name="Mid-Week"
                    stroke="#9c27b0"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="h6" fontWeight={600} sx={{ mb: 0.5 }}>
                Giving Breakdown
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 2 }}
              >
                This month by type
              </Typography>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={givingBreakdown}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={4}
                    dataKey="value"
                    label={({ name, percent }) =>
                      `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                    }
                    labelLine={false}
                  >
                    {givingBreakdown.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: any) => [
                      `$${Number(value).toLocaleString()}`,
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <Box sx={{ textAlign: "center", mt: 1 }}>
                <Typography variant="h5" fontWeight={700}>
                  ${totalGiving.toLocaleString()}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Total this month
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Charts Row 2 */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight={600} sx={{ mb: 0.5 }}>
                Member Growth
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 3 }}
              >
                Total members over the last 12 months
              </Typography>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={memberGrowth}>
                  <defs>
                    <linearGradient
                      id="growthGradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor="#2e7d32"
                        stopOpacity={0.3}
                      />
                      <stop
                        offset="95%"
                        stopColor="#2e7d32"
                        stopOpacity={0.05}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="month"
                    axisLine={false}
                    tickLine={false}
                    fontSize={12}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    fontSize={12}
                    domain={["dataMin - 50", "dataMax + 50"]}
                  />
                  <Tooltip
                    formatter={(value: any, name: any) => [
                      value,
                      name === "total" ? "Total Members" : "New Members",
                    ]}
                  />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="total"
                    name="Total Members"
                    stroke="#2e7d32"
                    strokeWidth={2}
                    fill="url(#growthGradient)"
                  />
                  <Area
                    type="monotone"
                    dataKey="new"
                    name="New Members"
                    stroke="#1976d2"
                    strokeWidth={2}
                    fill="none"
                    strokeDasharray="5 5"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Member Engagement Section */}
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                py: 4,
              }}
            >
              <Typography variant="h6" fontWeight={600} sx={{ mb: 3 }}>
                Average Engagement
              </Typography>
              <Box sx={{ position: "relative", display: "inline-flex", mb: 2 }}>
                <CircularProgress
                  variant="determinate"
                  value={avgEngagementScore}
                  size={140}
                  thickness={6}
                  sx={{ color: avgEngagementScore >= 75 ? "success.main" : avgEngagementScore >= 50 ? "warning.main" : "error.main" }}
                />
                <Box
                  sx={{
                    top: 0,
                    left: 0,
                    bottom: 0,
                    right: 0,
                    position: "absolute",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Typography variant="h3" fontWeight={700}>
                    {avgEngagementScore}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    out of 100
                  </Typography>
                </Box>
              </Box>
              <Typography variant="body2" color="text.secondary" textAlign="center">
                Based on attendance, giving, participation, and spiritual growth
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 8 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="h6" fontWeight={600} sx={{ mb: 0.5 }}>
                Top Engaged Members
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 2 }}
              >
                Members with highest engagement scores
              </Typography>
              <List disablePadding>
                {topEngagedMembers.map((member, index) => (
                  <ListItem
                    key={member.id}
                    sx={{
                      px: 0,
                      borderBottom:
                        index < topEngagedMembers.length - 1
                          ? "1px solid"
                          : "none",
                      borderColor: "divider",
                    }}
                  >
                    <ListItemAvatar>
                      <Avatar
                        sx={{
                          bgcolor:
                            index === 0
                              ? "warning.main"
                              : index === 1
                                ? "grey.400"
                                : index === 2
                                  ? "warning.dark"
                                  : "primary.light",
                          fontWeight: 700,
                        }}
                      >
                        {index + 1}
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={
                        <Box
                          sx={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            mb: 0.5,
                          }}
                        >
                          <Typography variant="body1" fontWeight={600}>
                            {member.name}
                          </Typography>
                          <Typography
                            variant="body2"
                            fontWeight={700}
                            color="primary.main"
                          >
                            {member.score}/100
                          </Typography>
                        </Box>
                      }
                      secondary={
                        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                          {(
                            [
                              { label: "Attend", value: member.breakdown.attendance, color: "#1976d2" },
                              { label: "Giving", value: member.breakdown.giving, color: "#2e7d32" },
                              { label: "Social", value: member.breakdown.participation, color: "#ed6c02" },
                              { label: "Spiritual", value: member.breakdown.spiritual, color: "#9c27b0" },
                            ] as const
                          ).map((item) => (
                            <Box key={item.label} sx={{ flex: 1, minWidth: 60 }}>
                              <Box
                                sx={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  mb: 0.25,
                                }}
                              >
                                <Typography variant="caption">
                                  {item.label}
                                </Typography>
                                <Typography variant="caption" fontWeight={600}>
                                  {item.value}
                                </Typography>
                              </Box>
                              <LinearProgress
                                variant="determinate"
                                value={item.value}
                                sx={{
                                  height: 4,
                                  borderRadius: 2,
                                  bgcolor: "grey.200",
                                  "& .MuiLinearProgress-bar": {
                                    bgcolor: item.color,
                                    borderRadius: 2,
                                  },
                                }}
                              />
                            </Box>
                          ))}
                        </Box>
                      }
                    />
                  </ListItem>
                ))}
              </List>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
