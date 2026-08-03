import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  MenuItem,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import {
  AccountBalanceRounded,
  AssessmentRounded,
  ChurchRounded,
  CloudQueueRounded,
  DownloadRounded,
  Groups2Rounded,
  HistoryRounded,
  LocationOffRounded,
  MailOutlineRounded,
  ManageAccountsRounded,
  MoneyRounded,
  NotificationsActiveRounded,
  PaymentsRounded,
  PersonOffRounded,
  SecurityRounded,
  StorageRounded,
  SupportAgentRounded,
  TimerRounded,
  WarningAmberRounded,
  WorkspacePremiumRounded,
} from '@mui/icons-material';
import AdminService, {
  type AuditRow,
  type ChurchRow,
  type OperationsSnapshot,
  type PlatformSettingsResponse,
  type PlatformStats,
  type SystemHealth,
  type UserRow,
} from '@/services/admin.service';
import PageIntro from '@/components/ui/PageIntro';

type Module =
  'notifications' | 'reports' | 'access' | 'support' | 'audit' | 'integrations' | 'settings';
const copy: Record<Module, [string, string, string]> = {
  notifications: [
    'Attention routing',
    'Notification operations',
    'Delivery volume, failures and messages waiting for another attempt.',
  ],
  reports: [
    'Governance',
    'Reports and exports',
    'Cross-tenant operating figures and a tenant snapshot you can take into analysis.',
  ],
  access: [
    'Identity governance',
    'Roles and access',
    'See how privileged and member roles are distributed across the platform.',
  ],
  support: [
    'Service operations',
    'Church attention queue',
    'Find suspended tenants and incomplete church records before they become support cases.',
  ],
  audit: [
    'Traceability',
    'Audit trail',
    'Recent sensitive reads and administrative actions across church tenants.',
  ],
  integrations: [
    'Connected services',
    'Integration posture',
    'Runtime and delivery dependencies that keep the platform available.',
  ],
  settings: [
    'Platform policy',
    'Commercial settings',
    'The commission, fee-bearing policy and provider rate cards applied platform-wide.',
  ],
};

