import { Link as RouterLink } from "react-router-dom";
import { Box, Container, Typography, Button, Divider } from "@mui/material";
import SEO from "@/components/ui/SEO";

const sections = [
  {
    title: "1. What Are Cookies",
    content: `Cookies are small text files that are placed on your device (computer, tablet, or mobile phone) when you visit a website. They are widely used to make websites work more efficiently, provide a better user experience, and give website owners useful information.

Cookies can be "persistent" (remaining on your device until they expire or you delete them) or "session" cookies (deleted when you close your browser). They can be set by the website you are visiting ("first-party cookies") or by other websites whose content appears on the page ("third-party cookies").`,
  },
  {
    title: "2. Types of Cookies We Use",
    content: `ALTAR OS uses the following categories of cookies:

Essential Cookies: These are necessary for the platform to function properly. They enable core functionality such as security, authentication, and session management. You cannot opt out of these cookies as they are required for the service to work.

Performance Cookies: These cookies collect information about how you use the platform, such as which pages you visit most often and whether you encounter error messages. This data helps us improve the performance and usability of ALTAR OS.

Functionality Cookies: These remember your preferences and settings (such as language, timezone, or display preferences) to provide a more personalized experience.

Analytics Cookies: We use analytics cookies to understand how visitors interact with our website. This information is collected anonymously and used to improve our content and user experience.`,
  },
  {
    title: "3. How to Manage Cookies",
    content: `You can control and manage cookies in several ways:

Browser Settings: Most browsers allow you to view, manage, and delete cookies through their settings. The exact process varies by browser:
- Chrome: Settings > Privacy and Security > Cookies
- Firefox: Settings > Privacy & Security > Cookies
- Safari: Preferences > Privacy > Manage Website Data
- Edge: Settings > Cookies and Site Permissions

Please note that disabling certain cookies may affect the functionality of the ALTAR OS platform. Essential cookies cannot be disabled as they are required for the service to operate.

Opt-Out Tools: You can opt out of analytics cookies using tools provided by analytics services. We honor "Do Not Track" browser signals where applicable.

If you have questions about managing cookies on the ALTAR OS platform, please contact us at privacy@altaros.io.`,
  },
  {
    title: "4. Third-Party Cookies",
    content: `Some cookies on the ALTAR OS platform are set by third-party services that we use:

Analytics Providers: We use analytics services to understand platform usage patterns. These providers may set their own cookies to collect anonymized data.

Payment Processors: When you make a payment through ALTAR OS, our payment processor (Paystack) may set cookies to facilitate secure transactions and fraud prevention.

Communication Services: Third-party communication tools integrated with ALTAR OS may set cookies for functionality and performance purposes.

We do not allow third parties to use cookies on our platform for advertising purposes. All third-party cookies are used solely to support the functionality and improvement of our services.

For more information about how these third parties handle your data, please refer to their respective privacy policies.`,
  },
];

export default function CookiesPage() {
  return (
    <>
      <SEO
        title="Cookie Policy"
        description="ALTAR OS Cookie Policy — what cookies we use, how to manage them, and information about third-party cookies on our platform."
      />

      {/* Hero */}
      <Box
        sx={{
          pt: { xs: 16, md: 20 },
          pb: { xs: 6, md: 8 },
          background:
            "linear-gradient(135deg, #1A1A2E 0%, #3F51B5 40%, #7C4DFF 100%)",
          textAlign: "center",
        }}
      >
        <Container maxWidth="md">
          <Typography variant="h1" sx={{ color: "#fff", mb: 2 }}>
            Cookie Policy
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{ color: "rgba(255,255,255,0.8)" }}
          >
            Last updated: April 1, 2026
          </Typography>
        </Container>
      </Box>

      {/* Content */}
      <Box sx={{ py: { xs: 6, md: 10 }, backgroundColor: "#FFFFFF" }}>
        <Container maxWidth="md">
          <Typography
            variant="body1"
            sx={{ color: "text.secondary", lineHeight: 1.9, mb: 4 }}
          >
            This Cookie Policy explains how ALTAR OS uses cookies and similar
            tracking technologies when you visit our platform. It describes
            what these technologies are, why we use them, and your rights to
            control their use.
          </Typography>

          {sections.map((section, index) => (
            <Box key={section.title} sx={{ mb: 4 }}>
              <Typography variant="h4" sx={{ mb: 2, fontWeight: 700 }}>
                {section.title}
              </Typography>
              <Typography
                variant="body1"
                sx={{
                  color: "text.secondary",
                  lineHeight: 1.9,
                  whiteSpace: "pre-line",
                }}
              >
                {section.content}
              </Typography>
              {index < sections.length - 1 && <Divider sx={{ mt: 4 }} />}
            </Box>
          ))}
        </Container>
      </Box>

      {/* CTA */}
      <Box
        sx={{
          py: { xs: 10, md: 14 },
          background:
            "linear-gradient(135deg, #1A1A2E 0%, #3F51B5 40%, #7C4DFF 100%)",
          textAlign: "center",
        }}
      >
        <Container maxWidth="md">
          <Typography
            variant="h2"
            sx={{ color: "#fff", mb: 2, fontWeight: 800 }}
          >
            Ready to Get Started?
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{ color: "rgba(255,255,255,0.8)", mb: 5 }}
          >
            Your privacy matters. Start your free trial today.
          </Typography>
          <Button
            component={RouterLink}
            to="/register"
            variant="contained"
            color="secondary"
            size="large"
            sx={{
              px: 6,
              py: 2,
              fontSize: "1.15rem",
              color: "#1A1A2E",
              boxShadow: "0 4px 24px rgba(255,179,0,0.4)",
              "&:hover": {
                boxShadow: "0 6px 32px rgba(255,179,0,0.5)",
                transform: "translateY(-2px)",
              },
              transition: "all 0.3s ease",
            }}
          >
            Start Free Trial
          </Button>
        </Container>
      </Box>
    </>
  );
}
