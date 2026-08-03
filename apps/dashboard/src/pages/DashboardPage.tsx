import {
  Box,
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
} from '@mui/material';
import {
  People as PeopleIcon,
  AccountBalance as FinanceIcon,
  Event as EventIcon,
  TrendingUp as TrendingUpIcon,
  CalendarToday as CalendarIcon,
} from '@mui/icons-material';
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
} from 'recharts';
import type { ReactNode } from 'react';
import { usePermissions } from '@altar-os/permissions';
import StatCard from '@/components/ui/StatCard';
import PageSkeleton from '@/components/ui/PageSkeleton';

// TODO: Replace with real API data from FinanceService & MemberService
const givingTrendsData = [
  { month: 'Apr', amount: 18200 },
  { month: 'May', amount: 21500 },
  { month: 'Jun', amount: 19800 },
  { month: 'Jul', amount: 22400 },
  { month: 'Aug', amount: 20100 },
  { month: 'Sep', amount: 23600 },
  { month: 'Oct', amount: 21900 },
  { month: 'Nov', amount: 25200 },
  { month: 'Dec', amount: 31800 },
  { month: 'Jan', amount: 22100 },
  { month: 'Feb', amount: 23400 },
  { month: 'Mar', amount: 24580 },
];

const attendanceTrendsData = [
  { week: 'W1', attendance: 312 },
  { week: 'W2', attendance: 345 },
  { week: 'W3', attendance: 298 },
  { week: 'W4', attendance: 367 },
  { week: 'W5', attendance: 389 },
  { week: 'W6', attendance: 354 },
  { week: 'W7', attendance: 412 },
  { week: 'W8', attendance: 398 },
];

const recentMembers = [
  {
    id: '1',
    name: 'Grace Adekunle',
    email: 'grace@example.com',
    status: 'active',
    joined: '2026-03-25',
  },
  {
    id: '2',
    name: 'David Okafor',
    email: 'david@example.com',
    status: 'active',
    joined: '2026-03-22',
  },
  {
    id: '3',
    name: 'Sarah Johnson',
    email: 'sarah@example.com',
    status: 'visitor',
    joined: '2026-03-20',
  },
  {
    id: '4',
    name: 'Michael Chen',
    email: 'michael@example.com',
    status: 'active',
    joined: '2026-03-18',
  },
  {
    id: '5',
    name: 'Amara Diallo',
    email: 'amara@example.com',
    status: 'active',
    joined: '2026-03-15',
  },
];

const upcomingEvents = [
  {
    id: '1',
    title: 'Sunday Worship Service',
    date: '2026-03-30',
    time: '9:00 AM',
    location: 'Main Sanctuary',
  },
  {
    id: '2',
    title: 'Mid-Week Bible Study',
    date: '2026-04-01',
    time: '6:30 PM',
    location: 'Fellowship Hall',
  },
  {
    id: '3',
    title: 'Youth Group Meeting',
    date: '2026-04-03',
    time: '5:00 PM',
    location: 'Youth Center',
  },
  {
    id: '4',
    title: 'Community Outreach',
    date: '2026-04-05',
    time: '10:00 AM',
    location: 'City Park',
  },
];

/** A panel and the permission its DATA belongs to. */
interface Panel {
  key: string;
  requires: string;
  /** Preferred share of a 12-column row when it has company. */
  weight: number;
  body: ReactNode;
}

/**
 * The dashboard is the one route with no permission of its own.
 *
 * That is deliberate — it is where everyone lands, and requiring something to
 * reach it sends a narrowly-scoped account to a not-found page immediately
 * after signing in. The consequence is that requirement 7 has to be enforced
 * WIDGET BY WIDGET here, because an open route whose contents are ungated shows
 * the congregation's giving total to someone the sidebar just finished hiding
 * the Finance section from.
 *
 * Widgets are FILTERED rather than each wrapped in <Can>, and that is a layout
 * decision as much as an access one. Wrapping produced the correct data and a
 * broken page: a lone stat card stranded at a quarter width, a dead band of
 * whitespace where the charts had been, and a panel still sized for a companion
 * that was no longer rendered. A filtered list lets the surviving widgets take
 * the space the hidden ones gave up.
 */
