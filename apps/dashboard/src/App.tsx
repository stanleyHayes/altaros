import { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { SnackbarProvider } from "notistack";
import { theme } from "@/theme";
import { AuthProvider } from "@/context/AuthContext";
import MainLayout from "@/components/layout/MainLayout";
import SplashScreen from "@/components/ui/SplashScreen";
import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";
import DashboardPage from "@/pages/DashboardPage";
import MembersPage from "@/pages/MembersPage";
import FinancePage from "@/pages/FinancePage";
import EventsPage from "@/pages/EventsPage";
import CommunicationsPage from "@/pages/CommunicationsPage";
import AnalyticsPage from "@/pages/AnalyticsPage";
import SettingsPage from "@/pages/SettingsPage";
import DepartmentsPage from "@/pages/DepartmentsPage";
import FamiliesPage from "@/pages/FamiliesPage";
import AiPage from "@/pages/AiPage";
import InterChurchPage from "@/pages/InterChurchPage";
import NotFoundPage from "@/pages/NotFoundPage";

export default function App() {
  const [showSplash, setShowSplash] = useState(true);

  if (showSplash) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <SplashScreen onComplete={() => setShowSplash(false)} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <SnackbarProvider
        maxSnack={3}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        autoHideDuration={4000}
      >
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />

              <Route path="/" element={<MainLayout />}>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="members" element={<MembersPage />} />
                <Route path="finance" element={<FinancePage />} />
                <Route path="events" element={<EventsPage />} />
                <Route
                  path="communications"
                  element={<CommunicationsPage />}
                />
                <Route path="analytics" element={<AnalyticsPage />} />
                <Route path="departments" element={<DepartmentsPage />} />
                <Route path="families" element={<FamiliesPage />} />
                <Route path="ai" element={<AiPage />} />
                <Route path="inter-church" element={<InterChurchPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>

              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </SnackbarProvider>
    </ThemeProvider>
  );
}
