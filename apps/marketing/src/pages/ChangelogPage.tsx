import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Button,
  Chip,
} from "@mui/material";
import SEO from "@/components/ui/SEO";
import FiberNewIcon from "@mui/icons-material/FiberNew";
import BuildIcon from "@mui/icons-material/Build";
import BugReportIcon from "@mui/icons-material/BugReport";

const releases = [
  {
    version: "v2.4.0",
    date: "March 28, 2026",
    tag: "Latest",
    tagColor: "#4CAF50",
    changes: [
      {
        type: "feature",
        text: "AI Sermon Assistant — generate sermon outlines from any topic or scripture",
      },
      {
        type: "feature",
        text: "Cryptocurrency donation support via integrated wallet",
      },
      {
        type: "improvement",
        text: "Redesigned member profile page with family linking UI",
      },
      {
        type: "improvement",
        text: "Improved SMS delivery tracking with real-time status updates",
      },
      {
        type: "fix",
        text: "Fixed attendance report export failing for large datasets",
      },
    ],
  },
  {
    version: "v2.3.0",
    date: "February 15, 2026",
    tag: null,
    tagColor: null,
    changes: [
      {
        type: "feature",
        text: "Member Insights dashboard with engagement scoring and churn prediction",
      },
      {
        type: "feature",
        text: "Push notification support for mobile app users",
      },
      {
        type: "improvement",
        text: "Faster QR code check-in with offline mode support",
      },
      {
        type: "fix",
        text: "Resolved timezone issues in event scheduling for West African churches",
      },
      {
        type: "fix",
        text: "Fixed mobile money payment status not updating in real-time",
      },
    ],
  },
  {
    version: "v2.2.0",
    date: "January 8, 2026",
    tag: null,
    tagColor: null,
    changes: [
      {
        type: "feature",
        text: "Prayer request submission and management system",
      },
      {
        type: "feature",
        text: "Bulk SMS messaging with audience segmentation",
      },
      {
        type: "improvement",
        text: "Financial reports now include year-over-year comparison charts",
      },
      {
        type: "improvement",
        text: "Updated mobile app with refreshed UI and faster load times",
      },
      {
        type: "fix",
        text: "Fixed CSV import handling for special characters in member names",
      },
    ],
  },
  {
    version: "v2.1.0",
    date: "November 20, 2025",
    tag: null,
    tagColor: null,
    changes: [
      {
        type: "feature",
        text: "Multi-branch management for denominations (Enterprise plan)",
      },
      {
        type: "feature",
        text: "Vodafone Cash integration for mobile money payments",
      },
      {
        type: "improvement",
        text: "Role-based access controls with custom permission sets",
      },
      {
        type: "fix",
        text: "Fixed email template rendering issues on Outlook",
      },
    ],
  },
];

function ChangeIcon({ type }: { type: string }) {
  switch (type) {
    case "feature":
      return <FiberNewIcon sx={{ fontSize: 18, color: "#4CAF50" }} />;
    case "improvement":
      return <BuildIcon sx={{ fontSize: 18, color: "#FFB300" }} />;
    case "fix":
      return <BugReportIcon sx={{ fontSize: 18, color: "#FF6B6B" }} />;
    default:
      return null;
  }
}

function changeLabel(type: string) {
  switch (type) {
    case "feature":
      return "New";
    case "improvement":
      return "Improved";
    case "fix":
      return "Fixed";
    default:
      return type;
  }
}

function changeColor(type: string) {
  switch (type) {
    case "feature":
      return "#4CAF50";
    case "improvement":
      return "#FFB300";
    case "fix":
      return "#FF6B6B";
    default:
      return "#999";
  }
}

export default function ChangelogPage() {
  return (
    <>
      <SEO
        title="Changelog"
        description="See what's new in ALTAR OS — new features, improvements, and bug fixes in every release."
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
            Changelog
          </Typography>
          <Typography variant="h1" sx={{ color: "#fff", mb: 3 }}>
            What's New
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{
              color: "rgba(255,255,255,0.85)",
              maxWidth: 600,
              mx: "auto",
            }}
          >
            Stay up to date with the latest features, improvements, and fixes
            in ALTAR OS.
          </Typography>
        </Container>
      </Box>

      {/* Timeline */}
      <Box sx={{ py: { xs: 8, md: 12 }, backgroundColor: "#FFFFFF" }}>
        <Container maxWidth="md">
          {releases.map((release, index) => (
            <Box
              key={release.version}
              sx={{
                position: "relative",
                pl: { xs: 3, md: 5 },
                pb: index < releases.length - 1 ? 6 : 0,
                borderLeft: "2px solid",
                borderColor:
                  index === 0 ? "primary.main" : "rgba(0,0,0,0.08)",
              }}
            >
              {/* Timeline dot */}
              <Box
                sx={{
                  position: "absolute",
                  left: -7,
                  top: 0,
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  backgroundColor:
                    index === 0 ? "primary.main" : "rgba(0,0,0,0.15)",
                  border: "2px solid #fff",
                }}
              />

              {/* Version header */}
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  mb: 1,
                  flexWrap: "wrap",
                }}
              >
                <Typography variant="h4" sx={{ fontWeight: 800 }}>
                  {release.version}
                </Typography>
                {release.tag && (
                  <Chip
                    label={release.tag}
                    size="small"
                    sx={{
                      backgroundColor: `${release.tagColor}18`,
                      color: release.tagColor,
                      fontWeight: 700,
                      fontSize: "0.75rem",
                    }}
                  />
                )}
              </Box>
              <Typography
                variant="body2"
                sx={{ color: "text.secondary", mb: 3 }}
              >
                {release.date}
              </Typography>

              {/* Changes */}
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                {release.changes.map((change, i) => (
                  <Box
                    key={i}
                    sx={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 1.5,
                    }}
                  >
                    <ChangeIcon type={change.type} />
                    <Box sx={{ display: "flex", gap: 1, alignItems: "baseline", flexWrap: "wrap" }}>
                      <Chip
                        label={changeLabel(change.type)}
                        size="small"
                        sx={{
                          height: 20,
                          fontSize: "0.65rem",
                          fontWeight: 700,
                          backgroundColor: `${changeColor(change.type)}18`,
                          color: changeColor(change.type),
                        }}
                      />
                      <Typography
                        variant="body1"
                        sx={{ color: "text.secondary", lineHeight: 1.6 }}
                      >
                        {change.text}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          ))}
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
            Experience the Latest Features
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{ color: "rgba(255,255,255,0.8)", mb: 5 }}
          >
            Start your free trial and get access to everything we have built.
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
