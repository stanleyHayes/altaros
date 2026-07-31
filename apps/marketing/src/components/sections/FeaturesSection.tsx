import { Box, Container, Typography, Card, CardContent, Grid } from "@mui/material";
import PeopleIcon from "@mui/icons-material/People";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import EventIcon from "@mui/icons-material/Event";
import MessageIcon from "@mui/icons-material/Message";
import AutoStoriesIcon from "@mui/icons-material/AutoStories";
import PsychologyIcon from "@mui/icons-material/Psychology";

const features = [
  {
    icon: <PeopleIcon sx={{ fontSize: 32 }} />,
    title: "Church CRM",
    description:
      "Manage members, families, and departments with a powerful yet intuitive relationship management system.",
    color: "#3F51B5",
    bgColor: "rgba(63,81,181,0.1)",
  },
  {
    icon: <AccountBalanceIcon sx={{ fontSize: 32 }} />,
    title: "Financial Management",
    description:
      "Tithes, offerings, campaigns, and comprehensive financial reports with mobile money integration.",
    color: "#FFB300",
    bgColor: "rgba(255,179,0,0.1)",
  },
  {
    icon: <EventIcon sx={{ fontSize: 32 }} />,
    title: "Events & Attendance",
    description:
      "RSVP management, QR code check-in, and real-time attendance tracking for every service and event.",
    color: "#FF6B6B",
    bgColor: "rgba(255,107,107,0.1)",
  },
  {
    icon: <MessageIcon sx={{ fontSize: 32 }} />,
    title: "Communications",
    description:
      "Reach your congregation via SMS, email, and push notifications with targeted messaging tools.",
    color: "#4CAF50",
    bgColor: "rgba(76,175,80,0.1)",
  },
  {
    icon: <AutoStoriesIcon sx={{ fontSize: 32 }} />,
    title: "Spiritual Growth",
    description:
      "Share devotionals, sermon archives, and manage prayer requests to nurture spiritual development.",
    color: "#9C27B0",
    bgColor: "rgba(156,39,176,0.1)",
  },
  {
    icon: <PsychologyIcon sx={{ fontSize: 32 }} />,
    title: "AI-Powered Insights",
    description:
      "Smart analytics, engagement scoring, and predictive insights to help your church grow effectively.",
    color: "#00BCD4",
    bgColor: "rgba(0,188,212,0.1)",
  },
];

export default function FeaturesSection() {
  return (
    <Box
      id="features"
      sx={{
        py: { xs: 10, md: 14 },
        backgroundColor: "#FFFFFF",
      }}
    >
      <Container maxWidth="lg">
        {/* Section Header */}
        <Box sx={{ textAlign: "center", mb: { xs: 6, md: 8 } }}>
          <Typography
            variant="overline"
            sx={{
              color: "secondary.main",
              fontWeight: 700,
              letterSpacing: "0.15em",
              mb: 1,
              display: "block",
            }}
          >
            Features
          </Typography>
          <Typography variant="h2" sx={{ mb: 2 }}>
            Everything Your Church Needs
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{
              color: "text.secondary",
              maxWidth: 600,
              mx: "auto",
            }}
          >
            One platform to manage every aspect of your ministry — from member
            care to financial stewardship.
          </Typography>
        </Box>

        {/* Features Grid */}
        <Grid container spacing={4}>
          {features.map((feature) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={feature.title}>
              <Card
                sx={{
                  height: "100%",
                  border: "1px solid rgba(0,0,0,0.06)",
                  p: 1,
                }}
              >
                <CardContent sx={{ p: 3 }}>
                  <Box
                    sx={{
                      width: 64,
                      height: 64,
                      borderRadius: "16px",
                      backgroundColor: feature.bgColor,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: feature.color,
                      mb: 3,
                    }}
                  >
                    {feature.icon}
                  </Box>
                  <Typography
                    variant="h5"
                    sx={{ mb: 1.5, fontWeight: 700 }}
                  >
                    {feature.title}
                  </Typography>
                  <Typography
                    variant="body1"
                    sx={{ color: "text.secondary", lineHeight: 1.7 }}
                  >
                    {feature.description}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Container>
    </Box>
  );
}
