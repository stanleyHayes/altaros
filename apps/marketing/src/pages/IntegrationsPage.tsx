import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Button,
  Grid,
  Card,
  CardContent,
  Chip,
} from "@mui/material";
import SEO from "@/components/ui/SEO";
import PaymentIcon from "@mui/icons-material/Payment";
import SmsIcon from "@mui/icons-material/Sms";
import WhatshotIcon from "@mui/icons-material/Whatshot";
import CloudIcon from "@mui/icons-material/Cloud";
import PhoneAndroidIcon from "@mui/icons-material/PhoneAndroid";
import CodeIcon from "@mui/icons-material/Code";

const integrations = [
  {
    name: "Paystack",
    category: "Payments",
    description:
      "Accept online donations, tithes, and offerings via card, bank transfer, and USSD with Paystack's reliable payment infrastructure.",
    icon: <PaymentIcon sx={{ fontSize: 36 }} />,
    color: "#00C3F7",
    bgColor: "rgba(0,195,247,0.1)",
  },
  {
    name: "Africa's Talking",
    category: "Communications",
    description:
      "Send SMS messages, USSD prompts, and voice notifications to your congregation using Africa's leading communication API.",
    icon: <SmsIcon sx={{ fontSize: 36 }} />,
    color: "#FF6B6B",
    bgColor: "rgba(255,107,107,0.1)",
  },
  {
    name: "Firebase",
    category: "Infrastructure",
    description:
      "Power real-time features, push notifications, and authentication with Google Firebase's cloud platform.",
    icon: <WhatshotIcon sx={{ fontSize: 36 }} />,
    color: "#FFB300",
    bgColor: "rgba(255,179,0,0.1)",
  },
  {
    name: "Cloudinary",
    category: "Media",
    description:
      "Manage, optimize, and deliver images and videos — from sermon recordings to event photos — with Cloudinary's media pipeline.",
    icon: <CloudIcon sx={{ fontSize: 36 }} />,
    color: "#3448C5",
    bgColor: "rgba(52,72,197,0.1)",
  },
  {
    name: "MTN Mobile Money",
    category: "Payments",
    description:
      "Enable members to give directly from their MTN Mobile Money wallets — the most widely used mobile payment platform in Africa.",
    icon: <PhoneAndroidIcon sx={{ fontSize: 36 }} />,
    color: "#FFC107",
    bgColor: "rgba(255,193,7,0.1)",
  },
  {
    name: "Vodafone Cash",
    category: "Payments",
    description:
      "Accept donations and payments through Vodafone Cash, reaching millions of Vodafone subscribers across Ghana.",
    icon: <PhoneAndroidIcon sx={{ fontSize: 36 }} />,
    color: "#E60000",
    bgColor: "rgba(230,0,0,0.1)",
  },
];

export default function IntegrationsPage() {
  return (
    <>
      <SEO
        title="Integrations"
        description="ALTAR OS integrates with Paystack, Africa's Talking, Firebase, Cloudinary, MTN Mobile Money, and more. Connect your favorite tools."
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
            Integrations
          </Typography>
          <Typography variant="h1" sx={{ color: "#fff", mb: 3 }}>
            Connects With Your Favorite Tools
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{
              color: "rgba(255,255,255,0.85)",
              maxWidth: 600,
              mx: "auto",
            }}
          >
            ALTAR OS works seamlessly with the platforms your church already
            relies on — from payments to communications.
          </Typography>
        </Container>
      </Box>

      {/* Integration Cards */}
      <Box sx={{ py: { xs: 8, md: 12 }, backgroundColor: "#FFFFFF" }}>
        <Container maxWidth="lg">
          <Grid container spacing={4}>
            {integrations.map((item) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={item.name}>
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
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        mb: 2,
                      }}
                    >
                      <Box
                        sx={{
                          width: 64,
                          height: 64,
                          borderRadius: "16px",
                          backgroundColor: item.bgColor,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: item.color,
                        }}
                      >
                        {item.icon}
                      </Box>
                      <Chip
                        label={item.category}
                        size="small"
                        sx={{
                          backgroundColor: item.bgColor,
                          color: item.color,
                          fontWeight: 600,
                          fontSize: "0.75rem",
                        }}
                      />
                    </Box>
                    <Typography variant="h5" sx={{ mb: 1.5, fontWeight: 700 }}>
                      {item.name}
                    </Typography>
                    <Typography
                      variant="body1"
                      sx={{ color: "text.secondary", lineHeight: 1.7 }}
                    >
                      {item.description}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>

      {/* API Access */}
      <Box sx={{ py: { xs: 8, md: 12 }, backgroundColor: "#F8F9FC" }}>
        <Container maxWidth="lg">
          <Grid container spacing={6} alignItems="center">
            <Grid size={{ xs: 12, md: 6 }}>
              <Box
                sx={{
                  width: 64,
                  height: 64,
                  borderRadius: "16px",
                  backgroundColor: "rgba(63,81,181,0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "primary.main",
                  mb: 3,
                }}
              >
                <CodeIcon sx={{ fontSize: 32 }} />
              </Box>
              <Typography variant="h3" sx={{ mb: 2 }}>
                Developer API
              </Typography>
              <Typography
                variant="body1"
                sx={{ color: "text.secondary", mb: 3, lineHeight: 1.8 }}
              >
                Build custom integrations with the ALTAR OS RESTful API.
                Access member data, financials, events, and communications
                programmatically. Our comprehensive API documentation includes
                guides, code examples, and SDKs for popular languages.
              </Typography>
              <Button
                component={RouterLink}
                to="/docs"
                variant="outlined"
                color="primary"
                size="large"
              >
                View API Documentation
              </Button>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Box
                sx={{
                  width: "100%",
                  height: { xs: 240, md: 320 },
                  borderRadius: 4,
                  backgroundColor: "#1A1A2E",
                  p: 3,
                  fontFamily: "monospace",
                  fontSize: "0.85rem",
                  color: "#4CAF50",
                  overflow: "hidden",
                }}
              >
                <Typography
                  component="pre"
                  sx={{
                    fontFamily: "monospace",
                    fontSize: "0.85rem",
                    color: "#4CAF50",
                    m: 0,
                    whiteSpace: "pre-wrap",
                  }}
                >
{`GET /api/v1/members
Authorization: Bearer <token>

{
  "data": [
    {
      "id": "mem_123",
      "name": "Kwame Asante",
      "status": "active",
      "department": "Youth"
    }
  ],
  "total": 1247
}`}
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
            Connect Your Tools Today
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{ color: "rgba(255,255,255,0.8)", mb: 5 }}
          >
            Set up integrations in minutes and unlock the full power of
            ALTAR OS.
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
