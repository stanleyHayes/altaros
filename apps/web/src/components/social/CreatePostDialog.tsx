import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";

const postSchema = z.object({
  content: z.string().min(3, "Write something to share...").max(500, "Post cannot exceed 500 characters"),
  type: z.enum(["general", "testimony", "praise_report"]),
  imageUrl: z.string().url().optional().or(z.literal("")),
});

type PostFormData = z.infer<typeof postSchema>;

interface CreatePostDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: PostFormData) => Promise<void>;
}

export default function CreatePostDialog({
  open,
  onClose,
  onSubmit,
}: CreatePostDialogProps) {
  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<PostFormData>({
    resolver: zodResolver(postSchema),
    defaultValues: { type: "general", imageUrl: "", content: "" },
  });

  const contentValue = watch("content") ?? "";
  const charCount = contentValue.length;
  const MAX_CHARS = 500;
  const charCountColor =
    charCount >= 490 ? "error.main" : charCount >= 450 ? "warning.main" : "text.secondary";

  const handleFormSubmit = async (data: PostFormData) => {
    await onSubmit(data);
    reset();
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Create Post</DialogTitle>
      <DialogContent>
        <Box
          component="form"
          id="create-post-form"
          onSubmit={handleSubmit(handleFormSubmit)}
          noValidate
          sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}
        >
          <Controller
            name="type"
            control={control}
            render={({ field }) => (
              <Box>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1 }}
                >
                  Post type
                </Typography>
                <ToggleButtonGroup
                  value={field.value}
                  exclusive
                  onChange={(_, val) => val && field.onChange(val)}
                  fullWidth
                  size="small"
                >
                  <ToggleButton value="general">General</ToggleButton>
                  <ToggleButton value="testimony">Testimony</ToggleButton>
                  <ToggleButton value="praise_report">Praise</ToggleButton>
                </ToggleButtonGroup>
              </Box>
            )}
          />
          <Box>
            <TextField
              label="What's on your heart?"
              fullWidth
              multiline
              rows={4}
              error={!!errors.content}
              helperText={errors.content?.message}
              slotProps={{ htmlInput: { maxLength: MAX_CHARS } }}
              {...register("content")}
            />
            <Typography
              variant="caption"
              sx={{ display: "block", textAlign: "right", mt: 0.5, color: charCountColor }}
            >
              {charCount}/{MAX_CHARS}
            </Typography>
          </Box>
          <TextField
            label="Image URL (optional)"
            fullWidth
            placeholder="https://..."
            error={!!errors.imageUrl}
            helperText={errors.imageUrl?.message}
            {...register("imageUrl")}
          />
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          type="submit"
          form="create-post-form"
          variant="contained"
          disabled={isSubmitting}
        >
          {isSubmitting ? <CircularProgress size={20} /> : "Post"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
