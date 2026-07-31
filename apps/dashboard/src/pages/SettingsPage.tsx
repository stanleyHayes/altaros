import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import {
  Box,
  Typography,
  Button,
  Grid,
  TextField,
  MenuItem,
  Card,
  CardContent,
  Switch,
  FormControlLabel,
  Divider,
  Chip,
  Avatar,
} from "@mui/material";
import {
  Save as SaveIcon,
  CloudUpload as UploadIcon,
} from "@mui/icons-material";
import { useSnackbar } from "notistack";

const settingsSchema = z.object({
  churchName: z.string().min(1, "Church name is required"),
  slug: z.string().min(1, "Slug is required"),
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  website: z.string().url("Invalid URL").optional().or(z.literal("")),
  timezone: z.string().min(1, "Timezone is required"),
  currency: z.string().min(1, "Currency is required"),
  fiscalYearStart: z.string().min(1, "Fiscal year start is required"),
  defaultLanguage: z.string().min(1, "Language is required"),
  allowPublicRegistration: z.boolean(),
});

type SettingsFormData = z.infer<typeof settingsSchema>;

const mockSettings: SettingsFormData = {
  churchName: "Grace Community Church",
  slug: "grace-community",
  address: "123 Faith Avenue",
  city: "Springfield",
  country: "United States",
  phone: "+1 (555) 123-4567",
  email: "info@gracecommunity.org",
  website: "https://gracecommunity.org",
  timezone: "America/New_York",
  currency: "USD",
  fiscalYearStart: "January",
  defaultLanguage: "en",
  allowPublicRegistration: true,
};

const timezones = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Africa/Lagos",
  "Africa/Nairobi",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Australia/Sydney",
];

const currencies = [
  { value: "USD", label: "USD - US Dollar" },
  { value: "EUR", label: "EUR - Euro" },
  { value: "GBP", label: "GBP - British Pound" },
  { value: "NGN", label: "NGN - Nigerian Naira" },
  { value: "KES", label: "KES - Kenyan Shilling" },
  { value: "ZAR", label: "ZAR - South African Rand" },
  { value: "GHS", label: "GHS - Ghanaian Cedi" },
  { value: "CAD", label: "CAD - Canadian Dollar" },
  { value: "AUD", label: "AUD - Australian Dollar" },
];

const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const languages = [
  { value: "en", label: "English" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "pt", label: "Portuguese" },
  { value: "sw", label: "Swahili" },
  { value: "yo", label: "Yoruba" },
];

