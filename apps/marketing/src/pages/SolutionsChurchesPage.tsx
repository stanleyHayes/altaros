import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Button,
  Grid,
  Card,
  CardContent,
} from "@mui/material";
import SEO from "@/components/ui/SEO";
import PeopleIcon from "@mui/icons-material/People";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import EventIcon from "@mui/icons-material/Event";
import MessageIcon from "@mui/icons-material/Message";
import VolunteerActivismIcon from "@mui/icons-material/VolunteerActivism";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";

const churchFeatures = [
  {
    icon: <PeopleIcon sx={{ fontSize: 36 }} />,
    title: "Member Management",
    description:
      "Maintain comprehensive member profiles, track attendance, manage families and households, and organize departments and ministries.",
    color: "#3F51B5",
    bgColor: "rgba(63,81,181,0.1)",
  },
  {
    icon: <AccountBalanceIcon sx={{ fontSize: 36 }} />,
    title: "Financial Stewardship",
    description:
      "Track tithes, offerings, and expenses. Generate transparent financial reports and manage fundraising campaigns with ease.",
    color: "#FFB300",
    bgColor: "rgba(255,179,0,0.1)",
  },
  {
    icon: <EventIcon sx={{ fontSize: 36 }} />,
    title: "Event Coordination",
    description:
      "Plan services, schedule events, manage RSVP lists, and track attendance with QR code check-in for every gathering.",
    color: "#FF6B6B",
    bgColor: "rgba(255,107,107,0.1)",
  },
  {
    icon: <MessageIcon sx={{ fontSize: 36 }} />,
    title: "Church Communications",
    description:
      "Reach every member through SMS, email, and push notifications. Segment audiences and automate routine messages.",
    color: "#4CAF50",
    bgColor: "rgba(76,175,80,0.1)",
  },
  {
    icon: <VolunteerActivismIcon sx={{ fontSize: 36 }} />,
    title: "Online & Mobile Giving",
    description:
      "Enable members to give from anywhere using mobile money, card payments, bank transfers, or cryptocurrency.",
    color: "#9C27B0",
    bgColor: "rgba(156,39,176,0.1)",
  },
  {
    icon: <TrendingUpIcon sx={{ fontSize: 36 }} />,
    title: "Growth Analytics",
    description:
      "Understand attendance trends, giving patterns, and member engagement with dashboards designed for church leaders.",
    color: "#00BCD4",
    bgColor: "rgba(0,188,212,0.1)",
  },
];

export default function SolutionsChurchesPage() {
  return (
    <>
      <SEO
        title="For Churches"
        description="ALTAR OS empowers churches with member management, financial stewardship, event coordination, communications, and growth analytics."
      />

      {/* Hero */}
      <Box
        sx={{
          pt: { xs: 16, md: 20 },
          pb: { xs: 8, md: 12 },
          background:
            "linear-gradient(135deg, #1A1A2E 0%, #3F51B5 40%, #7C4DFF 100%)",
          textAlign: "center",
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
        <Container maxWidth="md" sx={{ position: "relative", zIndex: 1 }}>
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
            Solutions for Churches
          </Typography>
          <Typography variant="h1" sx={{ color: "#fff", mb: 3 }}>
            Empower Your Church
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{
              color: "rgba(255,255,255,0.85)",
              maxWidth: 600,
              mx: "auto",
            }}
          >
            One platform to manage every aspect of your church operations
            — from membership to finances, events to communications.
          </Typography>
        </Container>
      </Box>

      {/* Features */}
      <Box sx={{ py: { xs: 8, md: 12 }, backgroundColor: "#FFFFFF" }}>
        <Container maxWidth="lg">
          <Grid container spacing={4}>
            {churchFeatures.map((feature) => (
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
                    <Typography variant="h5" sx={{ mb: 1.5, fontWeight: 700 }}>
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

      {/* Case Study placeholder */}
      <Box sx={{ py: { xs: 8, md: 12 }, backgroundColor: "#F8F9FC" }}>
        <Container maxWidth="lg">
          <Grid container spacing={6} sx={{ alignItems: "center" }}>
            <Grid size={{ xs: 12, md: 6 }}>
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
                Case Study
              </Typography>
              <Typography variant="h3" sx={{ mb: 2 }}>
                Grace Community Church
              </Typography>
              <Typography
                variant="body1"
                sx={{ color: "text.secondary", lineHeight: 1.8, mb: 2 }}
              >
                Grace Community Church in Accra moved from spreadsheets and
                paper records to ALTAR OS in just two weeks. Within six
                months, they saw a 40% increase in digital giving, reduced
                administrative time by 60%, and improved attendance tracking
                accuracy to 99%.
              </Typography>
              <Typography
                variant="body1"
                sx={{ color: "text.secondary", lineHeight: 1.8 }}
              >
                "ALTAR OS gave us clarity we never had before. We can see
                exactly how our church is growing and where we need to focus
                our efforts." — Church Administrator
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Box
                sx={{
                  width: "100%",
                  height: { xs: 240, md: 320 },
                  borderRadius: 4,
                  background:
                    "linear-gradient(135deg, rgba(63,81,181,0.1) 0%, rgba(255,179,0,0.1) 100%)",
                  border: "2px dashed rgba(63,81,181,0.2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    color: "text.secondary",
                    fontWeight: 600,
                    opacity: 0.6,
                  }}
                >
                  Case Study Image
                </Typography>
              </Box>
            </Grid>
          </Grid>
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
            Ready to Empower Your Church?
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{ color: "rgba(255,255,255,0.8)", mb: 5 }}
          >
            Start your free trial and see the difference modern tools make.
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
