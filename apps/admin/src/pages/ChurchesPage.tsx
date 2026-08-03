import { useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
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
  Tooltip,
  Alert,
  Skeleton,
  Drawer,
  Divider,
  Button,
} from "@mui/material";
import {
  CheckCircle,
  Block, CloseRounded, LocationOnRounded, PeopleRounded, WorkspacePremiumRounded,
} from "@mui/icons-material";
import AdminService, { type ChurchRow } from "@/services/admin.service";
import PageIntro from "@/components/ui/PageIntro";

export default function ChurchesPage() {
  const [churches, setChurches] = useState<ChurchRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedChurch, setSelectedChurch] = useState<ChurchRow | null>(null);

  const fetchChurches = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await AdminService.getChurches(page + 1, rowsPerPage);
      setChurches(res.items);
      setTotal(res.pagination.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Churches could not be loaded");
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
      <PageIntro eyebrow="Tenant operations" title="Church network" copy="Review account standing, adoption, plan distribution and church-level commercial activity." action={<Chip label={`${total.toLocaleString()} tenants`} color="primary" />} />
      {error && <Alert severity="error" sx={{ mb: 2.5 }}>Church data is unavailable. {error}</Alert>}

      <Card>
        {loading ? (
          <Box sx={{ p: 2 }}>{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} height={56} sx={{ mb: .5 }} />)}</Box>
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
                    <TableRow key={church.id} hover onClick={() => setSelectedChurch(church)} sx={{ cursor: "pointer" }}>
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
                          label={church.plan?.trim() || "free"}
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
                            onClick={(event) => { event.stopPropagation(); void handleToggleStatus(church); }}
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
      <Drawer anchor="right" open={Boolean(selectedChurch)} onClose={() => setSelectedChurch(null)} slotProps={{ paper: { sx: { width: { xs: "100%", sm: 460 }, bgcolor: "background.paper" } } }}>
        {selectedChurch && <Box><Box sx={{ p: 2.5, display: "flex", justifyContent: "space-between", alignItems: "start", borderBottom: "1px solid", borderColor: "divider" }}><Box><Typography variant="overline" color="primary.main">Tenant record</Typography><Typography variant="h4" sx={{ mt: .8 }}>{selectedChurch.name}</Typography><Typography sx={{ mt: .4, fontSize: ".68rem", color: "text.secondary" }}>{selectedChurch.slug}</Typography></Box><IconButton onClick={() => setSelectedChurch(null)}><CloseRounded /></IconButton></Box><Box sx={{ p: 2.5 }}><Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}><Chip label={selectedChurch.plan?.trim() || "free"} color="primary" /><Chip label={selectedChurch.isActive ? "Active" : "Suspended"} color={selectedChurch.isActive ? "success" : "error"} /></Box><Box sx={{ mt: 2.5, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.2 }}><TenantMetric icon={<PeopleRounded />} label="Members" value={selectedChurch.memberCount.toLocaleString()} /><TenantMetric icon={<WorkspacePremiumRounded />} label="Plan" value={selectedChurch.plan?.trim() || "free"} /><TenantMetric icon={<LocationOnRounded />} label="Location" value={[selectedChurch.city, selectedChurch.country].filter(Boolean).join(", ") || "Not set"} /><TenantMetric icon={<WorkspacePremiumRounded />} label="Revenue" value={`GHS ${(selectedChurch.totalRevenue / 100).toLocaleString()}`} /></Box><Divider sx={{ my: 2.5 }} /><Typography variant="overline" color="text.secondary">Tenant metadata</Typography><Typography sx={{ mt: 1, fontSize: ".72rem", color: "text.secondary" }}>Created {new Date(selectedChurch.createdAt).toLocaleDateString()} · ID {selectedChurch.id}</Typography><Button fullWidth variant="outlined" color={selectedChurch.isActive ? "error" : "success"} startIcon={selectedChurch.isActive ? <Block /> : <CheckCircle />} onClick={() => void handleToggleStatus(selectedChurch)} sx={{ mt: 3 }}>{selectedChurch.isActive ? "Suspend church" : "Reactivate church"}</Button></Box></Box>}
      </Drawer>
    </Box>
  );
}

function TenantMetric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <Box sx={{ p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 1 }}><Box sx={{ color: "primary.main", "& .MuiSvgIcon-root": { fontSize: 18 } }}>{icon}</Box><Typography sx={{ mt: 1, fontSize: ".61rem", color: "text.secondary" }}>{label}</Typography><Typography sx={{ mt: .2, fontSize: ".78rem", fontWeight: 700, overflowWrap: "anywhere" }}>{value}</Typography></Box>;
}
