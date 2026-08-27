import { useState, useCallback, useEffect } from "react";
import {
  Box,
  Typography,
  Button,
  Chip,
  IconButton,
  Tooltip,
  MenuItem,
  TextField,
  Alert,
  CircularProgress,
  Snackbar,
} from "@mui/material";
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Visibility as ViewIcon,
} from "@mui/icons-material";
import DataTable, { type Column } from "@/components/ui/DataTable";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import MemberFormDialog, {
  type MemberFormData,
} from "@/components/members/MemberFormDialog";
import MemberDetailDrawer from "@/components/members/MemberDetailDrawer";
import MemberService, { type Member } from "@/services/member.service";

interface MemberRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: string;
  memberSince: string;
  dateOfBirth?: string;
  address?: string;
  groups?: string[];
  [key: string]: unknown;
}

/**
 * A member as this table renders it.
 *
 * Mapped from the API's Member rather than used directly, because the table
 * wants flat non-optional strings and the wire type has optionals. Doing the
 * narrowing once here keeps every cell from having to guard.
 */
function toRow(m: Member): MemberRow {
  return {
    id: m.id,
    firstName: m.firstName,
    lastName: m.lastName,
    email: m.email ?? "",
    phone: m.phone ?? "",
    status: m.status,
    memberSince: (m.memberSince ?? m.createdAt ?? "").slice(0, 10),
    dateOfBirth: m.dateOfBirth,
    address: m.address,
    groups: m.groups,
  };
}

export default function MembersPage() {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editMember, setEditMember] = useState<MemberRow | null>(null);
  const [drawerMember, setDrawerMember] = useState<MemberRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MemberRow | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setMembers((await MemberService.getAll()).map(toRow));
    } catch {
      // The list stays empty and SAYS so. Falling back to placeholder people
      // here would be worse than an error: a church cannot tell invented
      // members from real ones, and this screen is the roster of record.
      setLoadError("We could not load your members. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredMembers =
    statusFilter === "all"
      ? members
      : members.filter((m) => m.status === statusFilter);

  const handleAdd = useCallback(() => {
    setEditMember(null);
    setFormOpen(true);
  }, []);

  const handleEdit = useCallback((member: MemberRow) => {
    setEditMember(member);
    setFormOpen(true);
  }, []);

  const handleFormSubmit = useCallback(
    async (data: MemberFormData) => {
      try {
        if (editMember) {
          const updated = await MemberService.update(editMember.id, {
            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email,
            phone: data.phone,
            address: data.address,
            dateOfBirth: data.dateOfBirth,
          });
          setMembers((prev) =>
            prev.map((m) => (m.id === updated.id ? toRow(updated) : m)),
          );
          setNotice(`${updated.firstName} ${updated.lastName} updated.`);
        } else {
          const created = await MemberService.create({
            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email,
            phone: data.phone,
            address: data.address,
            dateOfBirth: data.dateOfBirth,
            status: data.status,
          });
          setMembers((prev) => [toRow(created), ...prev]);
          setNotice(`${created.firstName} ${created.lastName} added.`);
        }
        setFormOpen(false);
      } catch {
        // Left open with the values intact — closing the form on failure
        // discards what someone just typed and implies it saved.
        setNotice("That did not save. Please check the details and try again.");
      }
    },
    [editMember],
  );

  /**
   * Take someone off the active roll.
   *
   * Deactivation, not deletion. A church keeps six years of financial records
   * (Act 915 s.28), so a giving history outlives a person's place on the
   * roster; erasure is a data-subject right exercised through the privacy
   * flow, not a row an admin drops from a table. The dialog says so plainly,
   * because the button used to promise a permanent delete it never performed.
   */
  const handleDeactivate = useCallback(async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await MemberService.deactivate(target.id);
      setMembers((prev) =>
        prev.map((m) => (m.id === target.id ? { ...m, status: "inactive" } : m)),
      );
      setNotice(`${target.firstName} ${target.lastName} is now inactive.`);
    } catch {
      setNotice("We could not update that member. Please try again.");
    }
  }, [deleteTarget]);

  const columns: Column<MemberRow>[] = [
    {
      id: "firstName",
      label: "Name",
      minWidth: 180,
      render: (row) => (
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {row.firstName} {row.lastName}
        </Typography>
      ),
    },
    { id: "email", label: "Email", minWidth: 180 },
    { id: "phone", label: "Phone", minWidth: 140 },
    {
      id: "status",
      label: "Status",
      minWidth: 100,
      render: (row) => (
        <Chip
          label={row.status}
          size="small"
          color={
            row.status === "active"
              ? "success"
              : row.status === "inactive"
                ? "default"
                : "info"
          }
        />
      ),
    },
    { id: "memberSince", label: "Join Date", minWidth: 120 },
    {
      id: "actions",
      label: "Actions",
      minWidth: 130,
      sortable: false,
      render: (row) => (
        <Box sx={{ display: "flex", gap: 0.5 }}>
          <Tooltip title="View">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                setDrawerMember(row);
              }}
            >
              <ViewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Edit">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleEdit(row);
              }}
            >
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Mark inactive">
            <IconButton
              size="small"
              color="error"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteTarget(row);
              }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      ),
    },
  ];

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3,
        }}
      >
        <Typography variant="h4" sx={{ fontWeight: 700 }}>
          Members
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleAdd}
        >
          Add Member
        </Button>
      </Box>

      {loadError && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => void load()}>
              Retry
            </Button>
          }
        >
          {loadError}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
      <DataTable
        columns={columns}
        rows={filteredMembers}
        getRowId={(row) => row.id}
        searchPlaceholder="Search members..."
        onRowClick={(row) => setDrawerMember(row)}
        toolbar={
          <TextField
            select
            size="small"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            sx={{ minWidth: 140 }}
            label="Status"
          >
            <MenuItem value="all">All Statuses</MenuItem>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="inactive">Inactive</MenuItem>
            <MenuItem value="visitor">Visitor</MenuItem>
          </TextField>
        }
      />
      )}

      {/* Add / Edit Dialog */}
      <MemberFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleFormSubmit}
        isEdit={!!editMember}
        initialData={
          editMember
            ? {
                firstName: editMember.firstName,
                lastName: editMember.lastName,
                email: editMember.email,
                phone: editMember.phone,
                dateOfBirth: editMember.dateOfBirth,
                address: editMember.address,
                status: editMember.status as "active" | "inactive" | "visitor",
              }
            : undefined
        }
      />

      {/* Detail Drawer */}
      <MemberDetailDrawer
        open={!!drawerMember}
        onClose={() => setDrawerMember(null)}
        member={drawerMember}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Mark member inactive"
        message={
          `${deleteTarget?.firstName} ${deleteTarget?.lastName} will be moved off the ` +
          `active roll. Their giving history is kept — a church must retain six years of ` +
          `financial records — and you can make them active again at any time.`
        }
        confirmLabel="Mark inactive"
        confirmColor="warning"
        onConfirm={() => void handleDeactivate()}
        onCancel={() => setDeleteTarget(null)}
      />

      <Snackbar
        open={!!notice}
        autoHideDuration={5000}
        onClose={() => setNotice(null)}
        message={notice ?? ""}
      />
    </Box>
  );
}
