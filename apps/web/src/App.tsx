import { useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { SnackbarProvider } from "notistack";
import { theme } from "@/theme";
import { AuthProvider } from "@/context/AuthContext";
import MainLayout from "@/components/layout/MainLayout";
import SplashScreen from "@/components/ui/SplashScreen";
import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";
import OtpPage from "@/pages/OtpPage";
import HomePage from "@/pages/HomePage";
import SpiritualPage from "@/pages/SpiritualPage";
import GivingPage from "@/pages/GivingPage";
import SocialPage from "@/pages/SocialPage";
import EventsPage from "@/pages/EventsPage";
import ProfilePage from "@/pages/ProfilePage";
import WelfarePage from "@/pages/WelfarePage";
import DiscoverPage from "@/pages/DiscoverPage";
import ChatsPage from "@/pages/ChatsPage";
import NotFoundPage from "@/pages/NotFoundPage";
import RouteScrollTop from "@/components/layout/RouteScrollTop";

export default function App() {
  const [showSplash, setShowSplash] = useState(true);

  if (showSplash) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <SplashScreen context="Opening your member space" onComplete={() => setShowSplash(false)} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <SnackbarProvider
        maxSnack={3}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        autoHideDuration={3000}
      >
        <AuthProvider>
          <BrowserRouter>
            <RouteScrollTop />
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/otp" element={<OtpPage />} />

              {/* Protected routes */}
              <Route element={<MainLayout />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/spiritual" element={<SpiritualPage />} />
                <Route path="/giving" element={<GivingPage />} />
                <Route path="/social" element={<SocialPage />} />
                <Route path="/events" element={<EventsPage />} />
                <Route path="/chats" element={<ChatsPage />} />
                <Route path="/welfare" element={<WelfarePage />} />
                <Route path="/discover" element={<DiscoverPage />} />
                <Route path="/profile" element={<ProfilePage />} />
              </Route>

              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </SnackbarProvider>
    </ThemeProvider>
  );
}
