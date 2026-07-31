import { useState, useEffect, useCallback } from "react";
import {
  Box,
  Typography,
  Card,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  TablePagination,
  CircularProgress,
  Tooltip,
} from "@mui/material";
import {
  CheckCircle,
  Block,
} from "@mui/icons-material";
import AdminService, { type ChurchRow } from "@/services/admin.service";

export default function ChurchesPage() {
  const [churches, setChurches] = useState<ChurchRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [loading, setLoading] = useState(true);

  const fetchChurches = useCallback(async () => {
    setLoading(true);
    try {
      const res = await AdminService.getChurches(page + 1, rowsPerPage);
      setChurches(res.data);
      setTotal(res.pagination.total);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage]);

  useEffect(() => {
    fetchChurches();
  }, [fetchChurches]);

  const handleToggleStatus = async (church: ChurchRow) => {
    await AdminService.updateChurchStatus(church.id, !church.isActive);
    fetchChurches();
  };

  const planColors: Record<string, "default" | "info" | "warning" | "success"> = {
    free: "default",
    basic: "info",
    pro: "warning",
    enterprise: "success",
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 3 }}>
        Churches
      </Typography>

      <Card>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Church</TableCell>
                    <TableCell>Location</TableCell>
                    <TableCell>Plan</TableCell>
                    <TableCell align="right">Members</TableCell>
                    <TableCell align="right">Revenue</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {churches.map((church) => (
                    <TableRow key={church.id} hover>
                      <TableCell>
                        <Typography sx={{ fontWeight: 600 }}>
                          {church.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {church.slug}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {church.city}, {church.country}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={church.plan}
                          size="small"
                          color={planColors[church.plan] ?? "default"}
                        />
                      </TableCell>
                      <TableCell align="right">
                        {church.memberCount.toLocaleString()}
                      </TableCell>
                      <TableCell align="right">
                        ${(church.totalRevenue / 100).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={church.isActive ? "Active" : "Suspended"}
                          size="small"
                          color={church.isActive ? "success" : "error"}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell align="center">
                        <Tooltip
                          title={church.isActive ? "Suspend" : "Activate"}
                        >
                          <IconButton
                            size="small"
                            onClick={() => handleToggleStatus(church)}
                            color={church.isActive ? "error" : "success"}
                          >
                            {church.isActive ? <Block /> : <CheckCircle />}
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                  {churches.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                        <Typography color="text.secondary">
                          No churches found
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={total}
              page={page}
              onPageChange={(_, p) => setPage(p)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setPage(0);
              }}
            />
          </>
        )}
      </Card>
    </Box>
  );
}
