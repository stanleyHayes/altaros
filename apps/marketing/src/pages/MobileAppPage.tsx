import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Button,
  Grid,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
} from "@mui/material";
import SEO from "@/components/ui/SEO";
import VolunteerActivismIcon from "@mui/icons-material/VolunteerActivism";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import GroupsIcon from "@mui/icons-material/Groups";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import FavoriteIcon from "@mui/icons-material/Favorite";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

const appFeatures = [
  {
    icon: <VolunteerActivismIcon />,
    title: "Mobile Giving",
    description: "Tithe and give offerings securely with mobile money, card, or crypto — in just a few taps.",
  },
  {
    icon: <EventAvailableIcon />,
    title: "Events & RSVP",
    description: "Browse upcoming events, RSVP instantly, and check in via QR code on arrival.",
  },
  {
    icon: <GroupsIcon />,
    title: "Social & Community",
    description: "Stay connected with your church family through groups, announcements, and direct messaging.",
  },
  {
    icon: <MenuBookIcon />,
    title: "Spiritual Content",
    description: "Access daily devotionals, sermon replays, Bible reading plans, and study materials.",
  },
  {
    icon: <FavoriteIcon />,
    title: "Welfare & Care",
    description: "Submit and track prayer requests, welfare needs, and receive pastoral care notifications.",
  },
  {
    icon: <NotificationsActiveIcon />,
    title: "Push Notifications",
    description: "Never miss an important update — receive real-time notifications for services, events, and more.",
  },
];

