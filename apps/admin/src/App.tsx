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
import RouteScrollTop from "@/components/layout/RouteScrollTop";

export default function App() {
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
              </Route>
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </AuthProvider>
        </SnackbarProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
