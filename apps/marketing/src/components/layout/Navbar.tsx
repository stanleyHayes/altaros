import { useState } from "react";
import { Link as RouterLink, useLocation } from "react-router-dom";
import {
  AppBar,
  Box,
  Button,
  Container,
  Drawer,
  IconButton,
  Link,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Toolbar,
  Typography,
  useMediaQuery,
  useScrollTrigger,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import MenuIcon from "@mui/icons-material/Menu";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

type NavChild = { label: string; to: string };
type NavItem = { label: string; to?: string; children?: NavChild[] };

const NAV_ITEMS: NavItem[] = [
  {
    label: "Product",
    children: [
      { label: "Features", to: "/features" },
      { label: "AI Tools", to: "/ai-tools" },
      { label: "Mobile App", to: "/mobile-app" },
      { label: "Integrations", to: "/integrations" },
      { label: "Changelog", to: "/changelog" },
    ],
  },
  {
    label: "Solutions",
    children: [
      { label: "For Pastors", to: "/solutions/pastors" },
      { label: "For Churches", to: "/solutions/churches" },
      { label: "For Denominations", to: "/solutions/denominations" },
    ],
  },
  {
    label: "Resources",
    children: [
      { label: "Blog", to: "/blog" },
      { label: "Documentation", to: "/docs" },
      { label: "Help Centre", to: "/help" },
    ],
  },
  { label: "About", to: "/about" },
];

/** Adinkra "Gye Nyame"-inspired mark used as the brand glyph. */
const BRAND_MARK = `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M50 10C30 10 15 25 15 45C15 55 20 65 30 70C25 75 20 80 20 85C20 90 25 95 35 90C40 87 45 82 50 78C55 82 60 87 65 90C75 95 80 90 80 85C80 80 75 75 70 70C80 65 85 55 85 45C85 25 70 10 50 10Z" stroke="currentColor" stroke-width="6" fill="none" stroke-linejoin="round"/>
</svg>`;

function BrandLogo({ dense }: { dense?: boolean }) {
  return (
    <Box
      component={RouterLink}
      to="/"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <Box
        aria-hidden
        sx={{
          width: dense ? 30 : 34,
          height: dense ? 30 : 34,
          color: "primary.main",
          flexShrink: 0,
          "& svg": { width: "100%", height: "100%" },
        }}
        dangerouslySetInnerHTML={{ __html: BRAND_MARK }}
      />
      <Typography
        component="span"
        sx={{
          fontWeight: 800,
          fontSize: dense ? "1.15rem" : "1.3rem",
          letterSpacing: "-0.02em",
          color: "text.primary",
        }}
      >
        ALTAR&nbsp;OS
      </Typography>
    </Box>
  );
}

function DesktopDropdown({ item }: { item: NavItem }) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  return (
    <>
      <Button
        onClick={(e) => setAnchorEl(e.currentTarget)}
        endIcon={
          <ExpandMoreIcon
            sx={{
              transition: "transform 0.2s ease",
              transform: open ? "rotate(180deg)" : "none",
            }}
          />
        }
        sx={{
          color: "text.primary",
          fontWeight: 600,
          fontSize: "0.95rem",
          px: 1.5,
          "&:hover": { backgroundColor: "rgba(63,81,181,0.06)" },
        }}
      >
        {item.label}
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{
          paper: {
            elevation: 3,
            sx: { mt: 1, minWidth: 220, borderRadius: 3, overflow: "hidden" },
          },
        }}
      >
        {item.children?.map((child) => (
          <MenuItem
            key={child.to}
            component={RouterLink}
            to={child.to}
            onClick={() => setAnchorEl(null)}
            sx={{ py: 1.25, fontWeight: 500 }}
          >
            {child.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export default function Navbar() {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Elevate + solidify the bar once the user scrolls away from the hero.
  const scrolled = useScrollTrigger({ disableHysteresis: true, threshold: 8 });

  return (
    <>
      <AppBar
        position="sticky"
        elevation={0}
        sx={{
          backgroundColor: scrolled
            ? "rgba(255,255,255,0.85)"
            : "rgba(255,255,255,0.6)",
          backdropFilter: "blur(12px)",
          borderBottom: scrolled
            ? "1px solid rgba(26,26,46,0.08)"
            : "1px solid transparent",
          transition: "background-color 0.3s ease, border-color 0.3s ease",
        }}
      >
        <Container maxWidth="lg">
          <Toolbar disableGutters sx={{ minHeight: { xs: 64, md: 76 }, gap: 2 }}>
            <BrandLogo dense={!isDesktop} />

            <Box sx={{ flexGrow: 1 }} />

            {isDesktop ? (
              <>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  {NAV_ITEMS.map((item) =>
                    item.children ? (
                      <DesktopDropdown key={item.label} item={item} />
                    ) : (
                      <Button
                        key={item.label}
                        component={RouterLink}
                        to={item.to!}
                        sx={{
                          color: "text.primary",
                          fontWeight: 600,
                          fontSize: "0.95rem",
                          px: 1.5,
                          "&:hover": {
                            backgroundColor: "rgba(63,81,181,0.06)",
                          },
                        }}
                      >
                        {item.label}
                      </Button>
                    ),
                  )}
                </Box>

                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, ml: 2 }}>
                  <Link
                    component={RouterLink}
                    to="/contact"
                    underline="none"
                    sx={{
                      color: "text.primary",
                      fontWeight: 600,
                      fontSize: "0.95rem",
                      "&:hover": { color: "primary.main" },
                    }}
                  >
                    Talk to us
                  </Link>
                  <Button
                    variant="contained"
                    color="primary"
                    sx={{ px: 3, py: 1.1, fontSize: "0.95rem" }}
                  >
                    Start Free
                  </Button>
                </Box>
              </>
            ) : (
              <IconButton
                edge="end"
                aria-label="Open navigation menu"
                onClick={() => setMobileOpen(true)}
                sx={{ color: "text.primary" }}
              >
                <MenuIcon />
              </IconButton>
            )}
          </Toolbar>
        </Container>
      </AppBar>

      <Drawer
        anchor="right"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        slotProps={{ paper: { sx: { width: { xs: "100%", sm: 380 }, p: 2 } } }}
      >
        <Box
          sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}
        >
          <BrandLogo dense />
          <IconButton aria-label="Close navigation menu" onClick={() => setMobileOpen(false)}>
            <CloseIcon />
          </IconButton>
        </Box>

        <List sx={{ mt: 1 }}>
          {NAV_ITEMS.map((item) =>
            item.children ? (
              <Box key={item.label} sx={{ mb: 1 }}>
                <Typography
                  variant="overline"
                  sx={{ px: 2, color: "text.secondary", fontWeight: 700, letterSpacing: "0.08em" }}
                >
                  {item.label}
                </Typography>
                {item.children.map((child) => (
                  <ListItemButton
                    key={child.to}
                    component={RouterLink}
                    to={child.to}
                    selected={location.pathname === child.to}
                    onClick={() => setMobileOpen(false)}
                    sx={{ borderRadius: 2, pl: 2 }}
                  >
                    <ListItemText
                      primary={child.label}
                      slotProps={{ primary: { sx: { fontWeight: 500 } } }}
                    />
                  </ListItemButton>
                ))}
              </Box>
            ) : (
              <ListItemButton
                key={item.label}
                component={RouterLink}
                to={item.to!}
                selected={location.pathname === item.to}
                onClick={() => setMobileOpen(false)}
                sx={{ borderRadius: 2 }}
              >
                <ListItemText
                  primary={item.label}
                  slotProps={{ primary: { sx: { fontWeight: 600 } } }}
                />
              </ListItemButton>
            ),
          )}
        </List>

        <Box sx={{ mt: "auto", pt: 3, display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Button variant="contained" color="primary" size="large" fullWidth>
            Start Free
          </Button>
          <Button
            component={RouterLink}
            to="/contact"
            variant="outlined"
            size="large"
            fullWidth
            onClick={() => setMobileOpen(false)}
          >
            Talk to us
          </Button>
        </Box>
      </Drawer>
    </>
  );
}
