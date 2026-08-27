import { useState, useCallback, useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ListItemButton from "@mui/material/ListItemButton";
import ListSubheader from "@mui/material/ListSubheader";
import Switch from "@mui/material/Switch";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import Skeleton from "@mui/material/Skeleton";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import NotificationsRoundedIcon from "@mui/icons-material/NotificationsRounded";
import LanguageRoundedIcon from "@mui/icons-material/LanguageRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import VolunteerActivismRoundedIcon from "@mui/icons-material/VolunteerActivismRounded";
import EmailRoundedIcon from "@mui/icons-material/EmailRounded";
import SmsRoundedIcon from "@mui/icons-material/SmsRounded";
import PhoneAndroidRoundedIcon from "@mui/icons-material/PhoneAndroidRounded";
import EventRoundedIcon from "@mui/icons-material/EventRounded";
import CampaignRoundedIcon from "@mui/icons-material/CampaignRounded";
import WarningRoundedIcon from "@mui/icons-material/WarningRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import { useAuth } from "@/hooks/useAuth";
import GivingService from "@/services/giving.service";

/**
 * Format pesewas (minor units) to GHS currency.
 * The API returns all money in pesewas (1 GHS = 100 pesewas).
 */
function formatCurrency(pesewas: number): string {
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    maximumFractionDigits: 0,
  }).format(pesewas / 100);
}

interface NotificationPrefs {
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
  eventReminders: boolean;
  givingReminders: boolean;
  emergencyAlerts: boolean;
  announcements: boolean;
}

const defaultPrefs: NotificationPrefs = {
  emailEnabled: true,
  smsEnabled: true,
  pushEnabled: true,
  eventReminders: true,
  givingReminders: true,
  emergencyAlerts: true,
  announcements: true,
};

