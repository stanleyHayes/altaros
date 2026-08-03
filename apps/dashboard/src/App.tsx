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
import PeoplePage from "@/pages/PeoplePage";
import NotFoundPage from "@/pages/NotFoundPage";
import RouteScrollTop from "@/components/layout/RouteScrollTop";
import PermissionsGate from "@/components/auth/PermissionsGate";
import Guarded from "@/components/auth/Guarded";

export default function App() {
  const [showSplash, setShowSplash] = useState(true);

  if (showSplash) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <SplashScreen context="Preparing the church workspace" onComplete={() => setShowSplash(false)} />
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
          {/* Inside AuthProvider so it knows whether there is a session to
              resolve permissions for, and outside the router so one resolution
              serves every route rather than one per navigation. */}
          <PermissionsGate>
            <BrowserRouter>
              <RouteScrollTop />
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />

                <Route path="/" element={<MainLayout />}>
                  <Route index element={<Navigate to="/dashboard" replace />} />

                  {/* Every route below is wrapped in the permission its path
                      declares in navigation.tsx. Guarded reads the requirement
                      from that one list, so a hidden nav item and a blocked
                      route are the same statement rather than two that have to
                      be kept in agreement by hand.

                      The server enforces the same permission independently —
                      this is what someone SEES, never what they may DO. */}
                  <Route
                    path="dashboard"
                    element={
                      <Guarded path="/dashboard">
                        <DashboardPage />
                      </Guarded>
                    }
                  />
                  <Route
                    path="members"
                    element={
                      <Guarded path="/members">
                        <MembersPage />
                      </Guarded>
                    }
                  />
                  <Route
                    path="finance"
                    element={
                      <Guarded path="/finance">
                        <FinancePage />
                      </Guarded>
                    }
                  />
                  <Route
                    path="events"
                    element={
                      <Guarded path="/events">
                        <EventsPage />
                      </Guarded>
                    }
                  />
                  <Route
                    path="communications"
                    element={
                      <Guarded path="/communications">
                        <CommunicationsPage />
                      </Guarded>
                    }
                  />
                  <Route
                    path="analytics"
                    element={
                      <Guarded path="/analytics">
                        <AnalyticsPage />
                      </Guarded>
                    }
                  />
                  <Route
                    path="departments"
                    element={
                      <Guarded path="/departments">
                        <DepartmentsPage />
                      </Guarded>
                    }
                  />
                  <Route
                    path="families"
                    element={
                      <Guarded path="/families">
                        <FamiliesPage />
                      </Guarded>
                    }
                  />
                  <Route
                    path="ai"
                    element={
                      <Guarded path="/ai">
                        <AiPage />
                      </Guarded>
                    }
                  />
                  <Route
                    path="inter-church"
                    element={
                      <Guarded path="/inter-church">
                        <InterChurchPage />
                      </Guarded>
                    }
                  />
                  <Route
                    path="people"
                    element={
                      <Guarded path="/people">
                        <PeoplePage />
                      </Guarded>
                    }
                  />
                  <Route
                    path="settings"
                    element={
                      <Guarded path="/settings">
                        <SettingsPage />
                      </Guarded>
                    }
                  />
                </Route>

                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </BrowserRouter>
          </PermissionsGate>
        </AuthProvider>
      </SnackbarProvider>
    </ThemeProvider>
  );
}
