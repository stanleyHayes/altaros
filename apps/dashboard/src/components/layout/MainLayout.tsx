import { useState } from "react";
import { Outlet, Navigate } from "react-router-dom";
import { Box, useTheme, useMediaQuery } from "@mui/material";
import Sidebar, { DRAWER_WIDTH, DRAWER_WIDTH_COLLAPSED } from "./Sidebar";
import Header from "./Header";
import LoadingScreen from "@/components/ui/LoadingScreen";
import { useAuth } from "@/hooks/useAuth";

export default function MainLayout() {
  const { isAuthenticated, isLoading } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const sidebarWidth = isMobile
    ? 0
    : collapsed
      ? DRAWER_WIDTH_COLLAPSED
      : DRAWER_WIDTH;

  return (
    <Box sx={{ display: "flex", minHeight: "100dvh", bgcolor: "background.default" }}>
      <Sidebar
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((prev) => !prev)}
      />

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: { md: `calc(100% - ${sidebarWidth}px)` },
          display: "flex",
          flexDirection: "column",
          minHeight: "100dvh",
          minWidth: 0,
        }}
      >
        <Header
          onMenuToggle={() =>
            isMobile
              ? setMobileOpen((prev) => !prev)
              : setCollapsed((prev) => !prev)
          }
          sidebarCollapsed={collapsed}
          onExpandSidebar={() => setCollapsed(false)}
        />

        <Box
          data-route-scroll-container
          sx={{
            flexGrow: 1,
            px: { xs: 2, sm: 3, xl: 4 },
            pt: { xs: 2.5, md: 3 },
            pb: { xs: 5, md: 7 },
            bgcolor: "background.default",
            backgroundImage: "linear-gradient(rgba(21,127,115,.025) 1px, transparent 1px), linear-gradient(90deg, rgba(21,127,115,.025) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
            "& > *": { width: "100%", maxWidth: 1540, mx: "auto" },
          }}
        >
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
