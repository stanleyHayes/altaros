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
import SpeedIcon from "@mui/icons-material/Speed";
import FormatQuoteIcon from "@mui/icons-material/FormatQuote";

const painPoints = [
  {
    pain: "Sermon preparation is time-consuming and isolating",
    solution: "AI Sermon Assistant",
    description:
      "Generate sermon outlines, find relevant scripture, and get inspiration from a library of themes — all in minutes, not hours. Spend less time at the desk and more time with your congregation.",
    icon: <AutoFixHighIcon sx={{ fontSize: 36 }} />,
    color: "#7C4DFF",
    bgColor: "rgba(124,77,255,0.1)",
  },
  {
    pain: "Hard to keep track of who needs pastoral care",
    solution: "Member Insights & Alerts",
    description:
      "AI-powered insights detect when members become inactive, flag those who may need follow-up, and suggest personalized outreach actions. Never let a sheep slip through the cracks.",
    icon: <InsightsIcon sx={{ fontSize: 36 }} />,
    color: "#FFB300",
    bgColor: "rgba(255,179,0,0.1)",
  },
  {
    pain: "Administrative tasks steal time from ministry",
    solution: "Automation & Delegation",
    description:
      "Automate routine tasks like attendance tracking, giving receipts, event reminders, and report generation. Delegate with role-based access so your team can help without compromising security.",
    icon: <SpeedIcon sx={{ fontSize: 36 }} />,
    color: "#4CAF50",
    bgColor: "rgba(76,175,80,0.1)",
  },
];

export default function SolutionsPastorsPage() {
  return (
    <>
      <SEO
        title="For Pastors"
        description="ALTAR OS is built for pastors — AI sermon assistance, member care insights, and automation tools to free you for ministry."
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
            Solutions for Pastors
          </Typography>
          <Typography variant="h1" sx={{ color: "#fff", mb: 3 }}>
            Built for Pastors
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{
              color: "rgba(255,255,255,0.85)",
              maxWidth: 600,
              mx: "auto",
            }}
          >
            Less administration. More ministry. ALTAR OS gives you the tools
            to lead your church with clarity and confidence.
          </Typography>
        </Container>
      </Box>

      {/* Pain Points & Solutions */}
      <Box sx={{ py: { xs: 8, md: 12 }, backgroundColor: "#FFFFFF" }}>
        <Container maxWidth="lg">
          <Box sx={{ textAlign: "center", mb: { xs: 6, md: 8 } }}>
            <Typography variant="h2" sx={{ mb: 2 }}>
              Your Challenges, Solved
            </Typography>
            <Typography
              variant="subtitle1"
              sx={{ color: "text.secondary", maxWidth: 600, mx: "auto" }}
            >
              We understand the unique demands of pastoral ministry and built
              tools to address them directly.
            </Typography>
          </Box>

          <Grid container spacing={4}>
            {painPoints.map((item) => (
              <Grid size={{ xs: 12, md: 4 }} key={item.solution}>
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
                        backgroundColor: item.bgColor,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: item.color,
                        mb: 3,
                      }}
                    >
                      {item.icon}
                    </Box>
                    <Typography
                      variant="body2"
                      sx={{
                        color: "text.secondary",
                        fontWeight: 600,
                        mb: 1,
                        fontStyle: "italic",
                      }}
                    >
                      "{item.pain}"
                    </Typography>
                    <Typography variant="h5" sx={{ mb: 2, fontWeight: 700 }}>
                      {item.solution}
                    </Typography>
                    <Typography
                      variant="body1"
                      sx={{ color: "text.secondary", lineHeight: 1.8 }}
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

      {/* Testimonial */}
      <Box sx={{ py: { xs: 8, md: 12 }, backgroundColor: "#F8F9FC" }}>
        <Container maxWidth="md">
          <Box sx={{ textAlign: "center" }}>
            <FormatQuoteIcon
              sx={{ fontSize: 48, color: "secondary.main", mb: 2 }}
            />
            <Typography
              variant="h4"
              sx={{
                fontWeight: 600,
                lineHeight: 1.5,
                mb: 3,
                fontStyle: "italic",
              }}
            >
              "ALTAR OS has transformed how I manage my church. The AI sermon
              assistant alone saves me hours every week, and the member
              insights help me care for my flock like never before."
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Pastor Emmanuel Adjei
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Grace Community Church, Accra
            </Typography>
          </Box>
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
            Focus on Ministry, Not Admin
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{ color: "rgba(255,255,255,0.8)", mb: 5 }}
          >
            Start your free trial and experience the difference.
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
