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
  Avatar,
  TablePagination,
  Skeleton,
  TextField,
  InputAdornment,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Alert,
  Drawer,
  Divider,
  IconButton,
} from "@mui/material";
import { CloseRounded, EmailRounded, PhoneRounded, Search, VerifiedUserRounded } from "@mui/icons-material";
import AdminService, { type UserRow } from "@/services/admin.service";
import PageIntro from "@/components/ui/PageIntro";

const roleColors: Record<string, "error" | "primary" | "info" | "default"> = {
  SUPER_ADMIN: "error",
  CHURCH_ADMIN: "primary",
  DEPARTMENT_LEADER: "info",
  MEMBER: "default",
};

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [error, setError] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await AdminService.getUsers(
        page + 1,
        rowsPerPage,
        roleFilter || undefined,
        search || undefined,
      );
      setUsers(res.items);
      setTotal(res.pagination.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Users could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, roleFilter, search]);

  useEffect(() => {
    const timer = setTimeout(fetchUsers, 300);
    return () => clearTimeout(timer);
  }, [fetchUsers]);

  return (
    <Box>
      <PageIntro eyebrow="Identity operations" title="Platform users" copy="Search identities across tenants and inspect the roles entrusted with church and platform access." action={<Chip label={`${total.toLocaleString()} identities`} color="primary" />} />
      {error && <Alert severity="error" sx={{ mb: 2.5 }}>User data is unavailable. {error}</Alert>}

      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, mb: 2.5, p: 1.5, border: "1px solid", borderColor: "divider", bgcolor: "background.paper", borderRadius: 1.25 }}>
        <TextField
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          size="small"
          sx={{ width: { xs: "100%", sm: 330 } }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search />
                </InputAdornment>
              ),
            },
          }}
        />
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Role</InputLabel>
          <Select
            value={roleFilter}
            label="Role"
            onChange={(e) => {
              setRoleFilter(e.target.value);
              setPage(0);
            }}
          >
            <MenuItem value="">All Roles</MenuItem>
            <MenuItem value="SUPER_ADMIN">Super Admin</MenuItem>
            <MenuItem value="CHURCH_ADMIN">Church Admin</MenuItem>
            <MenuItem value="DEPARTMENT_LEADER">Dept. Leader</MenuItem>
            <MenuItem value="MEMBER">Member</MenuItem>
          </Select>
        </FormControl>
      </Box>

      <Card>
        {loading ? (
          <Box sx={{ p: 2 }}>{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} height={56} sx={{ mb: .5 }} />)}</Box>
        ) : (
          <>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>User</TableCell>
                    <TableCell>Email</TableCell>
                    <TableCell>Role</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Joined</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id} hover onClick={() => setSelectedUser(user)} sx={{ cursor: "pointer" }}>
                      <TableCell>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                          <Avatar
                            src={user.avatarUrl}
                            sx={{
                              width: 36,
                              height: 36,
                              bgcolor: "primary.light",
                              fontSize: 14,
                            }}
                          >
                            {(user.name ?? "?").charAt(0)}
                          </Avatar>
                          <Typography sx={{ fontWeight: 600 }}>
                            {user.name ?? "—"}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        <Chip
                          label={user.role.replace("_", " ")}
                          size="small"
                          color={roleColors[user.role] ?? "default"}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={user.isActive ? "Active" : "Inactive"}
                          size="small"
                          color={user.isActive ? "success" : "error"}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        {new Date(user.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                  {users.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                        <Typography color="text.secondary">
                          No users found
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
      <Drawer anchor="right" open={Boolean(selectedUser)} onClose={() => setSelectedUser(null)} slotProps={{ paper: { sx: { width: { xs: "100%", sm: 440 }, p: 0, bgcolor: "background.paper" } } }}>
        {selectedUser && <Box><Box sx={{ p: 2.5, display: "flex", justifyContent: "space-between", alignItems: "start", borderBottom: "1px solid", borderColor: "divider" }}><Box><Typography variant="overline" color="primary.main">Identity record</Typography><Typography variant="h4" sx={{ mt: .8 }}>{selectedUser.name || "Unnamed user"}</Typography><Typography sx={{ mt: .5, fontSize: ".7rem", color: "text.secondary" }}>Joined {new Date(selectedUser.createdAt).toLocaleDateString()}</Typography></Box><IconButton onClick={() => setSelectedUser(null)} aria-label="Close user details"><CloseRounded /></IconButton></Box><Box sx={{ p: 2.5 }}><Box sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 2, bgcolor: "rgba(113,215,197,.07)", borderRadius: 1 }}><Avatar variant="rounded" src={selectedUser.avatarUrl} sx={{ width: 52, height: 52, borderRadius: 1, bgcolor: "primary.main", color: "primary.contrastText" }}>{(selectedUser.name || "?").charAt(0)}</Avatar><Box><Chip label={selectedUser.role.replaceAll("_", " ")} color="primary" /><Typography sx={{ mt: .6, fontSize: ".68rem", color: selectedUser.isActive ? "success.main" : "error.main", fontWeight: 700 }}>{selectedUser.isActive ? "Active account" : "Inactive account"}</Typography></Box></Box><Typography variant="overline" sx={{ display: "block", mt: 3, color: "text.secondary" }}>Contact</Typography><DetailRow icon={<EmailRounded />} label="Email" value={selectedUser.email || "Not provided"} /><DetailRow icon={<PhoneRounded />} label="Phone" value={selectedUser.phone || "Not provided"} /><Divider sx={{ my: 2 }} /><Typography variant="overline" sx={{ color: "text.secondary" }}>Access scope</Typography><DetailRow icon={<VerifiedUserRounded />} label="Church tenant" value={selectedUser.churchId || "Platform-wide"} /><DetailRow icon={<VerifiedUserRounded />} label="User ID" value={selectedUser.id} /></Box></Box>}
      </Drawer>
    </Box>
  );
}

function DetailRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <Box sx={{ display: "grid", gridTemplateColumns: "28px 100px minmax(0,1fr)", gap: 1, alignItems: "start", py: 1.3, borderBottom: "1px solid", borderColor: "divider" }}><Box sx={{ color: "primary.main", "& .MuiSvgIcon-root": { fontSize: 17 } }}>{icon}</Box><Typography sx={{ fontSize: ".68rem", color: "text.secondary" }}>{label}</Typography><Typography sx={{ fontSize: ".72rem", fontWeight: 620, overflowWrap: "anywhere" }}>{value}</Typography></Box>;
}
