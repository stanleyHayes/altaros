import { useState, useEffect, useCallback } from "react";
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
import FormControlLabel from "@mui/material/FormControlLabel";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import Switch from "@mui/material/Switch";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import { useSnackbar } from "notistack";
import PageIntro from "@/components/ui/PageIntro";
import WelfareService, { WelfareRequest } from "@/services/welfare.service";
import { ApiError } from "@/services/api";

// ─── Zod schema ──────────────────────────────────────────────────
const requestSchema = z.object({
  category: z.enum(["financial", "medical", "housing", "food", "counseling", "other"]),
  description: z.string().min(10, "Please provide at least 10 characters"),
  urgency: z.enum(["low", "medium", "high", "critical"]),
  anonymous: z.boolean(),
});

type RequestFormData = z.infer<typeof requestSchema>;

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Format a welfare request's createdAt date. The API returns ISO 8601,
 * but we need a human-readable format for display.
 */
function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

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
  const [myRequests, setMyRequests] = useState<WelfareRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [sendingAlert, setSendingAlert] = useState(false);
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

  const loadMyRequests = useCallback(async () => {
    try {
      setLoadingRequests(true);
      setRequestsError(null);
      const requests = await WelfareService.getMyRequests();
      // Response is a bare array
      setMyRequests(Array.isArray(requests) ? requests : []);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Failed to load your requests";
      setRequestsError(message);
      enqueueSnackbar(message, { variant: "error" });
    } finally {
      setLoadingRequests(false);
    }
  }, [enqueueSnackbar]);

  // Load my requests when tab 0 is selected
  useEffect(() => {
    if (tab === 0 && myRequests.length === 0 && !loadingRequests) {
      loadMyRequests();
    }
  }, [tab, myRequests.length, loadingRequests, loadMyRequests]);

  const onSubmitRequest = async (data: RequestFormData) => {
    try {
      const newRequest = await WelfareService.submitRequest(data);
      setMyRequests((prev) => [newRequest, ...prev]);
      enqueueSnackbar("Assistance request submitted successfully. Your church is standing with you.", {
        variant: "success",
      });
      reset();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Failed to submit request";
      enqueueSnackbar(message, { variant: "error" });
    }
  };

  const handleEmergencyAlert = async () => {
    try {
      setSendingAlert(true);
      let latitude: number | undefined;
      let longitude: number | undefined;

      // Try to get geolocation if available
      if (navigator.geolocation) {
        const position = await new Promise<GeolocationCoordinates>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve(pos.coords),
            () => reject(new Error("Location not available"))
          );
        }).catch(() => null);

        if (position) {
          latitude = position.latitude;
          longitude = position.longitude;
        }
      }

      await WelfareService.sendEmergencyAlert({ latitude, longitude });
      enqueueSnackbar("Emergency alert sent. Help is on the way.", { variant: "error" });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Failed to send emergency alert";
      enqueueSnackbar(message, { variant: "error" });
    } finally {
      setSendingAlert(false);
    }
  }

  return (
    <Box sx={{ py: 2 }}>
      <PageIntro eyebrow="Care & welfare" title="You do not have to carry it alone" copy="Ask for practical support, reach the emergency team or volunteer to care for someone else." />

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab label="Request Help" />
        <Tab label="Emergency" />
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

          {loadingRequests && <CircularProgress />}
          {requestsError && (
            <Alert severity="error" onClose={() => setRequestsError(null)}>
              {requestsError}
            </Alert>
          )}
          {!loadingRequests && myRequests.length === 0 && !requestsError && (
            <Alert severity="info">You haven't submitted any assistance requests yet.</Alert>
          )}

          {myRequests.map((req) => (
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
                  Submitted: {formatDate(req.createdAt)}
                  {req.isAnonymous && " (anonymous)"}
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
              <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
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
                disabled={sendingAlert}
                sx={{ px: 4 }}
              >
                {sendingAlert ? "Sending..." : "Send Emergency Alert"}
              </Button>
            </CardContent>
          </Card>
        </Box>
      )}
    </Box>
  );
}