export default function DashboardPage() {
  const { permissions, isLoading } = usePermissions();

  const stats = [
    {
      key: 'members',
      requires: 'member:read',
      node: (
        <StatCard
          title="Total Members"
          value="1,248"
          icon={<PeopleIcon />}
          change={12}
          changeLabel="vs last month"
          iconBgColor="info.light"
          iconColor="info.main"
        />
      ),
    },
    {
      key: 'giving',
      requires: 'finance:read',
      node: (
        <StatCard
          title="Total Giving"
          value="$24,580"
          icon={<FinanceIcon />}
          change={8.5}
          changeLabel="vs last month"
          iconBgColor="success.light"
          iconColor="success.main"
        />
      ),
    },
    {
      key: 'attendance',
      requires: 'report:read',
      node: (
        <StatCard
          title="Attendance Rate"
          value="78%"
          icon={<TrendingUpIcon />}
          change={5.2}
          changeLabel="vs last month"
          iconBgColor="warning.light"
          iconColor="warning.main"
        />
      ),
    },
    {
      key: 'events',
      requires: 'event:read',
      node: (
        <StatCard
          title="Active Events"
          value="6"
          icon={<EventIcon />}
          change={-2}
          changeLabel="vs last month"
          iconBgColor="secondary.light"
          iconColor="secondary.dark"
        />
      ),
    },
  ].filter((stat) => permissions.has(stat.requires));

  const panels: Panel[] = [
    {
      key: 'giving-trends',
      requires: 'finance:read',
      weight: 7,
      body: (
        <>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
            Giving Trends
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Last 12 months
          </Typography>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={givingTrendsData}>
              <defs>
                <linearGradient id="givingGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#1976d2" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#1976d2" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={12} />
              <YAxis
                axisLine={false}
                tickLine={false}
                fontSize={12}
                tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
              />
              <Tooltip
                formatter={(value: any) => [`$${Number(value).toLocaleString()}`, 'Giving']}
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
        </>
      ),
    },
    {
      key: 'attendance-trends',
      requires: 'report:read',
      weight: 5,
      body: (
        <>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
            Attendance Trends
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Last 8 weeks
          </Typography>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={attendanceTrendsData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="week" axisLine={false} tickLine={false} fontSize={12} />
              <YAxis axisLine={false} tickLine={false} fontSize={12} />
              <Tooltip formatter={(value: any) => [value, 'Attendance']} />
              <Bar dataKey="attendance" fill="#9c27b0" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </>
      ),
    },
    {
      key: 'recent-members',
      requires: 'member:read',
      weight: 7,
      body: (
        <>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
            Recent Members
          </Typography>
          {/* The table scrolls inside its own card rather than pushing the page
              sideways, which is what happens when a four-column table meets a
              half-width panel on a laptop. */}
          <Box sx={{ overflowX: 'auto' }}>
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
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Avatar
                          sx={{
                            width: 28,
                            height: 28,
                            fontSize: 12,
                            bgcolor: 'primary.main',
                          }}
                        >
                          {member.name
                            .split(' ')
                            .map((n) => n[0])
                            .join('')}
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
                        color={member.status === 'active' ? 'success' : 'info'}
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
          </Box>
        </>
      ),
    },
    {
      key: 'upcoming-events',
      requires: 'event:read',
      weight: 5,
      body: (
        <>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
            Upcoming Events
          </Typography>
          <List disablePadding>
            {upcomingEvents.map((event) => (
              <ListItem
                key={event.id}
                sx={{
                  px: 0,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  '&:last-child': { borderBottom: 'none' },
                }}
              >
                <ListItemAvatar>
                  <Avatar
                    variant="rounded"
                    sx={{
                      bgcolor: 'primary.light',
                      color: 'primary.main',
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
        </>
      ),
    },
  ].filter((panel) => permissions.has(panel.requires));

  // A single surviving panel takes the full row instead of sitting at its
  // declared width with nothing beside it.
  const spanFor = (panel: Panel) => (panels.length === 1 ? 12 : panel.weight);

  if (isLoading) {
    return <PageSkeleton />;
  }

  return (
    <Box>
      <Box sx={{ mb: 3.5, p: { xs: 3, md: 4 }, borderRadius: 4, bgcolor: "#0B2E2A", color: "white", display: "grid", gridTemplateColumns: { xs: "1fr", md: "1.4fr .6fr" }, gap: 3, alignItems: "end", backgroundImage: "radial-gradient(circle at 88% 20%, rgba(109,213,196,.22), transparent 30%)", position: "relative", overflow: "hidden" }}>
        <Box><Typography variant="overline" sx={{ color: "primary.light" }}>Today at Grace Chapel</Typography><Typography variant="h2" sx={{ color: "white", mt: 1.5, maxWidth: 680 }}>The church, in one clear view.</Typography><Typography sx={{ mt: 1.8, color: "rgba(255,255,255,.58)", maxWidth: 570 }}>People, gatherings, giving and follow-up—ready for the decisions your team needs to make today.</Typography></Box>
        <Box sx={{ justifySelf: { md: "end" }, p: 2, minWidth: 210, borderLeft: { md: "1px solid rgba(255,255,255,.12)" }, pl: { md: 3 } }}><Typography sx={{ fontSize: ".68rem", color: "rgba(255,255,255,.45)", textTransform: "uppercase", letterSpacing: ".14em" }}>Next gathering</Typography><Typography sx={{ mt: 1, fontSize: "1.05rem", fontWeight: 700 }}>Sunday Service</Typography><Typography sx={{ mt: .4, fontSize: ".78rem", color: "primary.light" }}>9:00 AM · Main auditorium</Typography></Box>
      </Box>

      {stats.length > 0 && (
        // auto-fill rather than auto-fit: with one visible card, auto-fit
        // stretches it across the whole row and a single number rendered a
        // metre wide looks like a mistake. auto-fill leaves the empty tracks
        // empty and the card keeps the size it has everywhere else.
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 2,
            mb: 4,
            // Equal height across the row, whatever each card contains.
            alignItems: 'stretch',
            '& > *': { height: '100%' },
          }}
        >
          {stats.map((stat) => (
            <Box key={stat.key}>{stat.node}</Box>
          ))}
        </Box>
      )}

      {panels.length > 0 && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(12, 1fr)' },
            gap: 2,
            alignItems: 'stretch',
          }}
        >
          {panels.map((panel) => (
            <Card
              key={panel.key}
              sx={{
                // Every card in a row ends flush at the bottom.
                height: '100%',
                gridColumn: { xs: '1', md: `span ${spanFor(panel)}` },
              }}
            >
              <CardContent>{panel.body}</CardContent>
            </Card>
          ))}
        </Box>
      )}

      {stats.length === 0 && panels.length === 0 && (
        // Someone whose role grants none of this lands on a page with a heading
        // and nothing else, which reads as a broken account rather than a
        // narrow one. Say what is actually true.
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 8 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
              Nothing to show here yet
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Your role does not include access to the church&apos;s records. Ask an administrator
              if you were expecting to see more.
            </Typography>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
