import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Grid,
  MenuItem,
  CircularProgress,
  FormControlLabel,
  Switch,
} from "@mui/material";

const announcementSchema = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().min(1, "Content is required"),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  isPublished: z.boolean(),
  expiresAt: z.string().optional(),
});

export type AnnouncementFormData = z.infer<typeof announcementSchema>;

interface AnnouncementFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: AnnouncementFormData) => Promise<void> | void;
  initialData?: Partial<AnnouncementFormData>;
  isEdit?: boolean;
}

export default function AnnouncementFormDialog({
  open,
  onClose,
  onSubmit,
  initialData,
  isEdit = false,
}: AnnouncementFormDialogProps) {
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AnnouncementFormData>({
    resolver: zodResolver(announcementSchema),
    defaultValues: {
      title: "",
      content: "",
      priority: "normal",
      isPublished: true,
      expiresAt: "",
      ...initialData,
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        title: "",
        content: "",
        priority: "normal",
        isPublished: true,
        expiresAt: "",
        ...initialData,
      });
    }
  }, [open, initialData, reset]);

  const handleFormSubmit = async (data: AnnouncementFormData) => {
    await onSubmit(data);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle fontWeight={600}>
        {isEdit ? "Edit Announcement" : "Create Announcement"}
      </DialogTitle>
      <form onSubmit={handleSubmit(handleFormSubmit)}>
        <DialogContent dividers>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12 }}>
              <Controller
                name="title"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    label="Title"
                    error={!!errors.title}
                    helperText={errors.title?.message}
                  />
                )}
              />
            </Grid>

            <Grid size={{ xs: 12 }}>
              <Controller
                name="content"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    label="Content"
                    multiline
                    rows={5}
                    error={!!errors.content}
                    helperText={errors.content?.message}
                  />
                )}
              />
            </Grid>

            <Grid size={{ xs: 12, sm: 6 }}>
              <Controller
                name="priority"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    select
                    label="Priority"
                    error={!!errors.priority}
                    helperText={errors.priority?.message}
                  >
                    <MenuItem value="low">Low</MenuItem>
                    <MenuItem value="normal">Normal</MenuItem>
                    <MenuItem value="high">High</MenuItem>
                    <MenuItem value="urgent">Urgent</MenuItem>
                  </TextField>
                )}
              />
            </Grid>

            <Grid size={{ xs: 12, sm: 6 }}>
              <Controller
                name="expiresAt"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    label="Expires At (optional)"
                    type="date"
                    slotProps={{ inputLabel: { shrink: true } }}
                    error={!!errors.expiresAt}
                    helperText={errors.expiresAt?.message}
                  />
                )}
              />
            </Grid>

            <Grid size={{ xs: 12 }}>
              <Controller
                name="isPublished"
                control={control}
                render={({ field }) => (
                  <FormControlLabel
                    control={
                      <Switch
                        checked={field.value}
                        onChange={field.onChange}
                      />
                    }
                    label="Publish immediately"
                  />
                )}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={isSubmitting}
            startIcon={
              isSubmitting ? <CircularProgress size={16} /> : undefined
            }
          >
            {isEdit ? "Save Changes" : "Create Announcement"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
