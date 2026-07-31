import {
  Box,
  Grid,
  Typography,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Chip,
  Avatar,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
} from "@mui/material";
import {
  People as PeopleIcon,
  AccountBalance as FinanceIcon,
  Event as EventIcon,
  TrendingUp as TrendingUpIcon,
  CalendarToday as CalendarIcon,
} from "@mui/icons-material";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import StatCard from "@/components/ui/StatCard";

// TODO: Replace with real API data from FinanceService & MemberService
const givingTrendsData = [
  { month: "Apr", amount: 18200 },
  { month: "May", amount: 21500 },
  { month: "Jun", amount: 19800 },
  { month: "Jul", amount: 22400 },
  { month: "Aug", amount: 20100 },
  { month: "Sep", amount: 23600 },
  { month: "Oct", amount: 21900 },
  { month: "Nov", amount: 25200 },
  { month: "Dec", amount: 31800 },
  { month: "Jan", amount: 22100 },
  { month: "Feb", amount: 23400 },
  { month: "Mar", amount: 24580 },
];

const attendanceTrendsData = [
  { week: "W1", attendance: 312 },
  { week: "W2", attendance: 345 },
  { week: "W3", attendance: 298 },
  { week: "W4", attendance: 367 },
  { week: "W5", attendance: 389 },
  { week: "W6", attendance: 354 },
  { week: "W7", attendance: 412 },
  { week: "W8", attendance: 398 },
];

const recentMembers = [
  {
    id: "1",
    name: "Grace Adekunle",
    email: "grace@example.com",
    status: "active",
    joined: "2026-03-25",
  },
  {
    id: "2",
    name: "David Okafor",
    email: "david@example.com",
    status: "active",
    joined: "2026-03-22",
  },
  {
    id: "3",
    name: "Sarah Johnson",
    email: "sarah@example.com",
    status: "visitor",
    joined: "2026-03-20",
  },
  {
    id: "4",
    name: "Michael Chen",
    email: "michael@example.com",
    status: "active",
    joined: "2026-03-18",
  },
  {
    id: "5",
    name: "Amara Diallo",
    email: "amara@example.com",
    status: "active",
    joined: "2026-03-15",
  },
];

const upcomingEvents = [
  {
    id: "1",
    title: "Sunday Worship Service",
    date: "2026-03-30",
    time: "9:00 AM",
    location: "Main Sanctuary",
  },
  {
    id: "2",
    title: "Mid-Week Bible Study",
    date: "2026-04-01",
    time: "6:30 PM",
    location: "Fellowship Hall",
  },
  {
    id: "3",
    title: "Youth Group Meeting",
    date: "2026-04-03",
    time: "5:00 PM",
    location: "Youth Center",
  },
  {
    id: "4",
    title: "Community Outreach",
    date: "2026-04-05",
    time: "10:00 AM",
    location: "City Park",
  },
];

export default function DashboardPage() {
  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 3 }}>
        Dashboard
      </Typography>

      {/* Stat Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Total Members"
            value="1,248"
            icon={<PeopleIcon />}
            change={12}
            changeLabel="vs last month"
            iconBgColor="info.light"
            iconColor="info.main"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Total Giving"
            value="$24,580"
            icon={<FinanceIcon />}
            change={8.5}
            changeLabel="vs last month"
            iconBgColor="success.light"
            iconColor="success.main"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Attendance Rate"
            value="78%"
            icon={<TrendingUpIcon />}
            change={5.2}
            changeLabel="vs last month"
            iconBgColor="warning.light"
            iconColor="warning.main"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Active Events"
            value="6"
            icon={<EventIcon />}
            change={-2}
            changeLabel="vs last month"
            iconBgColor="secondary.light"
            iconColor="secondary.dark"
          />
        </Grid>
      </Grid>

      {/* Charts Row */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
                Giving Trends
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 3 }}
              >
                Last 12 months
              </Typography>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={givingTrendsData}>
                  <defs>
                    <linearGradient
                      id="givingGradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor="#1976d2" stopOpacity={0.3} />
                      <stop
                        offset="95%"
                        stopColor="#1976d2"
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
                    tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(value: any) => [
                      `$${Number(value).toLocaleString()}`,
                      "Giving",
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="amount"
                    stroke="#1976d2"
                    strokeWidth={2}
                    fill="url(#givingGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
                Attendance Trends
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 3 }}
              >
                Last 8 weeks
              </Typography>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={attendanceTrendsData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="week"
                    axisLine={false}
                    tickLine={false}
                    fontSize={12}
                  />
                  <YAxis axisLine={false} tickLine={false} fontSize={12} />
                  <Tooltip
                    formatter={(value: any) => [value, "Attendance"]}
                  />
                  <Bar
                    dataKey="attendance"
                    fill="#9c27b0"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={40}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Bottom Row: Recent Members + Upcoming Events */}
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                Recent Members
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Email</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Joined</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {recentMembers.map((member) => (
                    <TableRow key={member.id} hover>
                      <TableCell>
                        <Box
                          sx={{ display: "flex", alignItems: "center", gap: 1 }}
                        >
                          <Avatar
                            sx={{
                              width: 28,
                              height: 28,
                              fontSize: 12,
                              bgcolor: "primary.main",
                            }}
                          >
                            {member.name
                              .split(" ")
                              .map((n) => n[0])
                              .join("")}
                          </Avatar>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {member.name}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {member.email}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={member.status}
                          size="small"
                          color={
                            member.status === "active" ? "success" : "info"
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {member.joined}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                Upcoming Events
              </Typography>
              <List disablePadding>
                {upcomingEvents.map((event) => (
                  <ListItem
                    key={event.id}
                    sx={{
                      px: 0,
                      borderBottom: "1px solid",
                      borderColor: "divider",
                      "&:last-child": { borderBottom: "none" },
                    }}
                  >
                    <ListItemAvatar>
                      <Avatar
                        variant="rounded"
                        sx={{
                          bgcolor: "primary.light",
                          color: "primary.main",
                          width: 44,
                          height: 44,
                        }}
                      >
                        <CalendarIcon fontSize="small" />
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {event.title}
                        </Typography>
                      }
                      secondary={
                        <Typography variant="caption" color="text.secondary">
                          {event.date} at {event.time} &middot; {event.location}
                        </Typography>
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
