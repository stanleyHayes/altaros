import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";

const prayerSchema = z.object({
  title: z.string().min(3, "Give your prayer request a title"),
  description: z.string().min(10, "Please describe your prayer request"),
  isAnonymous: z.boolean(),
});

type PrayerFormData = z.infer<typeof prayerSchema>;

interface PrayerRequestFormProps {
  onSubmit: (data: PrayerFormData) => Promise<void>;
}

export default function PrayerRequestForm({ onSubmit }: PrayerRequestFormProps) {
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PrayerFormData>({
    resolver: zodResolver(prayerSchema),
    defaultValues: { isAnonymous: false },
  });

  const handleFormSubmit = async (data: PrayerFormData) => {
    await onSubmit(data);
    reset();
  };

  return (
    <Card>
      <CardContent sx={{ p: 2.5 }}>
        <Typography variant="h6" gutterBottom>
          Submit a Prayer Request
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Share your prayer needs with the church community. We are here for you.
        </Typography>
        <Box
          component="form"
          onSubmit={handleSubmit(handleFormSubmit)}
          noValidate
          sx={{ display: "flex", flexDirection: "column", gap: 2 }}
        >
          <TextField
            label="Title"
            fullWidth
            placeholder="e.g., Healing for my family"
            error={!!errors.title}
            helperText={errors.title?.message}
            {...register("title")}
          />
          <TextField
            label="Description"
            fullWidth
            multiline
            rows={4}
            placeholder="Share the details of your prayer request..."
            error={!!errors.description}
            helperText={errors.description?.message}
            {...register("description")}
          />
          <Controller
            name="isAnonymous"
            control={control}
            render={({ field }) => (
              <FormControlLabel
                control={
                  <Switch
                    checked={field.value}
                    onChange={field.onChange}
                    color="primary"
                  />
                }
                label="Submit anonymously"
              />
            )}
          />
          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={isSubmitting}
          >
            {isSubmitting ? <CircularProgress size={24} /> : "Submit Prayer Request"}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
