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
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import InsightsIcon from "@mui/icons-material/Insights";
import ChatIcon from "@mui/icons-material/Chat";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import TuneIcon from "@mui/icons-material/Tune";
import VerifiedIcon from "@mui/icons-material/Verified";

const aiFeatures = [
  {
    icon: <AutoFixHighIcon sx={{ fontSize: 40 }} />,
    title: "Sermon Assistant",
    description:
      "Generate sermon outlines from any topic, scripture passage, or theme. The AI analyzes thousands of sermon structures to suggest compelling introductions, key points, illustrations, and conclusions tailored to your preaching style.",
    color: "#7C4DFF",
    bgColor: "rgba(124,77,255,0.1)",
  },
  {
    icon: <InsightsIcon sx={{ fontSize: 40 }} />,
    title: "Member Insights",
    description:
      "Detect inactive members before they slip away. Our AI analyzes attendance patterns, giving trends, and engagement signals to predict churn, flag at-risk members, and suggest personalized follow-up actions for your pastoral care team.",
    color: "#FFB300",
    bgColor: "rgba(255,179,0,0.1)",
  },
  {
    icon: <ChatIcon sx={{ fontSize: 40 }} />,
    title: "Prayer Assistant",
    description:
      "A scripture-based chatbot that offers spiritual guidance, shares relevant Bible passages, and provides comfort through prayer. Members can interact anytime, receiving thoughtful, faith-centered responses grounded in God's Word.",
    color: "#4CAF50",
    bgColor: "rgba(76,175,80,0.1)",
  },
];

const steps = [
  {
    step: "1",
    icon: <CloudUploadIcon sx={{ fontSize: 32 }} />,
    title: "Connect Your Data",
    description:
      "ALTAR OS securely connects to your existing church data — member records, attendance history, giving patterns, and communications.",
  },
  {
    step: "2",
    icon: <TuneIcon sx={{ fontSize: 32 }} />,
    title: "AI Learns & Adapts",
    description:
      "Our AI models analyze your church's unique patterns, preferences, and needs to deliver insights that are specific to your ministry context.",
  },
  {
    step: "3",
    icon: <VerifiedIcon sx={{ fontSize: 32 }} />,
    title: "Get Actionable Insights",
    description:
      "Receive clear, actionable recommendations — from sermon ideas to member follow-ups — delivered right to your dashboard and inbox.",
  },
];

export default function AiToolsPage() {
  return (
    <>
      <SEO
        title="AI Tools"
        description="Discover AI-powered tools for sermon preparation, member insights, and prayer assistance — built specifically for church ministry."
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
            AI-Powered
          </Typography>
          <Typography variant="h1" sx={{ color: "#fff", mb: 3 }}>
            AI That Understands Ministry
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{
              color: "rgba(255,255,255,0.85)",
              maxWidth: 600,
              mx: "auto",
            }}
          >
            Purpose-built artificial intelligence that serves the church — not
            the other way around.
          </Typography>
        </Container>
      </Box>

      {/* Feature Cards */}
      <Box sx={{ py: { xs: 8, md: 12 }, backgroundColor: "#FFFFFF" }}>
        <Container maxWidth="lg">
          <Grid container spacing={4}>
            {aiFeatures.map((feature) => (
              <Grid size={{ xs: 12, md: 4 }} key={feature.title}>
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
                        width: 72,
                        height: 72,
                        borderRadius: "18px",
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
                    <Typography variant="h4" sx={{ mb: 2, fontWeight: 700 }}>
                      {feature.title}
                    </Typography>
                    <Typography
                      variant="body1"
                      sx={{ color: "text.secondary", lineHeight: 1.8 }}
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

      {/* How It Works */}
      <Box sx={{ py: { xs: 8, md: 12 }, backgroundColor: "#F8F9FC" }}>
        <Container maxWidth="lg">
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
              How It Works
            </Typography>
            <Typography variant="h2" sx={{ mb: 2 }}>
              Simple. Secure. Smart.
            </Typography>
            <Typography
              variant="subtitle1"
              sx={{ color: "text.secondary", maxWidth: 600, mx: "auto" }}
            >
              Getting started with AI features takes just a few minutes.
            </Typography>
          </Box>

          <Grid container spacing={4}>
            {steps.map((step) => (
              <Grid size={{ xs: 12, md: 4 }} key={step.step}>
                <Box sx={{ textAlign: "center" }}>
                  <Box
                    sx={{
                      width: 64,
                      height: 64,
                      borderRadius: "50%",
                      background:
                        "linear-gradient(135deg, #3F51B5 0%, #7C4DFF 100%)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      mx: "auto",
                      mb: 3,
                      fontSize: "1.5rem",
                      fontWeight: 800,
                    }}
                  >
                    {step.step}
                  </Box>
                  <Typography variant="h5" sx={{ mb: 1.5, fontWeight: 700 }}>
                    {step.title}
                  </Typography>
                  <Typography
                    variant="body1"
                    sx={{
                      color: "text.secondary",
                      maxWidth: 320,
                      mx: "auto",
                      lineHeight: 1.7,
                    }}
                  >
                    {step.description}
                  </Typography>
                </Box>
              </Grid>
            ))}
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
            Try AI Features Free
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{ color: "rgba(255,255,255,0.8)", mb: 5 }}
          >
            Experience the future of church management with AI tools included
            in every plan.
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