export default function SettingsPage() {
  const { enqueueSnackbar } = useSnackbar();

  const {
    control,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    defaultValues: mockSettings,
  });

  const onSubmit = async (data: SettingsFormData) => {
    // TODO: Call API to save settings
    console.log("Settings saved:", data);
    enqueueSnackbar("Settings saved successfully", { variant: "success" });
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
          Settings
        </Typography>
        <Button
          variant="contained"
          startIcon={<SaveIcon />}
          onClick={handleSubmit(onSubmit)}
          disabled={!isDirty}
        >
          Save Changes
        </Button>
      </Box>

      <form onSubmit={handleSubmit(onSubmit)}>
        {/* Church Profile */}
        <Card sx={{ mb: 3 }}>
          <CardContent sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
              Church Profile
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Controller
                  name="churchName"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      fullWidth
                      label="Church Name"
                      error={!!errors.churchName}
                      helperText={errors.churchName?.message}
                    />
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Controller
                  name="slug"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      fullWidth
                      label="Slug"
                      error={!!errors.slug}
                      helperText={errors.slug?.message}
                    />
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <Controller
                  name="address"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      fullWidth
                      label="Address"
                      error={!!errors.address}
                      helperText={errors.address?.message}
                    />
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Controller
                  name="city"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      fullWidth
                      label="City"
                      error={!!errors.city}
                      helperText={errors.city?.message}
                    />
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Controller
                  name="country"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      fullWidth
                      label="Country"
                      error={!!errors.country}
                      helperText={errors.country?.message}
                    />
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Controller
                  name="phone"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      fullWidth
                      label="Phone"
                      error={!!errors.phone}
                      helperText={errors.phone?.message}
                    />
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Controller
                  name="email"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      fullWidth
                      label="Email"
                      error={!!errors.email}
                      helperText={errors.email?.message}
                    />
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <Controller
                  name="website"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      fullWidth
                      label="Website"
                      error={!!errors.website}
                      helperText={errors.website?.message}
                    />
                  )}
                />
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* Logo & Banner Upload */}
        <Card sx={{ mb: 3 }}>
          <CardContent sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
              Branding
            </Typography>
            <Grid container spacing={3}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Church Logo
                </Typography>
                <Box
                  sx={{
                    border: "2px dashed",
                    borderColor: "divider",
                    borderRadius: 2,
                    p: 3,
                    textAlign: "center",
                    cursor: "pointer",
                    "&:hover": { borderColor: "primary.main", bgcolor: "action.hover" },
                  }}
                >
                  <Avatar
                    sx={{ width: 64, height: 64, mx: "auto", mb: 1, bgcolor: "primary.light" }}
                  >
                    GC
                  </Avatar>
                  <Button size="small" startIcon={<UploadIcon />}>
                    Upload Logo
                  </Button>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                    PNG, JPG up to 2MB
                  </Typography>
                </Box>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Banner Image
                </Typography>
                <Box
                  sx={{
                    border: "2px dashed",
                    borderColor: "divider",
                    borderRadius: 2,
                    p: 3,
                    textAlign: "center",
                    cursor: "pointer",
                    height: 120,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    "&:hover": { borderColor: "primary.main", bgcolor: "action.hover" },
                  }}
                >
                  <Button size="small" startIcon={<UploadIcon />}>
                    Upload Banner
                  </Button>
                  <Typography variant="caption" color="text.secondary">
                    Recommended: 1200x400px
                  </Typography>
                </Box>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* General Settings */}
        <Card sx={{ mb: 3 }}>
          <CardContent sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
              General Settings
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Controller
                  name="timezone"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      fullWidth
                      select
                      label="Timezone"
                      error={!!errors.timezone}
                      helperText={errors.timezone?.message}
                    >
                      {timezones.map((tz) => (
                        <MenuItem key={tz} value={tz}>
                          {tz}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Controller
                  name="currency"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      fullWidth
                      select
                      label="Currency"
                      error={!!errors.currency}
                      helperText={errors.currency?.message}
                    >
                      {currencies.map((c) => (
                        <MenuItem key={c.value} value={c.value}>
                          {c.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Controller
                  name="fiscalYearStart"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      fullWidth
                      select
                      label="Fiscal Year Start"
                      error={!!errors.fiscalYearStart}
                      helperText={errors.fiscalYearStart?.message}
                    >
                      {months.map((m) => (
                        <MenuItem key={m} value={m}>
                          {m}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Controller
                  name="defaultLanguage"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      fullWidth
                      select
                      label="Default Language"
                      error={!!errors.defaultLanguage}
                      helperText={errors.defaultLanguage?.message}
                    >
                      {languages.map((l) => (
                        <MenuItem key={l.value} value={l.value}>
                          {l.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <Controller
                  name="allowPublicRegistration"
                  control={control}
                  render={({ field }) => (
                    <FormControlLabel
                      control={
                        <Switch
                          checked={field.value}
                          onChange={field.onChange}
                        />
                      }
                      label="Allow Public Registration"
                    />
                  )}
                />
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", ml: 6 }}>
                  When enabled, new members can register themselves through the public website
                </Typography>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* Subscription Plan */}
        <Card sx={{ mb: 3 }}>
          <CardContent sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
              Subscription Plan
            </Typography>
            <Divider sx={{ mb: 2 }} />
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                Pro Plan
              </Typography>
              <Chip label="Active" color="success" size="small" />
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Includes up to 1,000 members, unlimited events, advanced analytics,
              and priority support.
            </Typography>
            <Box sx={{ display: "flex", gap: 1 }}>
              {["Free", "Basic", "Pro", "Enterprise"].map((plan) => (
                <Chip
                  key={plan}
                  label={plan}
                  variant={plan === "Pro" ? "filled" : "outlined"}
                  color={plan === "Pro" ? "primary" : "default"}
                  size="small"
                />
              ))}
            </Box>
          </CardContent>
        </Card>
      </form>
    </Box>
  );
}
