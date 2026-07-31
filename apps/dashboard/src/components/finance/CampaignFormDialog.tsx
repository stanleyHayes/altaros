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
  CircularProgress,
  InputAdornment,
} from "@mui/material";

const campaignSchema = z.object({
  name: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  goalAmount: z
    .string()
    .min(1, "Target amount is required")
    .refine(
      (val) => !isNaN(Number(val)) && Number(val) > 0,
      "Must be a positive number",
    ),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().optional(),
});

export type CampaignFormData = z.infer<typeof campaignSchema>;

interface CampaignFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: CampaignFormData) => Promise<void> | void;
  initialData?: Partial<CampaignFormData>;
  isEdit?: boolean;
}

export default function CampaignFormDialog({
  open,
  onClose,
  onSubmit,
  initialData,
  isEdit = false,
}: CampaignFormDialogProps) {
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CampaignFormData>({
    resolver: zodResolver(campaignSchema),
    defaultValues: {
      name: "",
      description: "",
      goalAmount: "",
      startDate: "",
      endDate: "",
      ...initialData,
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        name: "",
        description: "",
        goalAmount: "",
        startDate: "",
        endDate: "",
        ...initialData,
      });
    }
  }, [open, initialData, reset]);

  const handleFormSubmit = async (data: CampaignFormData) => {
    await onSubmit(data);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 600 }}>
        {isEdit ? "Edit Campaign" : "Add Campaign"}
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
                    label="Campaign Title"
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
                name="goalAmount"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    label="Target Amount"
                    error={!!errors.goalAmount}
                    helperText={errors.goalAmount?.message}
                    slotProps={{
                      input: {
                        startAdornment: (
                          <InputAdornment position="start">$</InputAdornment>
                        ),
                      },
                    }}
                  />
                )}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Controller
                name="startDate"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    label="Start Date"
                    type="date"
                    slotProps={{ inputLabel: { shrink: true } }}
                    error={!!errors.startDate}
                    helperText={errors.startDate?.message}
                  />
                )}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Controller
                name="endDate"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    label="End Date (optional)"
                    type="date"
                    slotProps={{ inputLabel: { shrink: true } }}
                    error={!!errors.endDate}
                    helperText={errors.endDate?.message}
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
            {isEdit ? "Save Changes" : "Add Campaign"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