export default function ControlModulePage({ module }: { module: Module }) {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [operations, setOperations] = useState<OperationsSnapshot | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [churches, setChurches] = useState<ChurchRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [settings, setSettings] = useState<PlatformSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [commission, setCommission] = useState('');
  const [feeBearer, setFeeBearer] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void Promise.allSettled([
      AdminService.getStats().then(setStats),
      AdminService.getOperations().then(setOperations),
      AdminService.getHealth().then(setHealth),
      AdminService.getChurches(1, 100).then((value) => setChurches(value.items)),
      AdminService.getUsers(1, 100).then((value) => setUsers(value.items)),
      AdminService.getAudit(1, 50).then((value) => setAudit(value.items)),
      AdminService.getPlatformSettings().then((value) => {
        setSettings(value);
        setCommission(String(value.settings.commissionBasisPoints / 100));
        setFeeBearer(value.settings.defaultFeeBearer);
      }),
    ])
      .then((results) => {
        if (results.every((result) => result.status === 'rejected'))
          setError('The platform gateway did not return operational data.');
      })
      .finally(() => setLoading(false));
  }, []);
  const roleCounts = useMemo(
    () =>
      users.reduce<Record<string, number>>((result, user) => {
        result[user.role] = (result[user.role] ?? 0) + 1;
        return result;
      }, {}),
    [users],
  );
  const [eyebrow, title, description] = copy[module];
  if (loading)
    return (
      <Box>
        <Skeleton variant="rounded" height={110} />
        <Grid container spacing={2} sx={{ mt: 2 }}>
          {[0, 1, 2].map((item) => (
            <Grid key={item} size={{ xs: 12, md: 4 }}>
              <Skeleton variant="rounded" height={180} />
            </Grid>
          ))}
        </Grid>
      </Box>
    );
  return (
    <Box>
      <PageIntro eyebrow={eyebrow} title={title} copy={description} />
      {error && (
        <Alert severity="error" sx={{ mb: 2.5 }}>
          {error}
        </Alert>
      )}
      {module === 'notifications' && (
        <>
          <MetricGrid
            items={[
              ['All deliveries', operations?.notificationsTotal ?? 0],
              ['Failed', operations?.notificationsFailed ?? 0],
              ['Queued', operations?.notificationsQueued ?? 0],
            ]}
          />
          <OperationalNote
            title={
              operations?.notificationsFailed
                ? 'Delivery failures need review'
                : 'Delivery queue is clear'
            }
            copy={`${operations?.notificationsQueued ?? 0} messages are queued and ${operations?.notificationsFailed ?? 0} have failed across all church tenants.`}
          />
        </>
      )}
      {module === 'reports' && (
        <>
          <MetricGrid
            items={[
              ['Churches', stats?.totalChurches ?? 0],
              ['Users', stats?.totalUsers ?? 0],
              ['Platform revenue', `GHS ${((stats?.totalRevenue ?? 0) / 100).toLocaleString()}`],
            ]}
          />
          <Card sx={{ mt: 2 }}>
            <CardContent
              sx={{
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                alignItems: { sm: 'center' },
                justifyContent: 'space-between',
                gap: 2,
              }}
            >
              <Box>
                <Typography variant="h5">Tenant snapshot</Typography>
                <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                  Export the currently loaded church directory with plan, standing, members and
                  platform revenue.
                </Typography>
              </Box>
              <Button
                variant="contained"
                startIcon={<DownloadRounded />}
                onClick={() => downloadChurches(churches)}
              >
                Download CSV
              </Button>
            </CardContent>
          </Card>
        </>
      )}
      {module === 'access' && (
        <>
          <MetricGrid
            items={Object.entries(roleCounts).map(([role, count]) => [
              role.replaceAll('_', ' '),
              count,
            ])}
          />
          <DataTable
            heads={['User', 'Role', 'Standing']}
            rows={users
              .slice(0, 12)
              .map((user) => [
                user.name || user.email,
                user.role.replaceAll('_', ' '),
                user.isActive ? 'Active' : 'Inactive',
              ])}
          />
        </>
      )}
      {module === 'support' && (
        <>
          <MetricGrid
            items={[
              ['Suspended churches', operations?.inactiveChurches ?? 0],
              ['Missing location', operations?.churchesMissingLocation ?? 0],
              ['Active churches', stats?.activeChurches ?? 0],
            ]}
          />
          <DataTable
            heads={['Church', 'Issue', 'Plan']}
            rows={churches
              .filter((church) => !church.isActive || !church.city)
              .map((church) => [
                church.name,
                !church.isActive ? 'Suspended' : 'Location incomplete',
                church.plan || 'free',
              ])}
            empty="No church accounts currently need operator attention."
          />
        </>
      )}
      {module === 'audit' && (
        <>
          <MetricGrid
            items={[
              ['Recorded events', operations?.auditEvents ?? 0],
              ['Shown', audit.length],
              ['Coverage', 'Sensitive resources'],
            ]}
          />
          <DataTable
            heads={['When', 'Actor', 'Action', 'Resource']}
            rows={audit.map((event) => [
              new Date(event.createdAt).toLocaleString(),
              event.actorRole || event.actorId,
              event.action,
              `${event.resource}${event.resourceId ? ` · ${event.resourceId}` : ''}`,
            ])}
            empty="No audit events have been recorded."
          />
        </>
      )}
      {module === 'integrations' && (
        <>
          <MetricGrid
            items={[
              ['API', health?.status ?? 'unknown'],
              ['Database', health?.database ?? 'unknown'],
              ['Runtime', health?.nodeVersion ?? 'unknown'],
            ]}
          />
          <DataTable
            heads={['Dependency', 'Responsibility', 'State']}
            rows={[
              [
                'Paystack',
                'Giving and settlements',
                health?.status === 'ok' ? 'Gateway online' : 'Check required',
              ],
              [
                'Arkesel',
                'SMS delivery',
                `${operations?.notificationsFailed ?? 0} failed deliveries`,
              ],
              ['MongoDB', 'Tenant and audit data', health?.database ?? 'unknown'],
            ]}
          />
        </>
      )}
      {module === 'settings' && (
        <>
          {settings ? (
            <>
              <MetricGrid
                items={[
                  ['Commission', `${(settings.settings.commissionBasisPoints / 100).toFixed(2)}%`],
                  ['Default fee bearer', settings.settings.defaultFeeBearer],
                  ['Provider channels', Object.keys(settings.settings.providerFees ?? {}).length],
                ]}
              />
              <Card sx={{ mt: 2 }}>
                <CardContent>
                  <Typography variant="h5">Edit platform policy</Typography>
                  <Typography color="text.secondary" sx={{ mt: 0.8, maxWidth: 800 }}>
                    {settings.note}
                  </Typography>
                  {saved && (
                    <Alert severity="success" sx={{ mt: 2 }}>
                      Platform policy saved.
                    </Alert>
                  )}
                  <Box
                    sx={{
                      mt: 2.5,
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr auto' },
                      gap: 1.5,
                      alignItems: 'start',
                    }}
                  >
                    <TextField
                      label="Commission (%)"
                      type="number"
                      value={commission}
                      onChange={(event) => setCommission(event.target.value)}
                      slotProps={{
                        htmlInput: {
                          min: 0,
                          max: settings.maxCommissionBasisPoints / 100,
                          step: 0.01,
                        },
                      }}
                    />
                    <TextField
                      select
                      label="Default fee bearer"
                      value={feeBearer}
                      onChange={(event) => setFeeBearer(event.target.value)}
                    >
                      <MenuItem value="church">Church</MenuItem>
                      <MenuItem value="giver">Giver</MenuItem>
                    </TextField>
                    <Button
                      variant="contained"
                      disabled={saving || !commission || !feeBearer}
                      onClick={() => void saveSettings()}
                      sx={{ minHeight: 52 }}
                    >
                      {saving ? 'Saving…' : 'Save policy'}
                    </Button>
                  </Box>
                  <DataTable
                    heads={['Channel', 'Rate', 'Flat fee', 'Cap']}
                    rows={Object.entries(settings.settings.providerFees ?? {}).map(
                      ([channel, fee]) => [
                        channel,
                        `${(fee.basisPoints / 100).toFixed(2)}%`,
                        `GHS ${(fee.flatMinor / 100).toFixed(2)}`,
                        `GHS ${(fee.capMinor / 100).toFixed(2)}`,
                      ],
                    )}
                    empty="No provider rate cards have been configured."
                  />
                </CardContent>
              </Card>
            </>
          ) : (
            <Alert severity="warning">Platform settings could not be loaded.</Alert>
          )}
        </>
      )}
    </Box>
  );

  async function saveSettings() {
    const percentage = Number(commission);
    if (
      !Number.isFinite(percentage) ||
      percentage < 0 ||
      percentage * 100 > (settings?.maxCommissionBasisPoints ?? 0)
    ) {
      setError('Enter a commission within the allowed range.');
      return;
    }
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const updated = await AdminService.updatePlatformSettings({
        commissionBasisPoints: Math.round(percentage * 100),
        defaultFeeBearer: feeBearer,
      });
      if (settings) setSettings({ ...settings, settings: updated });
      setSaved(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Platform policy could not be saved.');
    } finally {
      setSaving(false);
    }
  }
}

