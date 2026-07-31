import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { HelmetProvider } from "react-helmet-async";
import { theme } from "@/theme";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import HomePage from "@/pages/HomePage";
import FeaturesPage from "@/pages/FeaturesPage";
import AiToolsPage from "@/pages/AiToolsPage";
import MobileAppPage from "@/pages/MobileAppPage";
import IntegrationsPage from "@/pages/IntegrationsPage";
import AboutPage from "@/pages/AboutPage";
import BlogPage from "@/pages/BlogPage";
import ContactPage from "@/pages/ContactPage";
import CareersPage from "@/pages/CareersPage";
import HelpPage from "@/pages/HelpPage";
import PrivacyPage from "@/pages/PrivacyPage";
import TermsPage from "@/pages/TermsPage";
import CookiesPage from "@/pages/CookiesPage";
import SolutionsPastorsPage from "@/pages/SolutionsPastorsPage";
import SolutionsChurchesPage from "@/pages/SolutionsChurchesPage";
import SolutionsDenominationsPage from "@/pages/SolutionsDenominationsPage";
import ChangelogPage from "@/pages/ChangelogPage";
import DocsPage from "@/pages/DocsPage";
import PressPage from "@/pages/PressPage";
import NotFoundPage from "@/pages/NotFoundPage";

export default function App() {
  return (
    <HelmetProvider>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter>
          <Navbar />
          <main>
            <Routes>
              <Route path="/" element={<HomePage />} />

              {/* Product */}
              <Route path="/features" element={<FeaturesPage />} />
              <Route path="/ai-tools" element={<AiToolsPage />} />
              <Route path="/mobile-app" element={<MobileAppPage />} />
              <Route path="/integrations" element={<IntegrationsPage />} />
              <Route path="/changelog" element={<ChangelogPage />} />

              {/* Solutions */}
              <Route path="/solutions/pastors" element={<SolutionsPastorsPage />} />
              <Route path="/solutions/churches" element={<SolutionsChurchesPage />} />
              <Route path="/solutions/denominations" element={<SolutionsDenominationsPage />} />

              {/* Resources */}
              <Route path="/blog" element={<BlogPage />} />
              <Route path="/docs" element={<DocsPage />} />
              <Route path="/api" element={<DocsPage />} />
              <Route path="/help" element={<HelpPage />} />

              {/* Company */}
              <Route path="/about" element={<AboutPage />} />
              <Route path="/careers" element={<CareersPage />} />
              <Route path="/contact" element={<ContactPage />} />
              <Route path="/press" element={<PressPage />} />

              {/* Legal */}
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/terms" element={<TermsPage />} />
              <Route path="/cookies" element={<CookiesPage />} />

              {/* Catch-all routes */}
              <Route path="/solutions/*" element={<SolutionsChurchesPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </main>
          <Footer />
        </BrowserRouter>
      </ThemeProvider>
    </HelmetProvider>
  );
}
