import { useState, useCallback } from "react";
import {
  Box,
  Typography,
  Button,
  Chip,
  IconButton,
  Tooltip,
  MenuItem,
  TextField,
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

// TODO: Replace with real API data from MemberService
const sampleRows: MemberRow[] = [
  {
    id: "1",
    firstName: "John",
    lastName: "Smith",
    email: "john@example.com",
    phone: "(555) 123-4567",
    status: "active",
    memberSince: "2023-01-15",
    dateOfBirth: "1985-06-20",
    address: "123 Main St, Springfield",
    groups: ["Choir", "Ushering"],
  },
  {
    id: "2",
    firstName: "Sarah",
    lastName: "Johnson",
    email: "sarah@example.com",
    phone: "(555) 234-5678",
    status: "active",
    memberSince: "2022-06-20",
    dateOfBirth: "1990-03-15",
    address: "456 Oak Ave, Springfield",
    groups: ["Youth Ministry"],
  },
  {
    id: "3",
    firstName: "Michael",
    lastName: "Williams",
    email: "michael@example.com",
    phone: "(555) 345-6789",
    status: "visitor",
    memberSince: "2024-03-10",
  },
  {
    id: "4",
    firstName: "Grace",
    lastName: "Adekunle",
    email: "grace@example.com",
    phone: "(555) 456-7890",
    status: "active",
    memberSince: "2021-11-02",
    dateOfBirth: "1988-12-25",
    address: "789 Elm Dr, Springfield",
    groups: ["Worship Team", "Women's Fellowship"],
  },
  {
    id: "5",
    firstName: "David",
    lastName: "Okafor",
    email: "david@example.com",
    phone: "(555) 567-8901",
    status: "active",
    memberSince: "2023-08-14",
    groups: ["Men's Fellowship"],
  },
  {
    id: "6",
    firstName: "Emily",
    lastName: "Brown",
    email: "emily@example.com",
    phone: "(555) 678-9012",
    status: "inactive",
    memberSince: "2020-05-30",
  },
  {
    id: "7",
    firstName: "James",
    lastName: "Taylor",
    email: "james@example.com",
    phone: "(555) 789-0123",
    status: "active",
    memberSince: "2024-01-20",
    groups: ["Choir"],
  },
];

export default function MembersPage() {
  const [members, setMembers] = useState<MemberRow[]>(sampleRows);
  const [formOpen, setFormOpen] = useState(false);
  const [editMember, setEditMember] = useState<MemberRow | null>(null);
  const [drawerMember, setDrawerMember] = useState<MemberRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MemberRow | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

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
      // TODO: Call MemberService.create or MemberService.update
      if (editMember) {
        setMembers((prev) =>
          prev.map((m) =>
            m.id === editMember.id ? { ...m, ...data } : m,
          ),
        );
      } else {
        const newMember: MemberRow = {
          id: String(Date.now()),
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email ?? "",
          phone: data.phone ?? "",
          status: data.status,
          memberSince: new Date().toISOString().split("T")[0],
          dateOfBirth: data.dateOfBirth,
          address: data.address,
        };
        setMembers((prev) => [newMember, ...prev]);
      }
    },
    [editMember],
  );

  const handleDelete = useCallback(() => {
    if (!deleteTarget) return;
    // TODO: Call MemberService.remove
    setMembers((prev) => prev.filter((m) => m.id !== deleteTarget.id));
    setDeleteTarget(null);
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
          <Tooltip title="Delete">
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
        title="Delete Member"
        message={`Are you sure you want to delete ${deleteTarget?.firstName} ${deleteTarget?.lastName}? This action cannot be undone.`}
        confirmLabel="Delete"
        confirmColor="error"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </Box>
  );
}
