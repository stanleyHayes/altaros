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
import LocationOnIcon from "@mui/icons-material/LocationOn";
import WorkIcon from "@mui/icons-material/Work";

const positions = [
  {
    title: "Senior Backend Engineer",
    department: "Engineering",
    location: "Remote / Accra",
    type: "Full-time",
    description:
      "Build and scale our API and microservices architecture using Node.js, MongoDB, and event-driven systems.",
  },
  {
    title: "Mobile Developer (React Native)",
    department: "Engineering",
    location: "Remote / Accra",
    type: "Full-time",
    description:
      "Develop and maintain our cross-platform mobile app used by thousands of church members across Africa.",
  },
  {
    title: "Product Designer",
    department: "Design",
    location: "Remote",
    type: "Full-time",
    description:
      "Shape the user experience of ALTAR OS — designing interfaces that are intuitive for diverse users across Africa.",
  },
  {
    title: "DevOps Engineer",
    department: "Infrastructure",
    location: "Remote / Accra",
    type: "Full-time",
    description:
      "Manage our cloud infrastructure, CI/CD pipelines, monitoring, and deployment systems for high availability.",
  },
];

const culturePoints = [
  {
    title: "Mission-Driven Work",
    description:
      "Everything we build has a direct impact on churches and communities across Africa. Your work matters.",
  },
  {
    title: "Remote-First",
    description:
      "Work from anywhere. We believe great talent exists everywhere, and we structure our team accordingly.",
  },
  {
    title: "Growth & Learning",
    description:
      "Continuous learning is part of our DNA. We provide resources, mentorship, and time for professional development.",
  },
  {
    title: "Inclusive & Diverse",
    description:
      "We celebrate different perspectives and backgrounds. Our team reflects the diverse communities we serve.",
  },
];

export default function CareersPage() {
  return (
    <>
      <SEO
        title="Careers"
        description="Join the ALTAR OS team. We're hiring engineers, designers, and more. Help us build the digital operating system for the African church."
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
            Careers
          </Typography>
          <Typography variant="h1" sx={{ color: "#fff", mb: 3 }}>
            Join the Team
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{
              color: "rgba(255,255,255,0.85)",
              maxWidth: 600,
              mx: "auto",
            }}
          >
            Help us build the digital infrastructure that African churches
            deserve. We are looking for passionate builders who want their
            work to matter.
          </Typography>
        </Container>
      </Box>

      {/* Open Positions */}
      <Box sx={{ py: { xs: 8, md: 12 }, backgroundColor: "#FFFFFF" }}>
        <Container maxWidth="lg">
          <Box sx={{ textAlign: "center", mb: { xs: 6, md: 8 } }}>
            <Typography variant="h2" sx={{ mb: 2 }}>
              Open Positions
            </Typography>
            <Typography
              variant="subtitle1"
              sx={{ color: "text.secondary", maxWidth: 500, mx: "auto" }}
            >
              We are growing and looking for talented people to join our
              mission.
            </Typography>
          </Box>

          <Grid container spacing={3}>
            {positions.map((pos) => (
              <Grid size={{ xs: 12 }} key={pos.title}>
                <Card
                  sx={{
                    border: "1px solid rgba(0,0,0,0.06)",
                    "&:hover": {
                      borderColor: "primary.main",
                    },
                  }}
                >
                  <CardContent sx={{ p: { xs: 3, md: 4 } }}>
                    <Grid container spacing={2} sx={{ alignItems: "center" }}>
                      <Grid size={{ xs: 12, md: 7 }}>
                        <Typography
                          variant="h5"
                          sx={{ fontWeight: 700, mb: 1 }}
                        >
                          {pos.title}
                        </Typography>
                        <Typography
                          variant="body1"
                          sx={{ color: "text.secondary", mb: 2 }}
                        >
                          {pos.description}
                        </Typography>
                        <Box
                          sx={{
                            display: "flex",
                            gap: 2,
                            flexWrap: "wrap",
                            alignItems: "center",
                          }}
                        >
                          <Chip
                            label={pos.department}
                            size="small"
                            sx={{
                              backgroundColor: "rgba(63,81,181,0.1)",
                              color: "primary.main",
                              fontWeight: 600,
                            }}
                          />
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 0.5,
                              color: "text.secondary",
                            }}
                          >
                            <LocationOnIcon sx={{ fontSize: 16 }} />
                            <Typography variant="body2">
                              {pos.location}
                            </Typography>
                          </Box>
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 0.5,
                              color: "text.secondary",
                            }}
                          >
                            <WorkIcon sx={{ fontSize: 16 }} />
                            <Typography variant="body2">{pos.type}</Typography>
                          </Box>
                        </Box>
                      </Grid>
                      <Grid
                        size={{ xs: 12, md: 5 }}
                        sx={{
                          display: "flex",
                          justifyContent: { xs: "flex-start", md: "flex-end" },
                        }}
                      >
                        <Button
                          variant="contained"
                          color="secondary"
                          sx={{ color: "#1A1A2E", fontWeight: 700 }}
                        >
                          Apply Now
                        </Button>
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>

      {/* Culture */}
      <Box sx={{ py: { xs: 8, md: 12 }, backgroundColor: "#F8F9FC" }}>
        <Container maxWidth="lg">
          <Box sx={{ textAlign: "center", mb: { xs: 6, md: 8 } }}>
            <Typography variant="h2" sx={{ mb: 2 }}>
              Life at ALTAR OS
            </Typography>
            <Typography
              variant="subtitle1"
              sx={{ color: "text.secondary", maxWidth: 500, mx: "auto" }}
            >
              We are building more than software — we are building a team and
              culture that reflects our mission.
            </Typography>
          </Box>

          <Grid container spacing={4}>
            {culturePoints.map((point) => (
              <Grid size={{ xs: 12, sm: 6 }} key={point.title}>
                <Box>
                  <Typography variant="h5" sx={{ mb: 1, fontWeight: 700 }}>
                    {point.title}
                  </Typography>
                  <Typography
                    variant="body1"
                    sx={{ color: "text.secondary", lineHeight: 1.7 }}
                  >
                    {point.description}
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
            Don't See Your Role?
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{ color: "rgba(255,255,255,0.8)", mb: 5 }}
          >
            We are always looking for exceptional people. Send us your resume
            and tell us how you can contribute.
          </Typography>
          <Button
            component={RouterLink}
            to="/contact"
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
            Get in Touch
          </Button>
        </Container>
      </Box>
    </>
  );
}
