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
  Chip,
  Box,
} from "@mui/material";

const messageSchema = z.object({
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Message body is required"),
  type: z.enum(["push", "sms", "email"]),
  targetDepartment: z.string().optional(),
  targetStatus: z.string().optional(),
});

export type ComposeMessageFormData = z.infer<typeof messageSchema>;

interface ComposeMessageDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: ComposeMessageFormData) => Promise<void> | void;
}

const channelOptions = [
  { value: "push", label: "Push Notification", color: "info" as const },
  { value: "sms", label: "SMS", color: "success" as const },
  { value: "email", label: "Email", color: "primary" as const },
];

export default function ComposeMessageDialog({
  open,
  onClose,
  onSubmit,
}: ComposeMessageDialogProps) {
  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ComposeMessageFormData>({
    resolver: zodResolver(messageSchema),
    defaultValues: {
      subject: "",
      body: "",
      type: "push",
      targetDepartment: "",
      targetStatus: "",
    },
  });

  const selectedType = watch("type");

  useEffect(() => {
    if (open) {
      reset({
        subject: "",
        body: "",
        type: "push",
        targetDepartment: "",
        targetStatus: "",
      });
    }
  }, [open, reset]);

  const handleFormSubmit = async (data: ComposeMessageFormData) => {
    await onSubmit(data);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 600 }}>Compose Message</DialogTitle>
      <form onSubmit={handleSubmit(handleFormSubmit)}>
        <DialogContent dividers>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12 }}>
              <Controller
                name="subject"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    label="Subject"
                    error={!!errors.subject}
                    helperText={errors.subject?.message}
                  />
                )}
              />
            </Grid>

            <Grid size={{ xs: 12 }}>
              <Controller
                name="body"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    label="Message"
                    multiline
                    rows={5}
                    error={!!errors.body}
                    helperText={errors.body?.message}
                  />
                )}
              />
            </Grid>

            <Grid size={{ xs: 12 }}>
              <Controller
                name="type"
                control={control}
                render={({ field }) => (
                  <Box>
                    <TextField
                      {...field}
                      fullWidth
                      select
                      label="Channel"
                      error={!!errors.type}
                      helperText={errors.type?.message}
                    >
                      {channelOptions.map((opt) => (
                        <MenuItem key={opt.value} value={opt.value}>
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 1,
                            }}
                          >
                            <Chip
                              label={opt.label}
                              size="small"
                              color={opt.color}
                              variant={
                                selectedType === opt.value
                                  ? "filled"
                                  : "outlined"
                              }
                            />
                          </Box>
                        </MenuItem>
                      ))}
                    </TextField>
                  </Box>
                )}
              />
            </Grid>

            <Grid size={{ xs: 12, sm: 6 }}>
              <Controller
                name="targetDepartment"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    select
                    label="Target Department"
                  >
                    <MenuItem value="">All Departments</MenuItem>
                    <MenuItem value="choir">Choir</MenuItem>
                    <MenuItem value="youth">Youth Ministry</MenuItem>
                    <MenuItem value="ushering">Ushering</MenuItem>
                    <MenuItem value="worship">Worship Team</MenuItem>
                    <MenuItem value="mens">Men&apos;s Fellowship</MenuItem>
                    <MenuItem value="womens">Women&apos;s Fellowship</MenuItem>
                  </TextField>
                )}
              />
            </Grid>

            <Grid size={{ xs: 12, sm: 6 }}>
              <Controller
                name="targetStatus"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    select
                    label="Member Status"
                  >
                    <MenuItem value="">All Members</MenuItem>
                    <MenuItem value="active">Active</MenuItem>
                    <MenuItem value="inactive">Inactive</MenuItem>
                    <MenuItem value="visitor">Visitors</MenuItem>
                  </TextField>
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
            Send Message
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
