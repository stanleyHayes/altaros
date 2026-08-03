import { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { SnackbarProvider } from "notistack";
import theme from "@/theme";
import { AuthProvider } from "@/context/AuthContext";
import MainLayout from "@/components/layout/MainLayout";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import ChurchesPage from "@/pages/ChurchesPage";
import UsersPage from "@/pages/UsersPage";
import FinancePage from "@/pages/FinancePage";
import SystemHealthPage from "@/pages/SystemHealthPage";
import NotFoundPage from "@/pages/NotFoundPage";
import PlansPage from "@/pages/PlansPage";
import ControlModulePage from "@/pages/ControlModulePage";
import RouteScrollTop from "@/components/layout/RouteScrollTop";
import SplashScreen from "@/components/ui/SplashScreen";

export default function App() {
  const [showSplash, setShowSplash] = useState(true);

  if (showSplash) {
    return <ThemeProvider theme={theme}><CssBaseline /><SplashScreen context="Opening platform operations" onComplete={() => setShowSplash(false)} /></ThemeProvider>;
  }

  return (
    <BrowserRouter>
      <RouteScrollTop />
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <SnackbarProvider maxSnack={3} autoHideDuration={4000}>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<MainLayout />}>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="churches" element={<ChurchesPage />} />
                <Route path="users" element={<UsersPage />} />
                <Route path="finance" element={<FinancePage />} />
                <Route path="system" element={<SystemHealthPage />} />
                <Route path="plans" element={<PlansPage />} />
                <Route path="notifications" element={<ControlModulePage module="notifications" />} />
                <Route path="reports" element={<ControlModulePage module="reports" />} />
                <Route path="access" element={<ControlModulePage module="access" />} />
                <Route path="support" element={<ControlModulePage module="support" />} />
                <Route path="audit" element={<ControlModulePage module="audit" />} />
                <Route path="integrations" element={<ControlModulePage module="integrations" />} />
                <Route path="settings" element={<ControlModulePage module="settings" />} />
              </Route>
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </AuthProvider>
        </SnackbarProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
