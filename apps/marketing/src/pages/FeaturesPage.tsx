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
} from "@mui/material";
import SEO from "@/components/ui/SEO";
import PeopleIcon from "@mui/icons-material/People";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import EventIcon from "@mui/icons-material/Event";
import MessageIcon from "@mui/icons-material/Message";
import AutoStoriesIcon from "@mui/icons-material/AutoStories";
import PsychologyIcon from "@mui/icons-material/Psychology";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

const features = [
  {
    icon: <PeopleIcon sx={{ fontSize: 40 }} />,
    title: "Church CRM",
    description:
      "Build deep, lasting relationships with every member of your congregation. ALTAR OS gives you a comprehensive view of each individual, their family connections, departmental involvement, and spiritual journey — all in one place.",
    bullets: [
      "Detailed member profiles with custom fields",
      "Family linking and household management",
      "Department and ministry group tracking",
      "Member status lifecycle (visitor to leader)",
      "Search, filter, and segment your congregation",
      "Bulk import and export capabilities",
    ],
    color: "#3F51B5",
    bgColor: "rgba(63,81,181,0.1)",
  },
  {
    icon: <AccountBalanceIcon sx={{ fontSize: 40 }} />,
    title: "Financial Management",
    description:
      "Handle every aspect of church finances with confidence. From tithes and offerings to expense tracking and fundraising campaigns, ALTAR OS provides the transparency and reporting your church deserves — with support for mobile money and cryptocurrency.",
    bullets: [
      "Tithe and offering tracking with receipts",
      "Mobile money integration (MTN, Vodafone, AirtelTigo)",
      "Cryptocurrency donation support",
      "Expense management and budgeting",
      "Fundraising campaign tools",
      "Comprehensive financial reports and dashboards",
    ],
    color: "#FFB300",
    bgColor: "rgba(255,179,0,0.1)",
  },
  {
    icon: <EventIcon sx={{ fontSize: 40 }} />,
    title: "Events & Attendance",
    description:
      "Simplify event planning and never lose track of who attended. With built-in RSVP management, QR code check-in, and real-time analytics, you will know exactly how your congregation is engaging.",
    bullets: [
      "Event creation with RSVP management",
      "QR code check-in for seamless attendance",
      "Real-time attendance dashboards",
      "Historical attendance trends and analytics",
      "Recurring event scheduling",
      "Volunteer coordination and sign-ups",
    ],
    color: "#FF6B6B",
    bgColor: "rgba(255,107,107,0.1)",
  },
  {
    icon: <MessageIcon sx={{ fontSize: 40 }} />,
    title: "Communications",
    description:
      "Reach your congregation wherever they are. Send targeted messages via SMS, email, or push notifications. Segment your audience and deliver the right message to the right people at the right time.",
    bullets: [
      "SMS messaging with delivery tracking",
      "Email campaigns with templates",
      "Push notifications to mobile app users",
      "Audience segmentation and targeting",
      "Scheduled and automated messages",
      "Communication history and analytics",
    ],
    color: "#4CAF50",
    bgColor: "rgba(76,175,80,0.1)",
  },
  {
    icon: <AutoStoriesIcon sx={{ fontSize: 40 }} />,
    title: "Spiritual Growth",
    description:
      "Nurture the spiritual development of your congregation with daily devotionals, sermon archives, Bible reading plans, and a prayer request system that fosters community and care.",
    bullets: [
      "Daily devotional publishing",
      "Sermon archives with audio and notes",
      "Bible reading plans and tracking",
      "Prayer request submission and management",
      "Spiritual milestone tracking",
      "Small group study materials",
    ],
    color: "#9C27B0",
    bgColor: "rgba(156,39,176,0.1)",
  },
  {
    icon: <PsychologyIcon sx={{ fontSize: 40 }} />,
    title: "AI-Powered Tools",
    description:
      "Leverage artificial intelligence to enhance your ministry. From sermon preparation assistance to predictive member engagement insights, ALTAR OS puts cutting-edge technology in service of the Gospel.",
    bullets: [
      "AI sermon assistant for outline generation",
      "Member engagement scoring and predictions",
      "Inactive member detection and follow-up suggestions",
      "Prayer chatbot with scripture-based guidance",
      "Smart analytics and trend identification",
      "Automated content recommendations",
    ],
    color: "#00BCD4",
    bgColor: "rgba(0,188,212,0.1)",
  },
];

