import { useState, useEffect } from "react";
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
  CircularProgress,
  Chip,
} from "@mui/material";
import AdminService, { type ChurchRow } from "@/services/admin.service";

export default function FinancePage() {
  const [churches, setChurches] = useState<ChurchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalRevenue, setTotalRevenue] = useState(0);

  useEffect(() => {
    Promise.all([
      AdminService.getChurches(1, 100),
      AdminService.getStats(),
    ])
      .then(([churchRes, statsRes]) => {
        const sorted = churchRes.items.sort(
          (a, b) => b.totalRevenue - a.totalRevenue,
        );
        setChurches(sorted);
        setTotalRevenue(statsRes.totalRevenue);
      })
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
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 3 }}>
        Platform Finance
      </Typography>

      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="body2" color="text.secondary">
            Total Platform Revenue
          </Typography>
          <Typography variant="h3" sx={{ fontWeight: 700, mt: 1 }}>
            ${(totalRevenue / 100).toLocaleString()}
          </Typography>
        </CardContent>
      </Card>

      <Card>
        <CardContent sx={{ p: 0 }}>
          <Box sx={{ px: 3, py: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Revenue by Church
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
                      <Typography sx={{ fontWeight: 600 }}>
                        {church.name}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={church.plan} size="small" />
                    </TableCell>
                    <TableCell align="right">
                      {church.memberCount.toLocaleString()}
                    </TableCell>
                    <TableCell align="right">
                      ${(church.totalRevenue / 100).toLocaleString()}
                    </TableCell>
                    <TableCell align="right">
                      $
                      {church.memberCount > 0
                        ? (
                            church.totalRevenue /
                            100 /
                            church.memberCount
                          ).toFixed(2)
                        : "0.00"}
                    </TableCell>
                  </TableRow>
                ))}
                {churches.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                      <Typography color="text.secondary">
                        No revenue data
                      </Typography>
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
