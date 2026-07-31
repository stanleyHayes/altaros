import { useState } from "react";
import { Link as RouterLink, useLocation } from "react-router-dom";
import { AppBar, Box, Button, Container, Drawer, IconButton, Link, Stack, Typography, useMediaQuery } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import MenuRounded from "@mui/icons-material/MenuRounded";
import CloseRounded from "@mui/icons-material/CloseRounded";
import ArrowOutwardRounded from "@mui/icons-material/ArrowOutwardRounded";
import { portalLinks } from "@/config/portalLinks";

const links = [
  { label: "Platform", to: "/features" }, { label: "Churches", to: "/solutions/churches" },
  { label: "Member web", to: "/mobile-app" }, { label: "AI ministry", to: "/ai-tools" }, { label: "Pricing", to: "/pricing" },
];

export function Brand() {
  return <Box component={RouterLink} to="/" aria-label="Altar OS home" sx={{ display: "inline-flex", alignItems: "center", gap: 1.15, color: "inherit", textDecoration: "none", flexShrink: 0 }}>
    <Box aria-hidden sx={{ position: "relative", width: 34, height: 34, borderRadius: "11px", bgcolor: "#102A27", overflow: "hidden", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.08)" }}>
      <Box sx={{ position: "absolute", width: 20, height: 20, borderRadius: "50%", bgcolor: "#6DD5C4", left: 7, top: 7 }} />
      <Box sx={{ position: "absolute", width: 8, height: 17, bgcolor: "#102A27", left: 13, bottom: 0, borderRadius: "5px 5px 0 0" }} />
    </Box>
    <Typography component="span" sx={{ fontWeight: 750, letterSpacing: "-0.04em", fontSize: "1.06rem", lineHeight: 1 }}>ALTAR <Box component="span" sx={{ color: "primary.main" }}>OS</Box></Typography>
  </Box>;
}

export default function Navbar() {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up("md"));
  const [open, setOpen] = useState(false);
  const location = useLocation();

  return <>
    <AppBar position="sticky" color="transparent" sx={{ bgcolor: "rgba(247,251,248,.86)", backdropFilter: "blur(20px) saturate(140%)", borderBottom: "1px solid", borderColor: "divider", color: "text.primary" }}>
      <Container maxWidth={false} sx={{ maxWidth: 1360, px: { xs: 2, sm: 3, lg: 4 } }}>
        <Box sx={{ minHeight: { xs: 68, md: 74 }, display: "flex", alignItems: "center", width: "100%" }}>
          <Brand /><Box sx={{ flex: 1 }} />
          {desktop ? <>
            <Box component="nav" aria-label="Main navigation" sx={{ display: "flex", alignItems: "center", gap: .25 }}>
              {links.map(item => { const active = location.pathname === item.to; return <Link key={item.to} component={RouterLink} to={item.to} underline="none" sx={{ position: "relative", px: 1.45, py: 1, color: active ? "text.primary" : "text.secondary", fontSize: ".88rem", fontWeight: 600, whiteSpace: "nowrap", "&::after": { content: '""', position: "absolute", left: 12, right: 12, bottom: 3, height: 2, borderRadius: 2, bgcolor: active ? "primary.main" : "transparent" }, "&:hover": { color: "text.primary" } }}>{item.label}</Link>; })}
            </Box>
            <Button href={portalLinks.churchLogin} sx={{ ml: 1.5, color: "text.primary", whiteSpace: "nowrap" }}>Log in</Button>
            <Button component={RouterLink} to="/get-started" variant="contained" endIcon={<ArrowOutwardRounded sx={{ fontSize: 17 }} />} sx={{ ml: .75, minHeight: 42, px: 2.2, whiteSpace: "nowrap" }}>Start free</Button>
          </> : <IconButton aria-label="Open menu" onClick={() => setOpen(true)} sx={{ ml: 1, color: "text.primary" }}><MenuRounded /></IconButton>}
        </Box>
      </Container>
    </AppBar>
    <Drawer anchor="right" open={open} onClose={() => setOpen(false)} slotProps={{ paper: { sx: { width: "min(92vw, 410px)", bgcolor: "#F7FBF8", p: 3, display: "flex" } } }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}><Brand /><IconButton aria-label="Close menu" onClick={() => setOpen(false)}><CloseRounded /></IconButton></Box>
      <Stack spacing={0} sx={{ mt: 6 }}>{links.map((item, i) => <Link key={item.to} component={RouterLink} to={item.to} onClick={() => setOpen(false)} underline="none" sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", py: 2.1, borderBottom: "1px solid", borderColor: "divider", color: "text.primary", fontSize: "1.5rem", fontWeight: 600, letterSpacing: "-.035em" }}><span>{item.label}</span><Typography variant="caption" color="text.secondary">0{i + 1}</Typography></Link>)}</Stack>
      <Stack spacing={1.25} sx={{ mt: "auto" }}><Button href={portalLinks.churchLogin} variant="outlined" size="large">Church staff login</Button><Button component={RouterLink} to="/get-started" onClick={() => setOpen(false)} variant="contained" size="large">Start free</Button></Stack>
    </Drawer>
  </>;
}
