import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Button,
  Grid,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import SEO from "@/components/ui/SEO";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import BarChartIcon from "@mui/icons-material/BarChart";
import CampaignIcon from "@mui/icons-material/Campaign";
import SecurityIcon from "@mui/icons-material/Security";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

const features = [
  {
    icon: <AccountTreeIcon sx={{ fontSize: 36 }} />,
    title: "Multi-Branch Management",
    description:
      "Manage all your churches from a single dashboard. View individual branch performance, compare metrics, and maintain oversight across your entire network of congregations.",
    color: "#3F51B5",
    bgColor: "rgba(63,81,181,0.1)",
  },
  {
    icon: <BarChartIcon sx={{ fontSize: 36 }} />,
    title: "Unified Analytics",
    description:
      "Roll up attendance, giving, and growth data across all branches. Generate denomination-wide reports, identify trends, and make data-driven decisions for the entire organization.",
    color: "#FFB300",
    bgColor: "rgba(255,179,0,0.1)",
  },
  {
    icon: <CampaignIcon sx={{ fontSize: 36 }} />,
    title: "Network-Wide Communications",
    description:
      "Send announcements, updates, and campaigns to all branches simultaneously or target specific congregations. Coordinate denomination-wide events and initiatives effortlessly.",
    color: "#4CAF50",
    bgColor: "rgba(76,175,80,0.1)",
  },
  {
    icon: <SecurityIcon sx={{ fontSize: 36 }} />,
    title: "Enterprise Controls",
    description:
      "Role-based access controls, audit trails, compliance reporting, and centralized policy management. Ensure consistency and governance across your entire denomination.",
    color: "#FF6B6B",
    bgColor: "rgba(255,107,107,0.1)",
  },
];

const enterpriseFeatures = [
  "Centralized user and role management",
  "Cross-branch financial consolidation",
  "Denomination-wide member directory",
  "Custom branding per branch",
  "Priority support with dedicated account manager",
  "API access for custom integrations",
  "Data export and compliance tools",
  "Onboarding and training for all branches",
];

export default function SolutionsDenominationsPage() {
  return (
    <>
      <SEO
        title="For Denominations"
        description="ALTAR OS scales across your network — multi-branch management, unified analytics, denomination-wide communications, and enterprise controls."
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
            Solutions for Denominations
          </Typography>
          <Typography variant="h1" sx={{ color: "#fff", mb: 3 }}>
            Scale Across Your Network
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{
              color: "rgba(255,255,255,0.85)",
              maxWidth: 600,
              mx: "auto",
            }}
          >
            Manage dozens or hundreds of branches from one platform. ALTAR OS
            gives denominations the visibility and control they need to lead
            effectively at scale.
          </Typography>
        </Container>
      </Box>

      {/* Features */}
      <Box sx={{ py: { xs: 8, md: 12 }, backgroundColor: "#FFFFFF" }}>
        <Container maxWidth="lg">
          <Grid container spacing={4}>
            {features.map((feature) => (
              <Grid size={{ xs: 12, sm: 6 }} key={feature.title}>
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

      {/* Enterprise Features */}
      <Box sx={{ py: { xs: 8, md: 12 }, backgroundColor: "#F8F9FC" }}>
        <Container maxWidth="lg">
          <Grid container spacing={6} alignItems="center">
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
                Enterprise
              </Typography>
              <Typography variant="h3" sx={{ mb: 2 }}>
                Enterprise-Grade Features
              </Typography>
              <Typography
                variant="body1"
                sx={{ color: "text.secondary", lineHeight: 1.8, mb: 3 }}
              >
                ALTAR OS Enterprise is designed for denominations and large
                church networks that need advanced management capabilities,
                security controls, and dedicated support.
              </Typography>
              <List disablePadding>
                {enterpriseFeatures.map((item) => (
                  <ListItem key={item} disableGutters sx={{ py: 0.5 }}>
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <CheckCircleIcon
                        sx={{ fontSize: 20, color: "primary.main" }}
                      />
                    </ListItemIcon>
                    <ListItemText
                      primary={item}
                      primaryTypographyProps={{
                        fontSize: "0.95rem",
                        color: "text.secondary",
                      }}
                    />
                  </ListItem>
                ))}
              </List>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Box
                sx={{
                  width: "100%",
                  height: { xs: 280, md: 400 },
                  borderRadius: 4,
                  background:
                    "linear-gradient(135deg, rgba(63,81,181,0.1) 0%, rgba(124,77,255,0.15) 100%)",
                  border: "2px dashed rgba(63,81,181,0.2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "column",
                  gap: 1,
                }}
              >
                <AccountTreeIcon
                  sx={{ fontSize: 48, color: "primary.main", opacity: 0.3 }}
                />
                <Typography
                  variant="body2"
                  sx={{
                    color: "text.secondary",
                    fontWeight: 600,
                    opacity: 0.5,
                  }}
                >
                  Multi-Branch Dashboard Preview
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
            Ready to Scale?
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{ color: "rgba(255,255,255,0.8)", mb: 5 }}
          >
            Contact us for a custom Enterprise plan tailored to your
            denomination's needs.
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
            Contact Sales
          </Button>
        </Container>
      </Box>
    </>
  );
}
