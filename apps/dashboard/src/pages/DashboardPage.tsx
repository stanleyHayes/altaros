import { useState, useCallback, useEffect } from 'react';
import {
  Box,
  Typography,
  Stack,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Chip,
  Avatar,
  Alert,
  Button,
  CircularProgress,
} from '@mui/material';
import {
  People as PeopleIcon,
  AccountBalance as FinanceIcon,
  TrendingUp as TrendingUpIcon,
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
import AnalyticsService, { type Trend, type Engagement } from '@/services/analytics.service';
import EventService, { type Event as EventItem } from '@/services/event.service';
import MemberService, { type Member } from '@/services/member.service';

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
  const { permissions, isLoading: permissionsLoading } = usePermissions();

  // Data state
  const [engagement, setEngagement] = useState<Engagement | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [givingTrend, setGivingTrend] = useState<Trend | null>(null);
  const [attendanceTrend, setAttendanceTrend] = useState<Trend | null>(null);
  const [upcoming, setUpcoming] = useState<EventItem[]>([]);

  // Error state
  const [dataErrors, setDataErrors] = useState<Record<string, string>>({});

  // Load all dashboard data
  const loadData = useCallback(async () => {
    setDataErrors({});
    const errors: Record<string, string> = {};

    // Load engagement data (needed for member count and recent givers)
    try {
      const data = await AnalyticsService.engagement({ days: 56 });
      setEngagement(data);
    } catch {
      errors.engagement = 'Could not load engagement data';
    }

    // Load member list for recent members table
    try {
      const data = await MemberService.getAll({ limit: 5 });
      setMembers(data);
    } catch {
      errors.members = 'Could not load members';
    }

    // What is happening next. GET /events/upcoming rather than filtering the
    // event list: recurring events are stored as a rule, so the next few
    // occurrences cannot be derived here without re-implementing the
    // recurrence expansion the server already does.
    try {
      setUpcoming(await EventService.upcoming(5));
    } catch {
      errors.upcoming = 'Could not load upcoming events';
    }

    // Load giving trend (values are in pesewas/minor units)
    try {
      const data = await AnalyticsService.givingTrend({ grain: 'week' });
      setGivingTrend(data);
    } catch {
      errors.givingTrend = 'Could not load giving trends';
    }

    // Load attendance trend
    try {
      const data = await AnalyticsService.attendanceTrend({ grain: 'week' });
      setAttendanceTrend(data);
    } catch {
      errors.attendanceTrend = 'Could not load attendance trends';
    }

    setDataErrors(errors);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Compute stat cards from real data
  const stats = [
    {
      key: 'members',
      requires: 'member:read',
      node: engagement ? (
        <StatCard
          title="Total Members"
          value={String(engagement.members)}
          icon={<PeopleIcon />}
          change={undefined}
          changeLabel="congregation"
          iconBgColor="info.light"
          iconColor="info.main"
        />
      ) : (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 180 }}>
          <CircularProgress />
        </Box>
      ),
    },
    {
      key: 'giving',
      requires: 'finance:read',
      node: givingTrend ? (
        <StatCard
          title="Total Giving"
          value={new Intl.NumberFormat('en-GH', {
            style: 'currency',
            currency: 'GHS',
            maximumFractionDigits: 0,
          }).format(givingTrend.total / 100)}
          icon={<FinanceIcon />}
          change={givingTrend.changePercent ?? undefined}
          changeLabel="vs previous period"
          iconBgColor="success.light"
          iconColor="success.main"
        />
      ) : (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 180 }}>
          <CircularProgress />
        </Box>
      ),
    },
    {
      key: 'engagement',
      requires: 'report:read',
      node: engagement ? (
        <StatCard
          title="Recently Engaged"
          value={String(engagement.engaged)}
          icon={<TrendingUpIcon />}
          change={undefined}
          changeLabel={`in last ${engagement.windowDays} days`}
          iconBgColor="warning.light"
          iconColor="warning.main"
        />
      ) : (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 180 }}>
          <CircularProgress />
        </Box>
      ),
    },
  ].filter((stat) => permissions.has(stat.requires));

  // Convert trend points to chart format, using bucket labels as keys
  const givingChartData = givingTrend?.points.map((point) => ({
    label: point.bucket,
    value: point.value,
  })) ?? [];

  const attendanceChartData = attendanceTrend?.points.map((point) => ({
    label: point.bucket,
    value: point.value,
  })) ?? [];

  const panels: Panel[] = [
    {
      key: 'upcoming-events',
      requires: 'event:read',
      weight: 5,
      body: dataErrors.upcoming ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void loadData()}>
              Retry
            </Button>
          }
        >
          {dataErrors.upcoming}
        </Alert>
      ) : (
        <>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
            Upcoming Events
          </Typography>
          {upcoming.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Nothing scheduled yet.
            </Typography>
          ) : (
            <Stack spacing={1.5}>
              {upcoming.map((event) => (
                <Box key={`${event.id}-${event.startDate}`}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {event.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(event.startDate).toLocaleString([], {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {event.location ? ` · ${event.location}` : ''}
                  </Typography>
                </Box>
              ))}
            </Stack>
          )}
        </>
      ),
    },
    {
      key: 'giving-trends',
      requires: 'finance:read',
      weight: 7,
      body: dataErrors.givingTrend ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void loadData()}>
              Retry
            </Button>
          }
        >
          {dataErrors.givingTrend}
        </Alert>
      ) : givingTrend && givingChartData.length > 0 ? (
        <>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
            Giving Trends
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {givingTrend.grain === 'day'
              ? 'Last 30 days'
              : givingTrend.grain === 'week'
                ? 'Last 12 weeks'
                : 'Last 12 months'}
          </Typography>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={givingChartData}>
              <defs>
                <linearGradient id="givingGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#1976d2" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#1976d2" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" axisLine={false} tickLine={false} fontSize={12} />
              <YAxis
                axisLine={false}
                tickLine={false}
                fontSize={12}
                tickFormatter={(val) => `GHS ${(val / 100000).toFixed(0)}k`}
              />
              <Tooltip
                formatter={(value: unknown) => [
                  // Cedis, not dollars. This chart is the first thing a
                  // pastor sees, and it was labelling Ghanaian giving with a
                  // dollar sign — the amounts were right and the currency
                  // was not, which is the kind of wrong that gets believed.
                  new Intl.NumberFormat('en-GH', {
                    style: 'currency',
                    currency: 'GHS',
                    maximumFractionDigits: 0,
                  }).format(Number(value) / 100),
                  'Giving',
                ]}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#1976d2"
                strokeWidth={2}
                fill="url(#givingGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No giving data available yet.
        </Typography>
      ),
    },
    {
      key: 'attendance-trends',
      requires: 'report:read',
      weight: 5,
      body: dataErrors.attendanceTrend ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void loadData()}>
              Retry
            </Button>
          }
        >
          {dataErrors.attendanceTrend}
        </Alert>
      ) : attendanceTrend && attendanceChartData.length > 0 ? (
        <>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
            Attendance Trends
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {attendanceTrend.grain === 'day'
              ? 'Last 30 days'
              : attendanceTrend.grain === 'week'
                ? 'Last 12 weeks'
                : 'Last 12 months'}
          </Typography>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={attendanceChartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" axisLine={false} tickLine={false} fontSize={12} />
              <YAxis axisLine={false} tickLine={false} fontSize={12} />
              <Tooltip formatter={(value: unknown) => [String(value), 'Attendance']} />
              <Bar dataKey="value" fill="#9c27b0" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No attendance data available yet.
        </Typography>
      ),
    },
    {
      key: 'recent-members',
      requires: 'member:read',
      weight: 7,
      body: dataErrors.members ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void loadData()}>
              Retry
            </Button>
          }
        >
          {dataErrors.members}
        </Alert>
      ) : members.length > 0 ? (
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
                {members.map((member) => (
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
                          {(member.firstName[0] + member.lastName[0]).toUpperCase()}
                        </Avatar>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {member.firstName} {member.lastName}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {member.email ?? '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={member.status}
                        size="small"
                        color={member.status === 'active' ? 'success' : member.status === 'inactive' ? 'default' : 'info'}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {(member.memberSince ?? member.createdAt ?? '').slice(0, 10)}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No members found.
        </Typography>
      ),
    },
  ].filter((panel) => permissions.has(panel.requires));

  // A single surviving panel takes the full row instead of sitting at its
  // declared width with nothing beside it.
  const spanFor = (panel: Panel) => (panels.length === 1 ? 12 : panel.weight);

  if (permissionsLoading) {
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
