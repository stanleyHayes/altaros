import { useState, useEffect, useCallback } from "react";
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
  CircularProgress,
  Alert,
} from "@mui/material";
import {
  Save as SaveIcon,
  CloudUpload as UploadIcon,
  ChurchRounded,
  PaletteRounded,
  TuneRounded,
  NotificationsRounded,
  SecurityRounded,
  CreditCardRounded,
} from "@mui/icons-material";
import { useSnackbar } from "notistack";
import ChurchService, { type Church } from "@/services/church.service";

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

const defaultSettings: SettingsFormData = {
  churchName: "",
  slug: "",
  address: "",
  city: "",
  country: "",
  phone: "",
  email: "",
  website: "",
  timezone: "Africa/Accra",
  currency: "GHS",
  fiscalYearStart: "January",
  defaultLanguage: "en",
  allowPublicRegistration: false,
};

const timezones = [
  "Africa/Accra",
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
  { value: "tw", label: "Twi" },
  { value: "ga", label: "Ga" },
  { value: "ee", label: "Ewe" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "pt", label: "Portuguese" },
  { value: "sw", label: "Swahili" },
  { value: "yo", label: "Yoruba" },
];

export default function SettingsPage() {
  const { enqueueSnackbar } = useSnackbar();
  const [currentChurch, setCurrentChurch] = useState<Church | null>(null);
  const [isLoadingChurch, setIsLoadingChurch] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
  } = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    defaultValues: defaultSettings,
  });

  // Load current church settings on mount
  const loadChurch = useCallback(async () => {
    setIsLoadingChurch(true);
    setLoadError(null);
    try {
      const church = await ChurchService.getCurrent();
      setCurrentChurch(church);
      // Populate form with current church data. Fields without backend
      // support (website, fiscalYearStart, defaultLanguage, allowPublicRegistration)
      // are left with placeholder defaults and won't persist.
      reset({
        churchName: church.name,
        slug: church.slug,
        address: church.address || "",
        city: "",
        country: "",
        phone: church.phone || "",
        email: church.email || "",
        website: church.website || "",
        timezone: "Africa/Accra",
        currency: "GHS",
        fiscalYearStart: "January",
        defaultLanguage: "en",
        allowPublicRegistration: false,
      });
    } catch {
      setLoadError("Failed to load church settings. Please refresh the page.");
    } finally {
      setIsLoadingChurch(false);
    }
  }, [reset]);

  useEffect(() => {
    void loadChurch();
  }, [loadChurch]);

  const onSubmit = async (data: SettingsFormData) => {
    if (!currentChurch?.id) {
      enqueueSnackbar("Church information not loaded", { variant: "error" });
      return;
    }

    setIsSaving(true);
    try {
      // Only send fields the Go backend accepts (churchInput struct)
      const updatePayload = {
        name: data.churchName,
        slug: data.slug,
        address: data.address,
        city: data.city,
        country: data.country,
        phone: data.phone,
        email: data.email,
        timezone: data.timezone,
        currency: data.currency,
      };

      const updated = await ChurchService.update(currentChurch.id, updatePayload);
      setCurrentChurch(updated);
      reset(data);
      enqueueSnackbar("Settings saved successfully", { variant: "success" });
    } catch (error) {
      // Keep form open with values intact on error so nothing typed is lost
      const message =
        error instanceof Error
          ? error.message
          : "Failed to save settings. Please try again.";
      enqueueSnackbar(message, { variant: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoadingChurch) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {loadError}
        </Alert>
      )}
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 4,
          p: { xs: 3, md: 4.5 },
          borderRadius: 4,
          bgcolor: "primary.dark",
          color: "white",
          backgroundImage: "radial-gradient(circle at 88% 10%, rgba(109,213,196,.22), transparent 28%)",
        }}
      >
        <Box><Typography variant="overline" sx={{ color: "primary.light" }}>Workspace control</Typography><Typography variant="h3" sx={{ mt: 1, color: "white" }}>Settings that fit your church.</Typography><Typography sx={{ mt: 1.2, color: "rgba(255,255,255,.58)", maxWidth: 600 }}>Identity, member access, communication preferences and plan details in one accountable place.</Typography></Box>
        <Button
          variant="contained"
          startIcon={isSaving ? <CircularProgress size={20} sx={{ color: "primary.dark" }} /> : <SaveIcon />}
          onClick={handleSubmit(onSubmit)}
          disabled={!isDirty || isSaving || isLoadingChurch}
          sx={{ bgcolor: "primary.light", color: "primary.dark", "&:hover": { bgcolor: "#BFEDE5" } }}
        >
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
      </Box>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "220px minmax(0,1fr)" }, gap: { xs: 2, lg: 3.5 }, alignItems: "start" }}>
        <Box component="nav" aria-label="Settings sections" sx={{ position: { lg: "sticky" }, top: { lg: 104 }, p: 1, borderRadius: 1.25, bgcolor: "rgba(251,253,252,.72)", border: "1px solid", borderColor: "divider", display: { xs: "flex", lg: "block" }, overflowX: "auto" }}>
          {[
            { id: "profile", icon: ChurchRounded, label: "Church profile" },
            { id: "branding", icon: PaletteRounded, label: "Branding" },
            { id: "general", icon: TuneRounded, label: "Regional" },
            { id: "notifications", icon: NotificationsRounded, label: "Notifications" },
            { id: "security", icon: SecurityRounded, label: "Security" },
            { id: "plan", icon: CreditCardRounded, label: "Plan & billing" },
          ].map(({ id, icon: Icon, label }) => <Button key={id} href={`#${id}`} startIcon={<Icon />} fullWidth sx={{ justifyContent: "flex-start", color: "text.secondary", whiteSpace: "nowrap", mb: { lg: .4 } }}>{label}</Button>)}
        </Box>
      <form onSubmit={handleSubmit(onSubmit)}>
        {/* Church Profile */}
        <Card id="profile" sx={{ mb: 3, scrollMarginTop: 110 }}>
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
                      helperText={errors.website?.message || "Not yet persisted to backend"}
                      disabled
                    />
                  )}
                />
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* Logo & Banner Upload */}
        <Card id="branding" sx={{ mb: 3, scrollMarginTop: 110 }}>
          <CardContent sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
              Branding
            </Typography>
            <Grid container spacing={3} sx={{ alignItems: "stretch" }}>
              <Grid size={{ xs: 12, md: 6 }} sx={{ display: "flex", flexDirection: "column" }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Church Logo
                </Typography>
                <Box
                  sx={{
                    border: "2px dashed",
                    borderColor: "divider",
                    borderRadius: 1.25,
                    p: 2.5,
                    minHeight: 210,
                    flex: 1,
                    textAlign: "center",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
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
              <Grid size={{ xs: 12, md: 6 }} sx={{ display: "flex", flexDirection: "column" }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Banner Image
                </Typography>
                <Box
                  sx={{
                    border: "2px dashed",
                    borderColor: "divider",
                    borderRadius: 1.25,
                    p: 2.5,
                    textAlign: "center",
                    cursor: "pointer",
                    minHeight: 210,
                    flex: 1,
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
        <Card id="general" sx={{ mb: 3, scrollMarginTop: 110 }}>
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
                      helperText={errors.fiscalYearStart?.message || "Not yet persisted to backend"}
                      disabled
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
                      helperText={errors.defaultLanguage?.message || "Not yet persisted to backend"}
                      disabled
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
                          disabled
                        />
                      }
                      label="Allow Public Registration"
                    />
                  )}
                />
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", ml: 6 }}>
                  When enabled, new members can register themselves through the public website
                </Typography>
                <Typography variant="caption" color="error" sx={{ display: "block", ml: 6 }}>
                  Not yet persisted to backend
                </Typography>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        <Card id="notifications" sx={{ mb: 3, scrollMarginTop: 110 }}>
          <CardContent>
            <Typography variant="overline" color="primary.main">Attention routing</Typography>
            <Typography variant="h5" sx={{ mt: 1 }}>Notifications</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: .8, mb: 2.5 }}>Choose which operational moments should interrupt church administrators.</Typography>
            {[['Member care alerts', 'Follow-ups, welfare escalations and prayer assignments'], ['Finance activity', 'Completed gifts, failed charges and settlement updates'], ['Event operations', 'RSVP milestones, capacity warnings and check-in issues']].map(([title, copy], index) => <Box key={title} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, py: 1.6, borderTop: index ? "1px solid" : 0, borderColor: "divider" }}><Box><Typography sx={{ fontWeight: 650 }}>{title}</Typography><Typography variant="caption" color="text.secondary">{copy}</Typography></Box><Switch defaultChecked={index !== 2} slotProps={{ input: { 'aria-label': title } }} /></Box>)}
          </CardContent>
        </Card>

        <Card id="security" sx={{ mb: 3, scrollMarginTop: 110 }}>
          <CardContent>
            <Typography variant="overline" color="primary.main">Access posture</Typography>
            <Typography variant="h5" sx={{ mt: 1 }}>Security & sessions</Typography>
            <Box sx={{ mt: 2.5, display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1.5 }}>
              <Box sx={{ p: 2, borderRadius: 1, bgcolor: "background.default" }}><Typography sx={{ fontWeight: 650 }}>Two-step verification</Typography><Typography variant="caption" color="text.secondary">Require a second proof for administrative accounts.</Typography><Box sx={{ mt: 1.5 }}><Button variant="outlined" size="small">Configure</Button></Box></Box>
              <Box sx={{ p: 2, borderRadius: 1, bgcolor: "background.default" }}><Typography sx={{ fontWeight: 650 }}>Active sessions</Typography><Typography variant="caption" color="text.secondary">Review devices currently signed into this workspace.</Typography><Box sx={{ mt: 1.5 }}><Button variant="outlined" size="small">Review sessions</Button></Box></Box>
            </Box>
          </CardContent>
        </Card>

        {/* Subscription Plan */}
        <Card id="plan" sx={{ mb: 3, minWidth: 0, overflow: "hidden", scrollMarginTop: 110, bgcolor: "#0B2E2A", color: "white", borderColor: "transparent" }}>
          <CardContent sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
              Subscription Plan
            </Typography>
            <Divider sx={{ mb: 2, borderColor: "rgba(255,255,255,.18)" }} />
            <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.25, mb: 2 }}>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                Pro Plan
              </Typography>
              <Chip label="Active" color="success" size="small" sx={{ bgcolor: "#BFE8D2 !important", color: "#124C35 !important" }} />
            </Box>
            <Typography variant="body2" sx={{ color: "rgba(255,255,255,.68)", mb: 2.5, maxWidth: 680, overflowWrap: "anywhere" }}>
              Includes up to 1,000 members, unlimited events, advanced analytics,
              and priority support.
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
              {["Free", "Basic", "Pro", "Enterprise"].map((plan) => (
                <Chip
                  key={plan}
                  label={plan}
                  variant={plan === "Pro" ? "filled" : "outlined"}
                  color={plan === "Pro" ? "primary" : "default"}
                  size="small"
                  sx={plan === "Pro"
                    ? {
                      bgcolor: "#6DD5C4 !important",
                      color: "#0B2E2A !important",
                      "& .MuiChip-label": { color: "#0B2E2A !important" },
                    }
                    : {
                      borderColor: "rgba(225,241,237,.48) !important",
                      color: "#E1EEEB !important",
                      bgcolor: "transparent !important",
                      "& .MuiChip-label": { color: "#E1EEEB !important", opacity: 1 },
                    }}
                />
              ))}
            </Box>
          </CardContent>
        </Card>
      </form>
      </Box>
    </Box>
  );
}
