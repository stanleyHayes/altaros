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
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
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
          minHeight: "100vh",
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
          sx={{
            flexGrow: 1,
            p: { xs: 2, sm: 3 },
            bgcolor: "background.default",
          }}
        >
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
