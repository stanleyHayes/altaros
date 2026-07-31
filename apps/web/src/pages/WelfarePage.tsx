import { useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Chip from "@mui/material/Chip";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";
import LinearProgress from "@mui/material/LinearProgress";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import { useSnackbar } from "notistack";

// ─── Zod schema ──────────────────────────────────────────────────
const requestSchema = z.object({
  category: z.enum(["financial", "medical", "housing", "food", "counseling", "other"]),
  description: z.string().min(10, "Please provide at least 10 characters"),
  urgency: z.enum(["low", "medium", "high", "critical"]),
  anonymous: z.boolean(),
});

type RequestFormData = z.infer<typeof requestSchema>;

// ─── Mock data ───────────────────────────────────────────────────

// TODO: Replace with WelfareService.getMyRequests()
const mockMyRequests = [
  {
    id: "1",
    category: "financial" as const,
    description: "Need help with rent this month due to unexpected medical bills.",
    urgency: "high" as const,
    anonymous: false,
    status: "approved" as const,
    createdAt: "2026-03-25",
  },
  {
    id: "2",
    category: "food" as const,
    description: "Family of 5 needs food assistance for the next two weeks.",
    urgency: "medium" as const,
    anonymous: true,
    status: "pending" as const,
    createdAt: "2026-03-28",
  },
  {
    id: "3",
    category: "counseling" as const,
    description: "Requesting marriage counseling sessions.",
    urgency: "low" as const,
    anonymous: false,
    status: "fulfilled" as const,
    createdAt: "2026-03-10",
  },
];

// TODO: Replace with WelfareService.getEmergencyAlerts()
const mockEmergencyAlerts = [
  {
    id: "1",
    title: "Severe Weather Warning",
    description: "A severe thunderstorm warning has been issued for our area. Church shelter is open.",
    isActive: true,
    createdAt: "2026-03-29",
  },
  {
    id: "2",
    title: "Community Prayer Vigil",
    description: "Emergency prayer vigil for the Johnson family. Gathering at the church at 7 PM tonight.",
    isActive: false,
    createdAt: "2026-03-27",
  },
];

// TODO: Replace with WelfareService.getVolunteerOpportunities()
const mockVolunteerOpportunities = [
  {
    id: "1",
    title: "Food Bank Distribution",
    description: "Help sort and distribute food packages to families in need.",
    date: "Apr 5, 2026",
    spotsAvailable: 8,
    spotsTotal: 15,
  },
  {
    id: "2",
    title: "Home Repair Ministry",
    description: "Assist with minor home repairs for elderly members of our congregation.",
    date: "Apr 12, 2026",
    spotsAvailable: 3,
    spotsTotal: 10,
  },
  {
    id: "3",
    title: "Hospital Visitation",
    description: "Visit and pray with members who are currently hospitalized.",
    date: "Ongoing",
    spotsAvailable: 5,
    spotsTotal: 5,
  },
  {
    id: "4",
    title: "Youth Mentoring Program",
    description: "Mentor young adults in faith, career guidance, and life skills.",
    date: "Apr 20, 2026",
    spotsAvailable: 12,
    spotsTotal: 20,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────

const statusColorMap: Record<string, "default" | "warning" | "success" | "error" | "info"> = {
  pending: "warning",
  approved: "info",
  fulfilled: "success",
  denied: "error",
  under_review: "default",
  declined: "error",
};

const urgencyColorMap: Record<string, string> = {
  low: "#10B981",
  medium: "#F59E0B",
  high: "#EF4444",
  critical: "#B91C1C",
};

const categoryLabels: Record<string, string> = {
  financial: "Financial",
  medical: "Medical",
  housing: "Housing",
  food: "Food",
  counseling: "Counseling",
  other: "Other",
};

// ─── Component ───────────────────────────────────────────────────

export default function WelfarePage() {
  const [tab, setTab] = useState(0);
  const [volunteerAvailable, setVolunteerAvailable] = useState(false);
  const { enqueueSnackbar } = useSnackbar();

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RequestFormData>({
    resolver: zodResolver(requestSchema),
    defaultValues: {
      category: "financial",
      description: "",
      urgency: "medium",
      anonymous: false,
    },
  });

  const onSubmitRequest = async (data: RequestFormData) => {
    // TODO: Call WelfareService.submitRequest(data)
    console.log("Welfare request submitted:", data);
    enqueueSnackbar("Assistance request submitted successfully", { variant: "success" });
    reset();
  };

  const handleEmergencyAlert = () => {
    // TODO: Call WelfareService.sendEmergencyAlert() with location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          console.log("Emergency alert sent with location:", position.coords);
          enqueueSnackbar("Emergency alert sent. Help is on the way.", { variant: "error" });
        },
        () => {
          console.log("Emergency alert sent without location");
          enqueueSnackbar("Emergency alert sent (location unavailable).", { variant: "warning" });
        },
      );
    } else {
      enqueueSnackbar("Emergency alert sent.", { variant: "error" });
    }
  };

  const handleVolunteerSignUp = (opportunityId: string) => {
    // TODO: Call WelfareService.signUpForVolunteer(opportunityId)
    console.log("Signed up for volunteer opportunity:", opportunityId);
    enqueueSnackbar("You've signed up! We'll be in touch with details.", { variant: "success" });
  };

  return (
    <Box sx={{ py: 2 }}>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 2 }}>
        Welfare &amp; Support
      </Typography>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab label="Request Help" />
        <Tab label="Emergency" />
        <Tab label="Volunteer" />
      </Tabs>

      {/* ── Request Help Tab ─────────────────────────────────── */}
      {tab === 0 && (
        <Box>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Request Assistance
              </Typography>

              <Box
                component="form"
                onSubmit={handleSubmit(onSubmitRequest)}
                sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}
              >
                <Controller
                  name="category"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      select
                      label="Category"
                      error={!!errors.category}
                      helperText={errors.category?.message}
                      fullWidth
                    >
                      <MenuItem value="financial">Financial</MenuItem>
                      <MenuItem value="medical">Medical</MenuItem>
                      <MenuItem value="housing">Housing</MenuItem>
                      <MenuItem value="food">Food</MenuItem>
                      <MenuItem value="counseling">Counseling</MenuItem>
                      <MenuItem value="other">Other</MenuItem>
                    </TextField>
                  )}
                />

                <Controller
                  name="description"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Description"
                      multiline
                      rows={4}
                      placeholder="Please describe your situation and the assistance you need..."
                      error={!!errors.description}
                      helperText={errors.description?.message}
                      fullWidth
                    />
                  )}
                />

                <Controller
                  name="urgency"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      select
                      label="Urgency Level"
                      error={!!errors.urgency}
                      helperText={errors.urgency?.message}
                      fullWidth
                    >
                      <MenuItem value="low">Low - Can wait a few weeks</MenuItem>
                      <MenuItem value="medium">Medium - Within a week</MenuItem>
                      <MenuItem value="high">High - Within 1-2 days</MenuItem>
                      <MenuItem value="critical">Critical - Immediate need</MenuItem>
                    </TextField>
                  )}
                />

                <Controller
                  name="anonymous"
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
                  sx={{ mt: 1 }}
                >
                  {isSubmitting ? "Submitting..." : "Submit Request"}
                </Button>
              </Box>
            </CardContent>
          </Card>

          {/* Past Requests */}
          <Typography variant="h6" sx={{ mb: 2 }}>
            Your Requests
          </Typography>

          {mockMyRequests.map((req) => (
            <Card key={req.id} sx={{ mb: 2 }}>
              <CardContent>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
                  <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                    <Chip
                      label={categoryLabels[req.category]}
                      size="small"
                      variant="outlined"
                    />
                    <Chip
                      label={req.urgency}
                      size="small"
                      sx={{
                        backgroundColor: urgencyColorMap[req.urgency] + "20",
                        color: urgencyColorMap[req.urgency],
                        fontWeight: 600,
                      }}
                    />
                  </Box>
                  <Chip
                    label={req.status}
                    size="small"
                    color={statusColorMap[req.status] || "default"}
                  />
                </Box>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  {req.description}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Submitted: {req.createdAt}
                  {req.anonymous && " (anonymous)"}
                </Typography>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      {/* ── Emergency Tab ────────────────────────────────────── */}
      {tab === 1 && (
        <Box>
          {/* Emergency Contact Card */}
          <Card
            sx={{
              mb: 3,
              background: "linear-gradient(135deg, #6B4C9A 0%, #4A3570 100%)",
              color: "#FFFFFF",
            }}
          >
            <CardContent sx={{ textAlign: "center", py: 4 }}>
              <Typography variant="h6" sx={{ mb: 1 }}>
                Church Emergency Line
              </Typography>
              <Typography variant="h4" fontWeight={700} sx={{ mb: 1 }}>
                (555) 123-4567
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.85 }}>
                Available 24/7 for urgent pastoral care and crisis support
              </Typography>
            </CardContent>
          </Card>

          {/* Send Emergency Alert */}
          <Card sx={{ mb: 3, border: "2px solid #EF4444" }}>
            <CardContent sx={{ textAlign: "center", py: 3 }}>
              <Typography variant="h6" color="error" sx={{ mb: 1 }}>
                Need Immediate Help?
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Send an emergency alert to church leadership. Your location will be shared to help
                responders reach you quickly.
              </Typography>
              <Button
                variant="contained"
                color="error"
                size="large"
                onClick={handleEmergencyAlert}
                sx={{ px: 4 }}
              >
                Send Emergency Alert
              </Button>
            </CardContent>
          </Card>

          <Divider sx={{ my: 3 }} />

          {/* Recent Emergency Alerts */}
          <Typography variant="h6" sx={{ mb: 2 }}>
            Church Alerts
          </Typography>

          {mockEmergencyAlerts.map((alert) => (
            <Alert
              key={alert.id}
              severity={alert.isActive ? "error" : "info"}
              sx={{ mb: 2, borderRadius: 3 }}
            >
              <Typography variant="subtitle2" fontWeight={600}>
                {alert.title}
              </Typography>
              <Typography variant="body2">{alert.description}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
                {alert.createdAt} {alert.isActive ? "- ACTIVE" : ""}
              </Typography>
            </Alert>
          ))}
        </Box>
      )}

      {/* ── Volunteer Tab ────────────────────────────────────── */}
      {tab === 2 && (
        <Box>
          {/* Availability Toggle */}
          <Card sx={{ mb: 3, bgcolor: volunteerAvailable ? "#D1FAE5" : undefined }}>
            <CardContent>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Box>
                  <Typography variant="subtitle1" fontWeight={600}>
                    Volunteer Availability
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {volunteerAvailable
                      ? "You're marked as available to help. Church leaders can match you with needs."
                      : "Toggle on to let the church know you're available to help when needs arise."}
                  </Typography>
                </Box>
                <Switch
                  checked={volunteerAvailable}
                  onChange={(_, v) => {
                    setVolunteerAvailable(v);
                    // TODO: Call WelfareService.updateVolunteerAvailability(v)
                    enqueueSnackbar(
                      v ? "You're now available for volunteer matching" : "Volunteer matching turned off",
                      { variant: "info" },
                    );
                  }}
                  color="success"
                />
              </Box>
            </CardContent>
          </Card>

          {/* Volunteer Opportunities */}
          <Typography variant="h6" sx={{ mb: 2 }}>
            Volunteer Opportunities
          </Typography>

          {mockVolunteerOpportunities.map((opp) => (
            <Card key={opp.id} sx={{ mb: 2 }}>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>
                  {opp.title}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {opp.description}
                </Typography>

                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
                  <Chip label={opp.date} size="small" variant="outlined" />
                  <Typography variant="caption" color="text.secondary">
                    {opp.spotsAvailable} / {opp.spotsTotal} spots left
                  </Typography>
                </Box>

                <LinearProgress
                  variant="determinate"
                  value={((opp.spotsTotal - opp.spotsAvailable) / opp.spotsTotal) * 100}
                  sx={{
                    mb: 2,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: "#E8E4EF",
                    "& .MuiLinearProgress-bar": {
                      backgroundColor: "#6B4C9A",
                      borderRadius: 3,
                    },
                  }}
                />

                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => handleVolunteerSignUp(opp.id)}
                  disabled={opp.spotsAvailable === 0}
                  fullWidth
                >
                  {opp.spotsAvailable === 0 ? "Full" : "Sign Up"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}
    </Box>
  );
}