function MetricGrid({ items }: { items: Array<[string, string | number]> }) {
  return (
    <Grid container spacing={2}>
      {items.map(([label, value], index) => {
        const Icon = metricIcon(label);
        return (
          <Grid
            key={label}
            size={{ xs: 12, sm: 6, md: Math.max(3, 12 / Math.min(items.length, 4)) }}
          >
            <Card
              sx={{
                height: '100%',
                minHeight: 170,
                position: 'relative',
                overflow: 'hidden',
                isolation: 'isolate',
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 2,
                  bgcolor: index === 1 ? 'secondary.main' : 'primary.main',
                  opacity: 0.75,
                },
              }}
            >
              <Box
                aria-hidden
                sx={{
                  position: 'absolute',
                  right: -17,
                  bottom: -27,
                  zIndex: 0,
                  color: index === 1 ? 'secondary.main' : 'primary.main',
                  opacity: 0.065,
                  transform: 'rotate(-8deg)',
                  '& .MuiSvgIcon-root': { fontSize: 126 },
                }}
              >
                <Icon />
              </Box>
              <CardContent sx={{ position: 'relative', zIndex: 1 }}>
                <Box
                  sx={{
                    width: 34,
                    height: 34,
                    borderRadius: 1,
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: index === 1 ? 'rgba(213,180,120,.08)' : 'rgba(113,215,197,.07)',
                    color: index === 1 ? 'secondary.main' : 'primary.main',
                  }}
                >
                  <Icon sx={{ fontSize: 18 }} />
                </Box>
                <Typography
                  variant="overline"
                  color="text.secondary"
                  sx={{ display: 'block', mt: 1.5 }}
                >
                  {label}
                </Typography>
                <Typography
                  sx={{
                    mt: 0.8,
                    fontSize: '1.8rem',
                    fontWeight: 760,
                    letterSpacing: '-.04em',
                    textTransform: 'capitalize',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {value}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        );
      })}
    </Grid>
  );
}
function metricIcon(label: string) {
  const key = label.toLowerCase();
  if (key.includes('notification') || key.includes('deliver')) return NotificationsActiveRounded;
  if (key.includes('failed')) return WarningAmberRounded;
  if (key.includes('queued')) return TimerRounded;
  if (key.includes('church')) return ChurchRounded;
  if (key.includes('user')) return Groups2Rounded;
  if (key.includes('revenue') || key.includes('commission')) return MoneyRounded;
  if (key.includes('role') || key.includes('access') || key.includes('coverage'))
    return ManageAccountsRounded;
  if (key.includes('location')) return LocationOffRounded;
  if (key.includes('suspended') || key.includes('inactive')) return PersonOffRounded;
  if (key.includes('audit') || key.includes('recorded') || key.includes('shown'))
    return HistoryRounded;
  if (key.includes('database')) return StorageRounded;
  if (key.includes('api') || key.includes('runtime')) return CloudQueueRounded;
  if (key.includes('fee')) return PaymentsRounded;
  if (key.includes('provider') || key.includes('plan')) return WorkspacePremiumRounded;
  if (key.includes('support')) return SupportAgentRounded;
  if (key.includes('report')) return AssessmentRounded;
  if (key.includes('mail')) return MailOutlineRounded;
  if (key.includes('security')) return SecurityRounded;
  if (key.includes('account')) return AccountBalanceRounded;
  return AssessmentRounded;
}
function OperationalNote({ title, copy: body }: { title: string; copy: string }) {
  return (
    <Card sx={{ mt: 2, bgcolor: 'rgba(113,215,197,.055)' }}>
      <CardContent>
        <Typography variant="h5">{title}</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.6 }}>
          {body}
        </Typography>
      </CardContent>
    </Card>
  );
}
function DataTable({
  heads,
  rows,
  empty = 'No records match this view.',
}: {
  heads: string[];
  rows: Array<Array<string | number>>;
  empty?: string;
}) {
  return (
    <Card sx={{ mt: 2 }}>
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              {heads.map((head) => (
                <TableCell key={head}>{head}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={`${row[0]}-${index}`} hover>
                {row.map((cell, cellIndex) => (
                  <TableCell key={`${cellIndex}-${cell}`}>{cell}</TableCell>
                ))}
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={heads.length} align="center" sx={{ py: 5 }}>
                  <Typography color="text.secondary">{empty}</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
  );
}
function downloadChurches(churches: ChurchRow[]) {
  const header = [
    'Church',
    'Slug',
    'City',
    'Country',
    'Plan',
    'Status',
    'Members',
    'Platform revenue minor',
  ];
  const rows = churches.map((church) => [
    church.name,
    church.slug,
    church.city,
    church.country,
    church.plan || 'free',
    church.isActive ? 'active' : 'suspended',
    church.memberCount,
    church.totalRevenue,
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
    .join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `altar-os-churches-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
