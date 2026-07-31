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
  Avatar,
  TablePagination,
  CircularProgress,
  TextField,
  InputAdornment,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
} from "@mui/material";
import { Search } from "@mui/icons-material";
import AdminService, { type UserRow } from "@/services/admin.service";

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

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await AdminService.getUsers(
        page + 1,
        rowsPerPage,
        roleFilter || undefined,
        search || undefined,
      );
      setUsers(res.data);
      setTotal(res.pagination.total);
    } catch {
      // ignore
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
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 3 }}>
        Users
      </Typography>

      <Box sx={{ display: "flex", gap: 2, mb: 3 }}>
        <TextField
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          size="small"
          sx={{ width: 300 }}
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
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
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
                    <TableRow key={user.id} hover>
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
    </Box>
  );
}
