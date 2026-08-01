import { useState } from "react";
import { Link as RouterLink, useLocation } from "react-router-dom";
import {
  AppBar,
  Box,
  Button,
  Container,
  Divider,
  Drawer,
  IconButton,
  Link,
  Stack,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import MenuRounded from "@mui/icons-material/MenuRounded";
import CloseRounded from "@mui/icons-material/CloseRounded";
import ArrowOutwardRounded from "@mui/icons-material/ArrowOutwardRounded";
import GridViewRounded from "@mui/icons-material/GridViewRounded";
import ChurchRounded from "@mui/icons-material/ChurchRounded";
import PhoneIphoneRounded from "@mui/icons-material/PhoneIphoneRounded";
import AutoAwesomeRounded from "@mui/icons-material/AutoAwesomeRounded";
import PaymentsRounded from "@mui/icons-material/PaymentsRounded";
import { portalLinks } from "@/config/portalLinks";

const links = [
  { label: "Platform", to: "/features", icon: GridViewRounded },
  { label: "Churches", to: "/solutions/churches", icon: ChurchRounded },
  { label: "Member web", to: "/mobile-app", icon: PhoneIphoneRounded },
  { label: "AI ministry", to: "/ai-tools", icon: AutoAwesomeRounded },
  { label: "Pricing", to: "/pricing", icon: PaymentsRounded },
];

export function Brand() {
  return (
    <Box
      component={RouterLink}
      to="/"
      aria-label="Altar OS home"
      sx={{ display: "inline-flex", alignItems: "center", gap: 1.15, color: "inherit", textDecoration: "none", flexShrink: 0 }}
    >
      <Box aria-hidden sx={{ position: "relative", width: 34, height: 34, borderRadius: "11px", bgcolor: "#102A27", overflow: "hidden", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.08)" }}>
        <Box sx={{ position: "absolute", width: 20, height: 20, borderRadius: "50%", bgcolor: "#6DD5C4", left: 7, top: 7 }} />
        <Box sx={{ position: "absolute", width: 8, height: 17, bgcolor: "#102A27", left: 13, bottom: 0, borderRadius: "5px 5px 0 0" }} />
      </Box>
      <Typography component="span" sx={{ fontWeight: 750, letterSpacing: "-0.04em", fontSize: "1.06rem", lineHeight: 1 }}>
        ALTAR <Box component="span" sx={{ color: "primary.main" }}>OS</Box>
      </Typography>
    </Box>
  );
}

function DotGrid() {
  return (
    <Box aria-hidden sx={{ display: "grid", gridTemplateColumns: "repeat(3, 3px)", gap: "5px" }}>
      {Array.from({ length: 9 }).map((_, index) => (
        <Box key={index} sx={{ width: 3, height: 3, borderRadius: "50%", bgcolor: index === 4 ? "primary.main" : "rgba(16,42,39,.28)" }} />
      ))}
    </Box>
  );
}

export default function Navbar() {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up("lg"));
  const [open, setOpen] = useState(false);
  const location = useLocation();

  return (
    <>
      <AppBar
        position="sticky"
        color="transparent"
        sx={{
          bgcolor: "rgba(247,251,248,.82)",
          backdropFilter: "blur(22px) saturate(135%)",
          color: "text.primary",
          py: { xs: 0, lg: 1.5 },
        }}
      >
        <Container maxWidth={false} sx={{ maxWidth: 1440, px: { xs: 2, sm: 3, lg: 4 } }}>
          {desktop ? (
            <Box
              sx={{
                position: "relative",
                display: "grid",
                gridTemplateColumns: "auto minmax(0,1fr) auto",
                alignItems: "stretch",
                minHeight: 78,
                overflow: "hidden",
                border: "1px solid rgba(16,42,39,.09)",
                borderRadius: "18px",
                bgcolor: "rgba(255,255,255,.92)",
                boxShadow: "0 18px 50px rgba(21,75,67,.09)",
                "&::after": {
                  content: '""',
                  position: "absolute",
                  width: 80,
                  height: 25,
                  left: 300,
                  top: -15,
                  borderRadius: "0 0 50% 50%",
                  bgcolor: "#6DD5C4",
                  opacity: .75,
                  pointerEvents: "none",
                },
              }}
            >
              <Stack direction="row" spacing={2.4} sx={{ alignItems: "center", pl: 2.5, pr: 3.5, minWidth: 278 }}>
                <DotGrid />
                <Divider orientation="vertical" flexItem sx={{ my: 2.6 }} />
                <Brand />
              </Stack>

              <Box component="nav" aria-label="Main navigation" sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: .15, px: 1 }}>
                {links.map((item) => {
                  const active = location.pathname === item.to;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.to}
                      component={RouterLink}
                      to={item.to}
                      underline="none"
                      aria-current={active ? "page" : undefined}
                      sx={{
                        position: "relative",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: .7,
                        px: { lg: 1.05, xl: 1.4 },
                        py: 1.6,
                        color: active ? "primary.dark" : "text.secondary",
                        fontSize: { lg: ".78rem", xl: ".84rem" },
                        fontWeight: active ? 650 : 550,
                        whiteSpace: "nowrap",
                        transition: "color 180ms ease, transform 180ms ease",
                        "&::after": {
                          content: '""',
                          position: "absolute",
                          left: 14,
                          right: 14,
                          bottom: 6,
                          height: 2,
                          borderRadius: 2,
                          bgcolor: active ? "primary.main" : "transparent",
                          transform: active ? "scaleX(1)" : "scaleX(.3)",
                          transition: "transform 180ms ease, background-color 180ms ease",
                        },
                        "&:hover": { color: "text.primary", transform: "translateY(-1px)", "&::after": { bgcolor: "primary.light", transform: "scaleX(1)" } },
                      }}
                    >
                      <Icon sx={{ fontSize: 17 }} />
                      {item.label}
                    </Link>
                  );
                })}
              </Box>

              <Box sx={{ display: "flex", alignItems: "center", gap: .5, pl: 2.5, pr: 1.25, bgcolor: "#DFF6F0", borderRadius: "42px 14px 14px 42px" }}>
                <Button href={portalLinks.churchLogin} sx={{ color: "text.primary", whiteSpace: "nowrap", px: 1.5 }}>Log in</Button>
                <Button
                  component={RouterLink}
                  to="/get-started"
                  variant="contained"
                  endIcon={<ArrowOutwardRounded sx={{ fontSize: 17 }} />}
                  sx={{ minHeight: 48, px: 2.2, whiteSpace: "nowrap", borderRadius: "13px" }}
                >
                  Start free
                </Button>
              </Box>
            </Box>
          ) : (
            <Box sx={{ minHeight: 68, display: "flex", alignItems: "center", width: "100%" }}>
              <Brand />
              <Box sx={{ flex: 1 }} />
              <Button href={portalLinks.churchLogin} sx={{ display: { xs: "none", sm: "inline-flex" }, color: "text.primary", mr: 1 }}>Log in</Button>
              <IconButton aria-label="Open menu" onClick={() => setOpen(true)} sx={{ color: "text.primary", bgcolor: "#DFF6F0", borderRadius: "11px", "&:hover": { bgcolor: "#CDECE4" } }}>
                <MenuRounded />
              </IconButton>
            </Box>
          )}
        </Container>
      </AppBar>

      <Drawer anchor="right" open={open} onClose={() => setOpen(false)} slotProps={{ paper: { sx: { width: "min(92vw, 410px)", bgcolor: "#F7FBF8", p: 3, display: "flex" } } }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Brand />
          <IconButton aria-label="Close menu" onClick={() => setOpen(false)}><CloseRounded /></IconButton>
        </Box>
        <Stack spacing={0} sx={{ mt: 6 }}>
          {links.map((item, index) => (
            <Link
              key={item.to}
              component={RouterLink}
              to={item.to}
              onClick={() => setOpen(false)}
              underline="none"
              sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", py: 2.1, borderBottom: "1px solid", borderColor: "divider", color: "text.primary", fontSize: "1.5rem", fontWeight: 600, letterSpacing: "-.035em" }}
            >
              <span>{item.label}</span>
              <Typography variant="caption" color="text.secondary">0{index + 1}</Typography>
            </Link>
          ))}
        </Stack>
        <Stack spacing={1.25} sx={{ mt: "auto" }}>
          <Button href={portalLinks.churchLogin} variant="outlined" size="large">Church staff login</Button>
          <Button component={RouterLink} to="/get-started" onClick={() => setOpen(false)} variant="contained" size="large">Start free</Button>
        </Stack>
      </Drawer>
    </>
  );
}