export default function MobileAppPage() {
  return (
    <>
      <SEO
        title="Mobile App"
        description="The ALTAR OS mobile app for iOS and Android — mobile giving, events, social features, spiritual content, and more for your congregation."
      />

      {/* Hero */}
      <Box
        sx={{
          pt: { xs: 16, md: 20 },
          pb: { xs: 8, md: 12 },
          background:
            "linear-gradient(135deg, #1A1A2E 0%, #3F51B5 40%, #7C4DFF 100%)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse at 30% 50%, rgba(124,77,255,0.3) 0%, transparent 60%)",
            pointerEvents: "none",
          }}
        />
        <Container maxWidth="lg" sx={{ position: "relative", zIndex: 1 }}>
          <Grid container spacing={6} alignItems="center">
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography
                variant="overline"
                sx={{
                  color: "#FFB300",
                  fontWeight: 700,
                  letterSpacing: "0.15em",
                  mb: 1,
                  display: "block",
                }}
              >
                Mobile App
              </Typography>
              <Typography variant="h1" sx={{ color: "#fff", mb: 3 }}>
                Your Church in Your Pocket
              </Typography>
              <Typography
                variant="subtitle1"
                sx={{ color: "rgba(255,255,255,0.85)", mb: 4 }}
              >
                Give, connect, grow, and stay informed — all from the ALTAR OS
                mobile app, available on iOS and Android.
              </Typography>
              <Stack direction="row" spacing={2} flexWrap="wrap">
                {/* App Store badge placeholder */}
                <Box
                  sx={{
                    width: 160,
                    height: 52,
                    borderRadius: 2,
                    backgroundColor: "rgba(255,255,255,0.12)",
                    border: "1px solid rgba(255,255,255,0.25)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    "&:hover": { backgroundColor: "rgba(255,255,255,0.18)" },
                    transition: "background 0.2s",
                  }}
                >
                  <Typography
                    variant="body2"
                    sx={{ color: "#fff", fontWeight: 600, fontSize: "0.8rem" }}
                  >
                    App Store
                  </Typography>
                </Box>
                {/* Google Play badge placeholder */}
                <Box
                  sx={{
                    width: 160,
                    height: 52,
                    borderRadius: 2,
                    backgroundColor: "rgba(255,255,255,0.12)",
                    border: "1px solid rgba(255,255,255,0.25)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    "&:hover": { backgroundColor: "rgba(255,255,255,0.18)" },
                    transition: "background 0.2s",
                  }}
                >
                  <Typography
                    variant="body2"
                    sx={{ color: "#fff", fontWeight: 600, fontSize: "0.8rem" }}
                  >
                    Google Play
                  </Typography>
                </Box>
              </Stack>
              <Typography
                variant="body2"
                sx={{ color: "rgba(255,255,255,0.5)", mt: 2 }}
              >
                Available on iOS and Android
              </Typography>
            </Grid>

            {/* Phone mockup placeholder */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Box
                sx={{
                  width: { xs: 240, md: 280 },
                  height: { xs: 480, md: 560 },
                  mx: "auto",
                  borderRadius: "36px",
                  border: "4px solid rgba(255,255,255,0.2)",
                  backgroundColor: "rgba(255,255,255,0.06)",
                  position: "relative",
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                {/* Notch */}
                <Box
                  sx={{
                    position: "absolute",
                    top: 12,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 100,
                    height: 24,
                    borderRadius: 12,
                    backgroundColor: "rgba(255,255,255,0.1)",
                  }}
                />
                <Typography
                  variant="h6"
                  sx={{ color: "rgba(255,255,255,0.3)", fontWeight: 700 }}
                >
                  ALTAR OS
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ color: "rgba(255,255,255,0.2)" }}
                >
                  App Preview
                </Typography>
              </Box>
            </Grid>
          </Grid>
        </Container>
      </Box>

      {/* Features List */}
      <Box sx={{ py: { xs: 8, md: 12 }, backgroundColor: "#FFFFFF" }}>
        <Container maxWidth="lg">
          <Box sx={{ textAlign: "center", mb: { xs: 6, md: 8 } }}>
            <Typography variant="h2" sx={{ mb: 2 }}>
              Everything at Your Fingertips
            </Typography>
            <Typography
              variant="subtitle1"
              sx={{ color: "text.secondary", maxWidth: 600, mx: "auto" }}
            >
              The ALTAR OS app brings the full power of church management to
              every member's device.
            </Typography>
          </Box>

          <Grid container spacing={4}>
            {appFeatures.map((feature) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={feature.title}>
                <Box sx={{ display: "flex", gap: 2, mb: 2 }}>
                  <Box
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: "12px",
                      backgroundColor: "rgba(63,81,181,0.1)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "primary.main",
                      flexShrink: 0,
                    }}
                  >
                    {feature.icon}
                  </Box>
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
                      {feature.title}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{ color: "text.secondary", lineHeight: 1.7 }}
                    >
                      {feature.description}
                    </Typography>
                  </Box>
                </Box>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>

      {/* Key benefits */}
      <Box sx={{ py: { xs: 8, md: 12 }, backgroundColor: "#F8F9FC" }}>
        <Container maxWidth="md">
          <Typography variant="h3" sx={{ textAlign: "center", mb: 4 }}>
            Why Members Love the App
          </Typography>
          <List>
            {[
              "Give tithes and offerings in seconds with mobile money",
              "Access sermon notes and devotionals offline",
              "Get instant notifications for events and services",
              "Connect with small groups and ministry teams",
              "Submit prayer requests and track responses",
              "View giving history and download statements",
            ].map((item) => (
              <ListItem key={item} disableGutters sx={{ py: 0.75 }}>
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <CheckCircleIcon sx={{ color: "primary.main" }} />
                </ListItemIcon>
                <ListItemText
                  primary={item}
                  primaryTypographyProps={{
                    fontSize: "1.05rem",
                    color: "text.secondary",
                  }}
                />
              </ListItem>
            ))}
          </List>
        </Container>
      </Box>

      {/* CTA */}
      <Box
        sx={{
          py: { xs: 10, md: 14 },
          background:
            "linear-gradient(135deg, #1A1A2E 0%, #3F51B5 40%, #7C4DFF 100%)",
          textAlign: "center",
        }}
      >
        <Container maxWidth="md">
          <Typography
            variant="h2"
            sx={{ color: "#fff", mb: 2, fontWeight: 800 }}
          >
            Get the App Today
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{ color: "rgba(255,255,255,0.8)", mb: 5 }}
          >
            Empower every member of your congregation with the ALTAR OS mobile
            experience.
          </Typography>
          <Button
            component={RouterLink}
            to="/register"
            variant="contained"
            color="secondary"
            size="large"
            sx={{
              px: 6,
              py: 2,
              fontSize: "1.15rem",
              color: "#1A1A2E",
              boxShadow: "0 4px 24px rgba(255,179,0,0.4)",
              "&:hover": {
                boxShadow: "0 6px 32px rgba(255,179,0,0.5)",
                transform: "translateY(-2px)",
              },
              transition: "all 0.3s ease",
            }}
          >
            Start Free Trial
          </Button>
        </Container>
      </Box>
    </>
  );
}
