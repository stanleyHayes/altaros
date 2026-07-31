import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import {
  Box,
  Typography,
  Button,
  Grid,
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
  MenuItem,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Avatar,
  CircularProgress,
} from "@mui/material";
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  People as PeopleIcon,
  Close as CloseIcon,
} from "@mui/icons-material";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

const departmentSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  leader: z.string().min(1, "Leader is required"),
});

type DepartmentFormData = z.infer<typeof departmentSchema>;

interface Department {
  id: string;
  name: string;
  description: string;
  leader: string;
  memberCount: number;
  status: "active" | "inactive";
  members: { id: string; name: string; role: string }[];
}

const mockLeaders = [
  "Pastor James Adeyemi",
  "Sarah Johnson",
  "Michael Chen",
  "Grace Okonkwo",
  "David Williams",
  "Emily Brown",
  "Daniel Okafor",
  "Lisa Thompson",
];

const mockDepartments: Department[] = [
  {
    id: "1",
    name: "Choir",
    description: "Worship and music ministry leading congregational praise",
    leader: "Sarah Johnson",
    memberCount: 25,
    status: "active",
    members: [
      { id: "m1", name: "Sarah Johnson", role: "Director" },
      { id: "m2", name: "David Williams", role: "Pianist" },
      { id: "m3", name: "Lisa Chen", role: "Vocalist" },
      { id: "m4", name: "James Taylor", role: "Vocalist" },
      { id: "m5", name: "Rachel Green", role: "Drummer" },
    ],
  },
  {
    id: "2",
    name: "Youth",
    description: "Ministry for young people ages 13-25, fostering spiritual growth",
    leader: "Michael Chen",
    memberCount: 40,
    status: "active",
    members: [
      { id: "m6", name: "Michael Chen", role: "Youth Pastor" },
      { id: "m7", name: "Emily Brown", role: "Coordinator" },
      { id: "m8", name: "Alex Peters", role: "Mentor" },
    ],
  },
  {
    id: "3",
    name: "Ushering",
    description: "Welcoming and seating guests, maintaining order during services",
    leader: "Daniel Okafor",
    memberCount: 18,
    status: "active",
    members: [
      { id: "m9", name: "Daniel Okafor", role: "Head Usher" },
      { id: "m10", name: "Ruth Adams", role: "Usher" },
      { id: "m11", name: "Peter Nwankwo", role: "Usher" },
    ],
  },
  {
    id: "4",
    name: "Media",
    description: "Audio/visual, social media, live streaming, and content creation",
    leader: "David Williams",
    memberCount: 12,
    status: "active",
    members: [
      { id: "m12", name: "David Williams", role: "Director" },
      { id: "m13", name: "Kevin Park", role: "Sound Engineer" },
      { id: "m14", name: "Amy Watson", role: "Camera Operator" },
    ],
  },
  {
    id: "5",
    name: "Prayer Warriors",
    description: "Dedicated intercessory prayer ministry and prayer chain coordination",
    leader: "Grace Okonkwo",
    memberCount: 30,
    status: "active",
    members: [
      { id: "m15", name: "Grace Okonkwo", role: "Coordinator" },
      { id: "m16", name: "Martha Obi", role: "Prayer Leader" },
      { id: "m17", name: "Samuel Eze", role: "Member" },
    ],
  },
  {
    id: "6",
    name: "Women's Ministry",
    description: "Empowering women through Bible study, fellowship, and outreach",
    leader: "Lisa Thompson",
    memberCount: 35,
    status: "active",
    members: [
      { id: "m18", name: "Lisa Thompson", role: "President" },
      { id: "m19", name: "Mary Adebayo", role: "Vice President" },
      { id: "m20", name: "Joy Nnadi", role: "Secretary" },
    ],
  },
];

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>(mockDepartments);
  const [formOpen, setFormOpen] = useState(false);
  const [editDept, setEditDept] = useState<Department | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);
  const [viewDept, setViewDept] = useState<Department | null>(null);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<DepartmentFormData>({
    resolver: zodResolver(departmentSchema),
    defaultValues: { name: "", description: "", leader: "" },
  });

  const openCreate = () => {
    setEditDept(null);
    reset({ name: "", description: "", leader: "" });
    setFormOpen(true);
  };

  const openEdit = (dept: Department) => {
    setEditDept(dept);
    reset({ name: dept.name, description: dept.description, leader: dept.leader });
    setFormOpen(true);
  };

  const handleFormSubmit = async (data: DepartmentFormData) => {
    if (editDept) {
      setDepartments((prev) =>
        prev.map((d) =>
          d.id === editDept.id
            ? { ...d, name: data.name, description: data.description || "", leader: data.leader }
            : d,
        ),
      );
    } else {
      const newDept: Department = {
        id: String(Date.now()),
        name: data.name,
        description: data.description || "",
        leader: data.leader,
        memberCount: 0,
        status: "active",
        members: [],
      };
      setDepartments((prev) => [...prev, newDept]);
    }
    setFormOpen(false);
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    setDepartments((prev) => prev.filter((d) => d.id !== deleteTarget.id));
    setDeleteTarget(null);
  };

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
          Departments
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          Add Department
        </Button>
      </Box>

      <Grid container spacing={3}>
        {departments.map((dept) => (
          <Grid key={dept.id} size={{ xs: 12, sm: 6, md: 4 }}>
            <Card
              sx={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                transition: "box-shadow 0.2s",
                "&:hover": { boxShadow: 6 },
              }}
            >
              <CardContent sx={{ flexGrow: 1, p: 3 }}>
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    mb: 1.5,
                  }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {dept.name}
                  </Typography>
                  <Chip
                    label={dept.status}
                    size="small"
                    color={dept.status === "active" ? "success" : "default"}
                  />
                </Box>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{
                    mb: 2,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {dept.description}
                </Typography>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  <strong>Leader:</strong> {dept.leader}
                </Typography>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <PeopleIcon sx={{ fontSize: 16, color: "text.secondary" }} />
                  <Typography variant="body2" color="text.secondary">
                    {dept.memberCount} members
                  </Typography>
                </Box>
              </CardContent>
              <CardActions sx={{ px: 2, pb: 2, pt: 0, justifyContent: "flex-end" }}>
                <Tooltip title="View Members">
                  <IconButton size="small" onClick={() => setViewDept(dept)}>
                    <PeopleIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Edit">
                  <IconButton size="small" onClick={() => openEdit(dept)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Delete">
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => setDeleteTarget(dept)}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Add/Edit Department Dialog */}
      <Dialog open={formOpen} onClose={() => setFormOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 600 }}>
          {editDept ? "Edit Department" : "Add Department"}
        </DialogTitle>
        <form onSubmit={handleSubmit(handleFormSubmit)}>
          <DialogContent dividers>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12 }}>
                <Controller
                  name="name"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      fullWidth
                      label="Department Name"
                      error={!!errors.name}
                      helperText={errors.name?.message}
                    />
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <Controller
                  name="description"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      fullWidth
                      label="Description"
                      multiline
                      rows={3}
                      error={!!errors.description}
                      helperText={errors.description?.message}
                    />
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <Controller
                  name="leader"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      fullWidth
                      select
                      label="Leader"
                      error={!!errors.leader}
                      helperText={errors.leader?.message}
                    >
                      {mockLeaders.map((name) => (
                        <MenuItem key={name} value={name}>
                          {name}
                        </MenuItem>
                      ))}
                    </TextField>
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
              {editDept ? "Save Changes" : "Add Department"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* View Members Dialog */}
      <Dialog open={!!viewDept} onClose={() => setViewDept(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 600 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {viewDept?.name} Members
            <IconButton size="small" onClick={() => setViewDept(null)}>
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          {viewDept && viewDept.members.length > 0 ? (
            <List>
              {viewDept.members.map((member) => (
                <ListItem key={member.id}>
                  <ListItemAvatar>
                    <Avatar sx={{ bgcolor: "primary.light" }}>
                      {member.name.charAt(0)}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText primary={member.name} secondary={member.role} />
                </ListItem>
              ))}
            </List>
          ) : (
            <Typography color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
              No members in this department yet.
            </Typography>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Department"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        confirmColor="error"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </Box>
  );
}