export default function FeaturesPage() {
  return (
    <>
      <SEO
        title="Features"
        description="Explore all the features ALTAR OS offers — Church CRM, financial management, events, communications, spiritual growth tools, and AI-powered insights."
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
              "radial-gradient(ellipse at 30% 50%, rgba(124,77,255,0.3) 0%, transparent 60%), " +
              "radial-gradient(ellipse at 70% 30%, rgba(255,179,0,0.15) 0%, transparent 50%)",
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
            Features
          </Typography>
          <Typography
            variant="h1"
            sx={{ color: "#fff", mb: 3 }}
          >
            Built for the Modern Church
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{
              color: "rgba(255,255,255,0.85)",
              maxWidth: 600,
              mx: "auto",
            }}
          >
            Everything you need to manage, grow, and engage your congregation
            — all in one powerful platform.
          </Typography>
        </Container>
      </Box>

      {/* Feature Deep-Dives */}
      {features.map((feature, index) => (
        <Box
          key={feature.title}
          sx={{
            py: { xs: 8, md: 12 },
            backgroundColor: index % 2 === 0 ? "#FFFFFF" : "#F8F9FC",
          }}
        >
          <Container maxWidth="lg">
            <Grid
              container
              spacing={6}
              direction={index % 2 === 0 ? "row" : "row-reverse"}
              sx={{ alignItems: "center" }}
            >
              {/* Text side */}
              <Grid size={{ xs: 12, md: 6 }}>
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
                <Typography variant="h3" sx={{ mb: 2 }}>
                  {feature.title}
                </Typography>
                <Typography
                  variant="body1"
                  sx={{ color: "text.secondary", mb: 3, lineHeight: 1.8 }}
                >
                  {feature.description}
                </Typography>
                <List disablePadding>
                  {feature.bullets.map((bullet) => (
                    <ListItem key={bullet} disableGutters sx={{ py: 0.5 }}>
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        <CheckCircleIcon
                          sx={{ fontSize: 20, color: feature.color }}
                        />
                      </ListItemIcon>
                      <ListItemText
                        primary={bullet}
                        slotProps={{
                          primary: {
                            sx: {
                              fontSize: "0.95rem",
                              color: "text.secondary",
                            },
                          },
                        }}
                      />
                    </ListItem>
                  ))}
                </List>
              </Grid>

              {/* Image placeholder */}
              <Grid size={{ xs: 12, md: 6 }}>
                <Box
                  sx={{
                    width: "100%",
                    height: { xs: 280, md: 400 },
                    borderRadius: 4,
                    background: `linear-gradient(135deg, ${feature.bgColor} 0%, ${feature.color}22 100%)`,
                    border: `2px dashed ${feature.color}44`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "column",
                    gap: 1,
                  }}
                >
                  <Box sx={{ color: feature.color, opacity: 0.5 }}>
                    {feature.icon}
                  </Box>
                  <Typography
                    variant="body2"
                    sx={{ color: feature.color, opacity: 0.6, fontWeight: 600 }}
                  >
                    {feature.title} Dashboard Preview
                  </Typography>
                </Box>
              </Grid>
            </Grid>
          </Container>
        </Box>
      ))}

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
          <Typography variant="h2" sx={{ color: "#fff", mb: 2, fontWeight: 800 }}>
            Ready to Get Started?
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{ color: "rgba(255,255,255,0.8)", mb: 5 }}
          >
            Join thousands of churches already using ALTAR OS to transform
            their ministry.
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
