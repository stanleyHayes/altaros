import { useState } from "react";
import { Outlet, Navigate } from "react-router-dom";
import { Box, Skeleton } from "@mui/material";
import { useAuth } from "@/hooks/useAuth";
import Sidebar from "./Sidebar";
import Header from "./Header";

export default function MainLayout() {
  const { isAuthenticated, isLoading } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (isLoading) {
    return (
      <Box
        sx={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "background.default",
        }}
      >
        <Box sx={{ width: 320 }}><Skeleton variant="rounded" height={72} /><Skeleton sx={{ mt: 2 }} /><Skeleton width="65%" /></Box>
      </Box>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Box sx={{ display: "flex", minHeight: "100dvh", bgcolor: "background.default" }}>
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <Box
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        <Header onMenuToggle={() => setSidebarOpen((o) => !o)} />
        <Box
          component="main"
          data-route-scroll-container
          sx={{
            flex: 1,
            p: { xs: 2, sm: 3, xl: 4 },
            bgcolor: "background.default",
            overflow: "auto",
          }}
        >
          <Box sx={{ width: "100%", maxWidth: 1540, mx: "auto" }}><Outlet /></Box>
        </Box>
      </Box>
    </Box>
  );
}
