import { Link as RouterLink } from "react-router-dom";
import { Box, Container, Typography, Button, Divider } from "@mui/material";
import SEO from "@/components/ui/SEO";

const sections = [
  {
    title: "1. Data Collection",
    content: `We collect information that you voluntarily provide when using ALTAR OS, including but not limited to:

- Account registration details (name, email, phone number)
- Church profile information (name, address, denomination)
- Member data you input into the system (member profiles, attendance, giving records)
- Usage data and analytics (pages visited, features used, session duration)
- Device and browser information for optimization purposes
- Communication preferences and consent records

We collect only the data necessary to provide and improve our services. We do not collect sensitive personal data unless explicitly provided by you for church management purposes.`,
  },
  {
    title: "2. Data Usage",
    content: `We use the data we collect to:

- Provide, maintain, and improve the ALTAR OS platform and services
- Process financial transactions (tithes, offerings, donations)
- Send communications you have opted into (notifications, updates, newsletters)
- Generate analytics and insights for your church dashboard
- Provide customer support and respond to inquiries
- Detect and prevent fraud, abuse, and security incidents
- Comply with legal obligations and enforce our terms of service

We do not sell your personal data or your church's member data to third parties. Your congregation's data belongs to your church.`,
  },
  {
    title: "3. Data Sharing",
    content: `We may share data with trusted third-party service providers who assist us in operating the platform:

- Payment processors (Paystack) for handling financial transactions
- Communication providers (Africa's Talking) for SMS delivery
- Cloud infrastructure providers for hosting and storage
- Analytics services for platform improvement

All third-party providers are contractually obligated to protect your data and use it only for the purposes we specify. We do not share your data for advertising or marketing by third parties.`,
  },
  {
    title: "4. Security",
    content: `We implement industry-standard security measures to protect your data:

- All data is encrypted in transit using TLS 1.2 or higher
- Data at rest is encrypted using AES-256 encryption
- Regular security audits and vulnerability assessments
- Access controls and role-based permissions
- Regular automated backups with disaster recovery procedures
- Incident response procedures for prompt handling of security events

While we strive to protect your data, no method of electronic storage or transmission is 100% secure. We encourage you to use strong passwords and enable two-factor authentication.`,
  },
  {
    title: "5. Cookies",
    content: `ALTAR OS uses cookies and similar technologies to:

- Maintain your session and authentication state
- Remember your preferences and settings
- Analyze usage patterns to improve our platform
- Provide security features

You can manage cookie preferences through your browser settings. Disabling certain cookies may affect the functionality of the platform. For more details, please review our Cookie Policy.`,
  },
  {
    title: "6. Your Rights",
    content: `You have the following rights regarding your data:

- Access: Request a copy of the personal data we hold about you
- Correction: Request correction of inaccurate or incomplete data
- Deletion: Request deletion of your personal data, subject to legal requirements
- Portability: Request your data in a structured, machine-readable format
- Objection: Object to certain types of data processing
- Withdrawal: Withdraw consent for data processing at any time

Church administrators can export all church data at any time through the platform. To exercise any of these rights, contact us at privacy@altaros.io.`,
  },
  {
    title: "7. Contact",
    content: `If you have questions about this Privacy Policy or our data practices, please contact us:

- Email: privacy@altaros.io
- Address: ALTAR OS, Accra, Ghana
- Data Protection: For data protection inquiries, email dpo@altaros.io

We will respond to all privacy-related inquiries within 30 days.`,
  },
];

export default function PrivacyPage() {
  return (
    <>
      <SEO
        title="Privacy Policy"
        description="ALTAR OS Privacy Policy — how we collect, use, share, and protect your data. Your church's data belongs to your church."
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
            Privacy Policy
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
            ALTAR OS ("we", "our", "us") is committed to protecting the
            privacy of our users and the churches they serve. This Privacy
            Policy explains how we collect, use, share, and protect your
            information when you use the ALTAR OS platform and related
            services.
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
            Your data is safe with us. Start your free trial today.
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