export default function ProfilePage() {
  const { user, logout } = useAuth();
  const fullName = user?.name || "Church Member";

  const [prefs, setPrefs] = useState<NotificationPrefs>(defaultPrefs);
  const [snackOpen, setSnackOpen] = useState(false);
  const [givingTotal, setGivingTotal] = useState<number | null>(null);
  const [givingLoading, setGivingLoading] = useState(true);
  const [givingError, setGivingError] = useState(false);

  // Fetch giving history for the year
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const records = await GivingService.getHistory();
        if (cancelled) return;
        // Filter to current year and sum amounts
        const now = new Date();
        const currentYear = now.getFullYear();
        const yearTotal = records
          .filter((r) => {
            const recordYear = new Date(r.date).getFullYear();
            return recordYear === currentYear && r.status === "success";
          })
          .reduce((sum, r) => sum + r.amount, 0);
        setGivingTotal(yearTotal);
      } catch {
        if (!cancelled) setGivingError(true);
      } finally {
        if (!cancelled) setGivingLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggle = useCallback(
    (key: keyof NotificationPrefs) => {
      setPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
    },
    [],
  );

  const handleSavePreferences = useCallback(() => {
    // TODO: Call NotificationService.updatePreferences(prefs)
    setSnackOpen(true);
  }, []);

  const handleSnackClose = useCallback(() => {
    setSnackOpen(false);
  }, []);

  return (
    <Box sx={{ py: 2 }}>
      {/* Profile Header */}
      <Card sx={{ mb: 2 }}>
        <CardContent
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            p: 3,
          }}
        >
          <Avatar
            src={user?.avatarUrl}
            sx={{
              width: 80,
              height: 80,
              bgcolor: "primary.main",
              fontSize: "2rem",
              mb: 1.5,
            }}
          >
            {fullName.charAt(0)}
          </Avatar>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            {fullName}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {user?.email}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {user?.phone}
          </Typography>
          <Button
            variant="outlined"
            size="small"
            startIcon={<EditRoundedIcon />}
          >
            Edit Profile
          </Button>
        </CardContent>
      </Card>

      {/* Groups - Coming Soon */}
      <Typography variant="h6" sx={{ mb: 1 }}>
        My Groups & Departments
      </Typography>
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ p: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Departments and groups will appear here. Coming soon.
          </Typography>
        </CardContent>
      </Card>

      {/* Giving Summary */}
      <Typography variant="h6" sx={{ mb: 1 }}>
        Giving Summary (2026)
      </Typography>
      <Card
        sx={{
          mb: 2,
          background: "linear-gradient(135deg, #6B4C9A 0%, #9B7FCB 100%)",
          color: "white",
          border: "none",
        }}
      >
        <CardContent
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            p: 2.5,
            "&:last-child": { pb: 2.5 },
          }}
        >
          <VolunteerActivismRoundedIcon sx={{ fontSize: 36, opacity: 0.8 }} />
          <Box>
            <Typography variant="body2" sx={{ opacity: 0.8 }}>
              Total this year
            </Typography>
            {givingLoading ? (
              <Skeleton
                variant="text"
                width={120}
                height={40}
                sx={{ bgcolor: "rgba(255, 255, 255, 0.2)" }}
              />
            ) : givingError ? (
              <Typography variant="body2" sx={{ opacity: 0.9 }}>
                Unable to load
              </Typography>
            ) : (
              <Typography variant="h4" sx={{ fontWeight: 700 }}>
                {formatCurrency(givingTotal ?? 0)}
              </Typography>
            )}
          </Box>
        </CardContent>
      </Card>

      {/* Notification Settings */}
      <Typography variant="h6" sx={{ mb: 1 }}>
        Notification Settings
      </Typography>
      <Card sx={{ mb: 2 }}>
        <List disablePadding>
          <ListSubheader sx={{ bgcolor: "transparent", lineHeight: "36px" }}>
            Channels
          </ListSubheader>

          <ListItem
            secondaryAction={
              <Switch
                checked={prefs.emailEnabled}
                onChange={() => handleToggle("emailEnabled")}
                color="primary"
              />
            }
          >
            <ListItemIcon>
              <EmailRoundedIcon />
            </ListItemIcon>
            <ListItemText
              primary="Email Notifications"
              secondary="Receive notifications via email"
            />
          </ListItem>

          <Divider component="li" variant="inset" />

          <ListItem
            secondaryAction={
              <Switch
                checked={prefs.smsEnabled}
                onChange={() => handleToggle("smsEnabled")}
                color="primary"
              />
            }
          >
            <ListItemIcon>
              <SmsRoundedIcon />
            </ListItemIcon>
            <ListItemText
              primary="SMS Notifications"
              secondary="Receive notifications via text message"
            />
          </ListItem>

          <Divider component="li" variant="inset" />

          <ListItem
            secondaryAction={
              <Switch
                checked={prefs.pushEnabled}
                onChange={() => handleToggle("pushEnabled")}
                color="primary"
              />
            }
          >
            <ListItemIcon>
              <PhoneAndroidRoundedIcon />
            </ListItemIcon>
            <ListItemText
              primary="Push Notifications"
              secondary="Receive push notifications on your device"
            />
          </ListItem>

          <Divider component="li" />

          <ListSubheader sx={{ bgcolor: "transparent", lineHeight: "36px" }}>
            Categories
          </ListSubheader>

          <ListItem
            secondaryAction={
              <Switch
                checked={prefs.eventReminders}
                onChange={() => handleToggle("eventReminders")}
                color="primary"
              />
            }
          >
            <ListItemIcon>
              <EventRoundedIcon />
            </ListItemIcon>
            <ListItemText
              primary="Event Reminders"
              secondary="Get reminded about upcoming events you've RSVP'd to"
            />
          </ListItem>

          <Divider component="li" variant="inset" />

          <ListItem
            secondaryAction={
              <Switch
                checked={prefs.givingReminders}
                onChange={() => handleToggle("givingReminders")}
                color="primary"
              />
            }
          >
            <ListItemIcon>
              <VolunteerActivismRoundedIcon />
            </ListItemIcon>
            <ListItemText
              primary="Giving Reminders"
              secondary="Weekly reminders to prepare tithes and offerings"
            />
          </ListItem>

          <Divider component="li" variant="inset" />

          <ListItem
            secondaryAction={
              <Switch
                checked={prefs.emergencyAlerts}
                onChange={() => handleToggle("emergencyAlerts")}
                color="primary"
              />
            }
          >
            <ListItemIcon>
              <WarningRoundedIcon />
            </ListItemIcon>
            <ListItemText
              primary="Emergency Alerts"
              secondary="Critical alerts from your church leadership"
            />
          </ListItem>

          <Divider component="li" variant="inset" />

          <ListItem
            secondaryAction={
              <Switch
                checked={prefs.announcements}
                onChange={() => handleToggle("announcements")}
                color="primary"
              />
            }
          >
            <ListItemIcon>
              <CampaignRoundedIcon />
            </ListItemIcon>
            <ListItemText
              primary="Announcements"
              secondary="General church announcements and updates"
            />
          </ListItem>
        </List>

        <Box sx={{ p: 2, pt: 1 }}>
          <Button
            variant="contained"
            fullWidth
            startIcon={<SaveRoundedIcon />}
            onClick={handleSavePreferences}
          >
            Save Notification Preferences
          </Button>
        </Box>
      </Card>

      {/* Settings */}
      <Typography variant="h6" sx={{ mb: 1 }}>
        Settings
      </Typography>
      <Card>
        <List disablePadding>
          <ListItemButton>
            <ListItemIcon>
              <NotificationsRoundedIcon />
            </ListItemIcon>
            <ListItemText
              primary="Push Notifications"
              secondary="Receive event and announcement alerts"
            />
          </ListItemButton>
          <Divider component="li" />
          <ListItemButton>
            <ListItemIcon>
              <LanguageRoundedIcon />
            </ListItemIcon>
            <ListItemText
              primary="Language"
              secondary="English"
            />
          </ListItemButton>
          <Divider component="li" />
          <ListItemButton
            onClick={logout}
            sx={{ color: "error.main" }}
          >
            <ListItemIcon>
              <LogoutRoundedIcon color="error" />
            </ListItemIcon>
            <ListItemText
              primary="Sign Out"
              slotProps={{ primary: { color: "error" } }}
            />
          </ListItemButton>
        </List>
      </Card>

      {/* Save feedback */}
      <Snackbar
        open={snackOpen}
        autoHideDuration={3000}
        onClose={handleSnackClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={handleSnackClose}
          severity="success"
          variant="filled"
          sx={{ width: "100%" }}
        >
          Notification preferences saved successfully!
        </Alert>
      </Snackbar>
    </Box>
  );
}
