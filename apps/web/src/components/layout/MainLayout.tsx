import { Navigate, Outlet } from "react-router-dom";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import TopBar from "./TopBar";
import BottomNav from "./BottomNav";
import { useAuth } from "@/hooks/useAuth";

export default function MainLayout() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
        }}
      >
        <CircularProgress color="primary" />
      </Box>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <TopBar />
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          pt: "64px",
          pb: "76px",
          px: 2,
          bgcolor: "background.default",
          overflowY: "auto",
        }}
      >
        <Outlet />
      </Box>
      <BottomNav />
    </Box>
  );
}
