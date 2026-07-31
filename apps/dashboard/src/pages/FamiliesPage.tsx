import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  CardActions,
  Chip,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Grid,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Autocomplete,
  CircularProgress,
} from "@mui/material";
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Visibility as ViewIcon,
  Close as CloseIcon,
  FamilyRestroom as FamilyIcon,
} from "@mui/icons-material";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import DataTable, { type Column } from "@/components/ui/DataTable";

const familySchema = z.object({
  familyName: z.string().min(1, "Family name is required"),
  members: z.array(z.string()).min(1, "Select at least one member"),
});

type FamilyFormData = z.infer<typeof familySchema>;

interface FamilyMember {
  id: string;
  name: string;
  relationship: string;
}

interface Family {
  id: string;
  familyName: string;
  headOfHousehold: string;
  members: FamilyMember[];
  [key: string]: unknown;
}

const allMembers = [
  "John Smith",
  "Sarah Smith",
  "Timothy Smith",
  "Rebecca Smith",
  "James Adeyemi",
  "Grace Adeyemi",
  "Samuel Adeyemi",
  "David Okafor",
  "Mercy Okafor",
  "Daniel Okafor",
  "Esther Okafor",
  "Michael Chen",
  "Lisa Chen",
  "Emily Chen",
  "Peter Nwankwo",
  "Joy Nwankwo",
  "Paul Nwankwo",
  "Ruth Adams",
  "Mark Adams",
];

const mockFamilies: Family[] = [
  {
    id: "1",
    familyName: "Smith Family",
    headOfHousehold: "John Smith",
    members: [
      { id: "m1", name: "John Smith", relationship: "Head of Household" },
      { id: "m2", name: "Sarah Smith", relationship: "Spouse" },
      { id: "m3", name: "Timothy Smith", relationship: "Son" },
      { id: "m4", name: "Rebecca Smith", relationship: "Daughter" },
    ],
  },
  {
    id: "2",
    familyName: "Adeyemi Family",
    headOfHousehold: "James Adeyemi",
    members: [
      { id: "m5", name: "James Adeyemi", relationship: "Head of Household" },
      { id: "m6", name: "Grace Adeyemi", relationship: "Spouse" },
      { id: "m7", name: "Samuel Adeyemi", relationship: "Son" },
    ],
  },
  {
    id: "3",
    familyName: "Okafor Family",
    headOfHousehold: "David Okafor",
    members: [
      { id: "m8", name: "David Okafor", relationship: "Head of Household" },
      { id: "m9", name: "Mercy Okafor", relationship: "Spouse" },
      { id: "m10", name: "Daniel Okafor", relationship: "Son" },
      { id: "m11", name: "Esther Okafor", relationship: "Daughter" },
    ],
  },
  {
    id: "4",
    familyName: "Chen Family",
    headOfHousehold: "Michael Chen",
    members: [
      { id: "m12", name: "Michael Chen", relationship: "Head of Household" },
      { id: "m13", name: "Lisa Chen", relationship: "Spouse" },
      { id: "m14", name: "Emily Chen", relationship: "Daughter" },
    ],
  },
  {
    id: "5",
    familyName: "Nwankwo Family",
    headOfHousehold: "Peter Nwankwo",
    members: [
      { id: "m15", name: "Peter Nwankwo", relationship: "Head of Household" },
      { id: "m16", name: "Joy Nwankwo", relationship: "Spouse" },
      { id: "m17", name: "Paul Nwankwo", relationship: "Son" },
    ],
  },
  {
    id: "6",
    familyName: "Adams Family",
    headOfHousehold: "Ruth Adams",
    members: [
      { id: "m18", name: "Ruth Adams", relationship: "Head of Household" },
      { id: "m19", name: "Mark Adams", relationship: "Son" },
    ],
  },
];

