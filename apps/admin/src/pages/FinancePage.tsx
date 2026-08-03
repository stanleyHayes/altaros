import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Skeleton,
  Chip,
} from '@mui/material';
import { AccountBalanceRounded, TrendingUpRounded } from '@mui/icons-material';
import AdminService, { type ChurchRow } from '@/services/admin.service';
import PageIntro from '@/components/ui/PageIntro';

export default function FinancePage() {
  const [churches, setChurches] = useState<ChurchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalRevenue, setTotalRevenue] = useState(0);

  useEffect(() => {
    Promise.all([AdminService.getChurches(1, 100), AdminService.getStats()])
      .then(([churchRes, statsRes]) => {
        const sorted = churchRes.items.sort((a, b) => b.totalRevenue - a.totalRevenue);
        setChurches(sorted);
        setTotalRevenue(statsRes.totalRevenue);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Box>
        <Skeleton variant="rounded" height={180} />
        <Skeleton variant="rounded" height={360} sx={{ mt: 2 }} />
      </Box>
    );
  }

  return (
    <Box>
      <PageIntro
        eyebrow="Commercial operations"
        title="Platform finance"
        copy="Track recognised platform revenue and understand which church relationships are driving it."
      />

      <Card
        sx={{
          mb: 2.5,
          minHeight: 210,
          position: 'relative',
          overflow: 'hidden',
          isolation: 'isolate',
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          borderColor: 'transparent',
          backgroundImage:
            'radial-gradient(circle at 82% 0%, rgba(255,255,255,.24), transparent 28%)',
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            right: -28,
            bottom: -48,
            zIndex: 0,
            color: '#071B19',
            opacity: 0.1,
            transform: 'rotate(-8deg)',
            pointerEvents: 'none',
            '& .MuiSvgIcon-root': { fontSize: 190 },
          }}
        >
          <AccountBalanceRounded />
        </Box>
        <CardContent
          sx={{
            p: 3,
            position: 'relative',
            zIndex: 1,
            minHeight: 210,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <Box
            sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}
          >
            <Typography variant="overline" sx={{ color: 'rgba(7,27,25,.62)' }}>
              Total Platform Revenue
            </Typography>
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: 1,
                display: 'grid',
                placeItems: 'center',
                bgcolor: 'rgba(7,27,25,.08)',
                border: '1px solid rgba(7,27,25,.12)',
              }}
            >
              <TrendingUpRounded sx={{ fontSize: 20 }} />
            </Box>
          </Box>
          <Typography
            variant="h2"
            sx={{ mt: 1.5, color: 'inherit', fontVariantNumeric: 'tabular-nums' }}
          >
            GHS {(totalRevenue / 100).toLocaleString()}
          </Typography>
        </CardContent>
      </Card>

      <Card>
        <CardContent sx={{ p: 0 }}>
          <Box sx={{ px: 3, py: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Revenue by church
            </Typography>
          </Box>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Church</TableCell>
                  <TableCell>Plan</TableCell>
                  <TableCell align="right">Members</TableCell>
                  <TableCell align="right">Revenue</TableCell>
                  <TableCell align="right">Avg / Member</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {churches.map((church) => (
                  <TableRow key={church.id} hover>
                    <TableCell>
                      <Typography sx={{ fontWeight: 600 }}>{church.name}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={church.plan} size="small" />
                    </TableCell>
                    <TableCell align="right">{church.memberCount.toLocaleString()}</TableCell>
                    <TableCell align="right">
                      ${(church.totalRevenue / 100).toLocaleString()}
                    </TableCell>
                    <TableCell align="right">
                      $
                      {church.memberCount > 0
                        ? (church.totalRevenue / 100 / church.memberCount).toFixed(2)
                        : '0.00'}
                    </TableCell>
                  </TableRow>
                ))}
                {churches.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                      <Typography color="text.secondary">No revenue data</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </Box>
  );
}
