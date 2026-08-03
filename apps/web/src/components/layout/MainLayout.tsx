import { Navigate, Outlet } from "react-router-dom";
import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import TopBar from "./TopBar";
import BottomNav from "./BottomNav";
import MemberSidebar from "./MemberSidebar";
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
          minHeight: "100dvh",
        }}
      >
        <Box sx={{ width: "min(88vw, 520px)" }}><Skeleton variant="rounded" height={72} /><Skeleton variant="rounded" height={220} sx={{ mt: 2 }} /></Box>
      </Box>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Box sx={{ display: "flex", minHeight: "100dvh", bgcolor: "background.default" }}>
      <MemberSidebar />
      <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        <TopBar />
        <Box
          component="main"
          data-route-scroll-container
          sx={{
            flexGrow: 1,
            pb: { xs: "104px", md: 6 },
            px: { xs: 2, sm: 3, lg: 4 },
            bgcolor: "background.default",
          }}
        >
          <Box sx={{ width: "100%", maxWidth: 1320, mx: "auto" }}><Outlet /></Box>
        </Box>
      </Box>
      <BottomNav />
    </Box>
  );
}