export default function FamiliesPage() {
  const [families, setFamilies] = useState<Family[]>(mockFamilies);
  const [formOpen, setFormOpen] = useState(false);
  const [editFamily, setEditFamily] = useState<Family | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Family | null>(null);
  const [viewFamily, setViewFamily] = useState<Family | null>(null);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FamilyFormData>({
    resolver: zodResolver(familySchema),
    defaultValues: { familyName: "", members: [] },
  });

  const openCreate = () => {
    setEditFamily(null);
    reset({ familyName: "", members: [] });
    setFormOpen(true);
  };

  const openEdit = (family: Family) => {
    setEditFamily(family);
    reset({
      familyName: family.familyName,
      members: family.members.map((m) => m.name),
    });
    setFormOpen(true);
  };

  const handleFormSubmit = async (data: FamilyFormData) => {
    if (editFamily) {
      setFamilies((prev) =>
        prev.map((f) =>
          f.id === editFamily.id
            ? {
                ...f,
                familyName: data.familyName,
                headOfHousehold: data.members[0],
                members: data.members.map((name, i) => ({
                  id: `m${Date.now()}-${i}`,
                  name,
                  relationship: i === 0 ? "Head of Household" : "Member",
                })),
              }
            : f,
        ),
      );
    } else {
      const newFamily: Family = {
        id: String(Date.now()),
        familyName: data.familyName,
        headOfHousehold: data.members[0],
        members: data.members.map((name, i) => ({
          id: `m${Date.now()}-${i}`,
          name,
          relationship: i === 0 ? "Head of Household" : "Member",
        })),
      };
      setFamilies((prev) => [...prev, newFamily]);
    }
    setFormOpen(false);
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    setFamilies((prev) => prev.filter((f) => f.id !== deleteTarget.id));
    setDeleteTarget(null);
  };

  const columns: Column<Family>[] = [
    {
      id: "familyName",
      label: "Family Name",
      minWidth: 180,
      render: (row) => (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Avatar sx={{ bgcolor: "primary.light", width: 36, height: 36 }}>
            <FamilyIcon fontSize="small" />
          </Avatar>
          <Typography variant="body2" fontWeight={600}>
            {row.familyName}
          </Typography>
        </Box>
      ),
    },
    { id: "headOfHousehold", label: "Head of Household", minWidth: 160 },
    {
      id: "members",
      label: "Members",
      minWidth: 100,
      render: (row) => (
        <Chip
          label={`${row.members.length} member${row.members.length !== 1 ? "s" : ""}`}
          size="small"
          variant="outlined"
        />
      ),
    },
    {
      id: "id",
      label: "Actions",
      minWidth: 120,
      render: (row) => (
        <Box>
          <Tooltip title="View Details">
            <IconButton size="small" onClick={() => setViewFamily(row)}>
              <ViewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Edit">
            <IconButton size="small" onClick={() => openEdit(row)}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton
              size="small"
              color="error"
              onClick={() => setDeleteTarget(row)}
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
        <Typography variant="h4" fontWeight={700}>
          Families
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          Add Family
        </Button>
      </Box>

      <DataTable
        columns={columns}
        rows={families}
        getRowId={(row) => row.id}
        searchPlaceholder="Search families..."
      />

      {/* Add/Edit Family Dialog */}
      <Dialog open={formOpen} onClose={() => setFormOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle fontWeight={600}>
          {editFamily ? "Edit Family" : "Add Family"}
        </DialogTitle>
        <form onSubmit={handleSubmit(handleFormSubmit)}>
          <DialogContent dividers>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12 }}>
                <Controller
                  name="familyName"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      fullWidth
                      label="Family Name"
                      error={!!errors.familyName}
                      helperText={errors.familyName?.message}
                    />
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <Controller
                  name="members"
                  control={control}
                  render={({ field }) => (
                    <Autocomplete
                      multiple
                      options={allMembers}
                      value={field.value}
                      onChange={(_, newVal) => field.onChange(newVal)}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="Family Members"
                          placeholder="Select members"
                          error={!!errors.members}
                          helperText={
                            errors.members?.message ||
                            "First member selected will be set as Head of Household"
                          }
                        />
                      )}
                    />
                  )}
                />
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button onClick={() => setFormOpen(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={isSubmitting}
              startIcon={isSubmitting ? <CircularProgress size={16} /> : undefined}
            >
              {editFamily ? "Save Changes" : "Add Family"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* View Family Details Dialog */}
      <Dialog open={!!viewFamily} onClose={() => setViewFamily(null)} maxWidth="sm" fullWidth>
        <DialogTitle fontWeight={600}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {viewFamily?.familyName}
            <IconButton size="small" onClick={() => setViewFamily(null)}>
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          {viewFamily && (
            <List>
              {viewFamily.members.map((member) => (
                <ListItem key={member.id}>
                  <ListItemAvatar>
                    <Avatar sx={{ bgcolor: "primary.light" }}>
                      {member.name.charAt(0)}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={member.name}
                    secondary={member.relationship}
                  />
                  {member.relationship === "Head of Household" && (
                    <Chip label="Head" size="small" color="primary" variant="outlined" />
                  )}
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Family"
        message={`Are you sure you want to delete "${deleteTarget?.familyName}"? This action cannot be undone.`}
        confirmLabel="Delete"
        confirmColor="error"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </Box>
  );
}
