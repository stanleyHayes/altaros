import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Button,
  Grid,
  Card,
  CardContent,
  TextField,
  InputAdornment,
} from "@mui/material";
import SEO from "@/components/ui/SEO";
import SearchIcon from "@mui/icons-material/Search";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import CodeIcon from "@mui/icons-material/Code";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import IntegrationInstructionsIcon from "@mui/icons-material/IntegrationInstructions";
import VideoLibraryIcon from "@mui/icons-material/VideoLibrary";
import GroupIcon from "@mui/icons-material/Group";

const docSections = [
  {
    icon: <RocketLaunchIcon sx={{ fontSize: 32 }} />,
    title: "Quick Start Guide",
    description:
      "Get up and running in under 10 minutes. Set up your church, invite your team, and start managing your congregation.",
    link: "#",
    color: "#4CAF50",
    bgColor: "rgba(76,175,80,0.1)",
  },
  {
    icon: <CodeIcon sx={{ fontSize: 32 }} />,
    title: "API Reference",
    description:
      "Complete REST API documentation with authentication, endpoints, request/response examples, and error handling.",
    link: "#",
    color: "#3F51B5",
    bgColor: "rgba(63,81,181,0.1)",
  },
  {
    icon: <IntegrationInstructionsIcon sx={{ fontSize: 32 }} />,
    title: "SDKs & Libraries",
    description:
      "Official client libraries for JavaScript, Python, and PHP to integrate ALTAR OS into your applications.",
    link: "#",
    color: "#7C4DFF",
    bgColor: "rgba(124,77,255,0.1)",
  },
  {
    icon: <MenuBookIcon sx={{ fontSize: 32 }} />,
    title: "User Guides",
    description:
      "Step-by-step guides for every feature — member management, finances, events, communications, and more.",
    link: "#",
    color: "#FFB300",
    bgColor: "rgba(255,179,0,0.1)",
  },
  {
    icon: <VideoLibraryIcon sx={{ fontSize: 32 }} />,
    title: "Video Tutorials",
    description:
      "Watch walkthroughs and tutorials to learn how to get the most out of ALTAR OS.",
    link: "#",
    color: "#FF6B6B",
    bgColor: "rgba(255,107,107,0.1)",
  },
  {
    icon: <GroupIcon sx={{ fontSize: 32 }} />,
    title: "Community & Support",
    description:
      "Join the ALTAR OS community, ask questions, share tips, and get help from other church leaders.",
    link: "#",
    color: "#00BCD4",
    bgColor: "rgba(0,188,212,0.1)",
  },
];

export default function DocsPage() {
  return (
    <>
      <SEO
        title="Documentation"
        description="ALTAR OS documentation — quick start guides, API reference, SDKs, tutorials, and community resources for church management."
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
            Docs
          </Typography>
          <Typography variant="h1" sx={{ color: "#fff", mb: 4 }}>
            Documentation
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{
              color: "rgba(255,255,255,0.85)",
              maxWidth: 600,
              mx: "auto",
              mb: 4,
            }}
          >
            Everything you need to get started, integrate, and make the most
            of ALTAR OS.
          </Typography>

          {/* Search placeholder */}
          <TextField
            fullWidth
            placeholder="Search documentation..."
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: "rgba(255,255,255,0.5)" }} />
                  </InputAdornment>
                ),
              },
            }}
            sx={{
              maxWidth: 500,
              mx: "auto",
              "& .MuiOutlinedInput-root": {
                backgroundColor: "rgba(255,255,255,0.1)",
                borderRadius: "14px",
                color: "#fff",
                "& fieldset": { borderColor: "rgba(255,255,255,0.2)" },
                "&:hover fieldset": { borderColor: "rgba(255,255,255,0.4)" },
                "&.Mui-focused fieldset": { borderColor: "#FFB300" },
              },
              "& .MuiInputBase-input::placeholder": {
                color: "rgba(255,255,255,0.5)",
                opacity: 1,
              },
            }}
          />
        </Container>
      </Box>

      {/* Doc Sections */}
      <Box sx={{ py: { xs: 8, md: 12 }, backgroundColor: "#FFFFFF" }}>
        <Container maxWidth="lg">
          <Grid container spacing={4}>
            {docSections.map((section) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={section.title}>
                <Card
                  sx={{
                    height: "100%",
                    border: "1px solid rgba(0,0,0,0.06)",
                    cursor: "pointer",
                    p: 1,
                  }}
                >
                  <CardContent sx={{ p: 3 }}>
                    <Box
                      sx={{
                        width: 56,
                        height: 56,
                        borderRadius: "14px",
                        backgroundColor: section.bgColor,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: section.color,
                        mb: 2.5,
                      }}
                    >
                      {section.icon}
                    </Box>
                    <Typography variant="h5" sx={{ mb: 1.5, fontWeight: 700 }}>
                      {section.title}
                    </Typography>
                    <Typography
                      variant="body1"
                      sx={{ color: "text.secondary", lineHeight: 1.7 }}
                    >
                      {section.description}
                    </Typography>
                  </CardContent>
                </Card>
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
            Ready to Build?
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{ color: "rgba(255,255,255,0.8)", mb: 5 }}
          >
            Start your free trial or dive into the API to build custom
            integrations.
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
