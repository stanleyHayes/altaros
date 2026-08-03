import type { ReactNode } from "react";
import { Box, Paper, Stack, Typography } from "@mui/material";
import ChurchRounded from "@mui/icons-material/ChurchRounded";
import EventAvailableOutlined from "@mui/icons-material/EventAvailableOutlined";
import FavoriteBorderRounded from "@mui/icons-material/FavoriteBorderRounded";
import VolunteerActivismOutlined from "@mui/icons-material/VolunteerActivismOutlined";

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

const moments = [
  { icon: EventAvailableOutlined, label: "Church events" },
  { icon: VolunteerActivismOutlined, label: "Simple giving" },
  { icon: FavoriteBorderRounded, label: "Care and community" },
];

/** Shared shell for the member web auth pages (login / register / OTP). */
export default function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: "#F4F1E9",
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "minmax(420px, 0.92fr) minmax(520px, 1.08fr)" },
      }}
    >
      <Box
        component="main"
        sx={{
          px: { xs: 2.5, sm: 6, lg: 10 },
          py: { xs: 3, sm: 6 },
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          order: { xs: 2, md: 1 },
        }}
      >
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", mb: { xs: 4, md: 7 } }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: "14px",
              bgcolor: "#102A27",
              color: "#78D8C7",
              display: "grid",
              placeItems: "center",
            }}
          >
            <ChurchRounded fontSize="small" />
          </Box>
          <Box>
            <Typography sx={{ color: "#102A27", fontWeight: 850, letterSpacing: "-0.035em", lineHeight: 1 }}>
              ALTAR OS
            </Typography>
            <Typography sx={{ color: "#71807A", fontSize: "0.68rem", letterSpacing: "0.12em", mt: 0.4 }}>
              MEMBER WEB
            </Typography>
          </Box>
        </Stack>

        <Paper
          elevation={0}
          sx={{
            width: "100%",
            maxWidth: 560,
            boxSizing: "border-box",
            bgcolor: "#FBFDFB",
            borderRadius: { xs: "16px", sm: "20px" },
            p: { xs: 2.5, sm: 4 },
          }}
        >
          <Box sx={{ mb: 4 }}>
            <Typography
              component="h1"
              sx={{
                color: "#102A27",
                fontSize: { xs: "2.15rem", sm: "2.75rem" },
                fontWeight: 760,
                letterSpacing: "-0.055em",
                lineHeight: 1.02,
                mb: subtitle ? 1.4 : 0,
              }}
            >
              {title}
            </Typography>
            {subtitle && (
              <Typography sx={{ color: "#66756F", fontSize: "1rem", lineHeight: 1.65, maxWidth: 420 }}>
                {subtitle}
              </Typography>
            )}
          </Box>
          {children}
        </Paper>

        <Typography sx={{ color: "#82908A", fontSize: "0.75rem", mt: { xs: 5, md: 8 } }}>
          © {new Date().getFullYear()} Altar OS · Accra, Ghana
        </Typography>
      </Box>

      <Box
        component="aside"
        sx={{
          m: { xs: 1.5, md: 2 },
          minHeight: { xs: 270, md: "calc(100vh - 32px)" },
          borderRadius: { xs: "26px", md: "34px" },
          bgcolor: "#102A27",
          color: "#F7F5ED",
          p: { xs: 3, sm: 5, lg: 8 },
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          overflow: "hidden",
          position: "relative",
          order: { xs: 1, md: 2 },
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            width: { xs: 230, lg: 410 },
            height: { xs: 230, lg: 410 },
            right: { xs: -95, lg: -110 },
            top: { xs: -110, lg: -80 },
            borderRadius: "50%",
            border: "1px solid rgba(120,216,199,0.22)",
            boxShadow: "0 0 0 42px rgba(120,216,199,0.035), 0 0 0 84px rgba(120,216,199,0.025)",
          }}
        />
        <Typography sx={{ color: "#78D8C7", fontSize: "0.73rem", fontWeight: 800, letterSpacing: "0.18em", zIndex: 1 }}>
          YOUR CHURCH, THROUGH THE WEEK
        </Typography>

        <Box sx={{ zIndex: 1, maxWidth: 590, my: { xs: 5, md: 8 } }}>
          <Typography
            sx={{
              fontFamily: '"Outfit", sans-serif',
              fontSize: { xs: "2rem", sm: "3rem", lg: "4.2rem" },
              lineHeight: 1.02,
              letterSpacing: "-0.045em",
              mb: 2.5,
            }}
          >
            Belong beyond Sunday.
          </Typography>
          <Typography sx={{ color: "rgba(247,245,237,0.66)", lineHeight: 1.7, maxWidth: 480 }}>
            Give, join events and stay close to the people who make your church feel like home.
          </Typography>
        </Box>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} sx={{ zIndex: 1 }}>
          {moments.map(({ icon: Icon, label }) => (
            <Stack
              key={label}
              direction="row"
              spacing={1}
              sx={{
                alignItems: "center",
                px: 1.5,
                py: 1.2,
                border: "1px solid rgba(247,245,237,0.13)",
                borderRadius: "14px",
                bgcolor: "rgba(255,255,255,0.035)",
              }}
            >
              <Icon sx={{ color: "#78D8C7", fontSize: 18 }} />
              <Typography sx={{ fontSize: "0.78rem", color: "rgba(247,245,237,0.78)" }}>{label}</Typography>
            </Stack>
          ))}
        </Stack>
      </Box>
    </Box>
  );
}
