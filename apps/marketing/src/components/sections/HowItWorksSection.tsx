import { Box, Container, Typography, Grid } from "@mui/material";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import SettingsIcon from "@mui/icons-material/Settings";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";

const steps = [
  {
    number: "01",
    icon: <PersonAddIcon sx={{ fontSize: 32 }} />,
    title: "Sign Up",
    description:
      "Create your church account in seconds. No credit card required — start with our free plan instantly.",
    color: "#3F51B5",
  },
  {
    number: "02",
    icon: <SettingsIcon sx={{ fontSize: 32 }} />,
    title: "Set Up",
    description:
      "Add your members, departments, and services. Import existing data or start fresh with our guided setup.",
    color: "#FFB300",
  },
  {
    number: "03",
    icon: <RocketLaunchIcon sx={{ fontSize: 32 }} />,
    title: "Go Live",
    description:
      "Start engaging your congregation immediately. Track attendance, manage finances, and communicate with ease.",
    color: "#4CAF50",
  },
];

export default function HowItWorksSection() {
  return (
    <Box
      sx={{
        py: { xs: 10, md: 14 },
        backgroundColor: "#F8F9FF",
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
            How It Works
          </Typography>
          <Typography variant="h2" sx={{ mb: 2 }}>
            Get Started in Minutes
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{
              color: "text.secondary",
              maxWidth: 550,
              mx: "auto",
            }}
          >
            Three simple steps to transform how your church operates.
          </Typography>
        </Box>

        {/* Steps */}
        <Grid container spacing={4} sx={{ position: "relative" }}>
          {/* Connecting dotted line (desktop only) */}
          <Box
            sx={{
              display: { xs: "none", md: "block" },
              position: "absolute",
              top: "60px",
              left: "20%",
              right: "20%",
              height: 2,
              backgroundImage:
                "repeating-linear-gradient(90deg, #3F51B5 0, #3F51B5 8px, transparent 8px, transparent 16px)",
              zIndex: 0,
            }}
          />

          {steps.map((step) => (
            <Grid size={{ xs: 12, md: 4 }} key={step.number}>
              <Box
                sx={{
                  textAlign: "center",
                  position: "relative",
                  zIndex: 1,
                }}
              >
                {/* Number badge */}
                <Box
                  sx={{
                    width: 80,
                    height: 80,
                    borderRadius: "50%",
                    backgroundColor: "#fff",
                    border: `3px solid ${step.color}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    mx: "auto",
                    mb: 3,
                    position: "relative",
                    boxShadow: `0 4px 20px ${step.color}30`,
                  }}
                >
                  <Box
                    sx={{
                      position: "absolute",
                      top: -8,
                      right: -8,
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      backgroundColor: step.color,
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 800,
                      fontSize: "0.75rem",
                      fontFamily: "'Nunito Sans', sans-serif",
                    }}
                  >
                    {step.number}
                  </Box>
                  <Box sx={{ color: step.color }}>{step.icon}</Box>
                </Box>

                <Typography
                  variant="h4"
                  sx={{ mb: 1.5, fontWeight: 700 }}
                >
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
  );
}
