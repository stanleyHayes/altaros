import { Link as RouterLink } from "react-router-dom";
import { Box, Container, Typography, Button, Divider } from "@mui/material";
import SEO from "@/components/ui/SEO";

const sections = [
  {
    title: "1. Account Terms",
    content: `By creating an account on ALTAR OS, you agree to the following:

- You must be at least 18 years of age to create an account
- You must provide accurate and complete registration information
- You are responsible for maintaining the security of your account credentials
- You are responsible for all activity that occurs under your account
- You must notify us immediately of any unauthorized use of your account
- One person or legal entity may not maintain more than one free account
- You may not use the service for any illegal or unauthorized purpose`,
  },
  {
    title: "2. Payment Terms",
    content: `For paid subscription plans:

- Subscription fees are billed in advance on a monthly or annual basis
- All fees are non-refundable except as required by law or as stated in our refund policy
- You authorize us to charge your payment method for recurring subscription fees
- We reserve the right to change pricing with 30 days advance notice
- Failure to pay may result in suspension or termination of your account
- All amounts are stated in the applicable currency and are exclusive of taxes unless stated otherwise
- Mobile money and cryptocurrency transactions are subject to the processing fees of their respective providers`,
  },
  {
    title: "3. Acceptable Use",
    content: `You agree not to use ALTAR OS to:

- Violate any applicable laws or regulations
- Infringe upon the intellectual property rights of others
- Transmit any malware, viruses, or harmful code
- Attempt to gain unauthorized access to our systems or other users' accounts
- Send unsolicited communications (spam) through our messaging features
- Store or transmit content that is defamatory, obscene, or otherwise objectionable
- Interfere with or disrupt the integrity or performance of the platform
- Use the platform for purposes not related to legitimate church or ministry operations
- Resell, sublicense, or redistribute the service without our written consent`,
  },
  {
    title: "4. Data Ownership",
    content: `Your church's data belongs to your church:

- You retain all rights to the data you enter into ALTAR OS
- We do not claim ownership over your church's member data, financial records, or content
- You grant us a limited license to use your data solely to provide and improve the service
- You may export your data at any time in standard formats
- Upon account termination, we retain your data for 90 days, after which it may be permanently deleted
- We may use anonymized, aggregated data for analytics and service improvement purposes`,
  },
  {
    title: "5. Termination",
    content: `Either party may terminate this agreement:

- You may cancel your subscription at any time through your account settings
- We may suspend or terminate your account if you violate these terms
- We may terminate accounts that have been inactive for more than 12 months (free tier)
- Upon termination, your right to use the service ceases immediately
- We will provide reasonable notice before termination, except in cases of terms violations
- Sections relating to data ownership, limitation of liability, and governing law survive termination`,
  },
  {
    title: "6. Limitation of Liability",
    content: `To the maximum extent permitted by law:

- ALTAR OS is provided "as is" without warranties of any kind, express or implied
- We do not warrant that the service will be uninterrupted, secure, or error-free
- We are not liable for any indirect, incidental, special, or consequential damages
- Our total liability shall not exceed the amount you paid us in the 12 months preceding the claim
- We are not responsible for any loss of data resulting from circumstances beyond our reasonable control
- You acknowledge that no technology solution can guarantee 100% availability or security`,
  },
  {
    title: "7. Governing Law",
    content: `These terms are governed by and construed in accordance with the laws of Ghana. Any disputes arising from these terms or your use of ALTAR OS shall be resolved through the courts of Ghana, unless otherwise agreed by both parties.

We encourage parties to first attempt to resolve disputes through good-faith negotiation. If a dispute cannot be resolved informally, it shall be submitted to mediation before proceeding to litigation.

These terms constitute the entire agreement between you and ALTAR OS regarding the use of the service, superseding any prior agreements.`,
  },
];

export default function TermsPage() {
  return (
    <>
      <SEO
        title="Terms of Service"
        description="ALTAR OS Terms of Service — account terms, payment, acceptable use, termination, liability, and governing law."
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
            Terms of Service
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
            These Terms of Service ("Terms") govern your access to and use of
            the ALTAR OS platform and services. By creating an account or
            using our services, you agree to be bound by these Terms. If you
            do not agree, please do not use the platform.
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
            Start your free trial and transform your church today.
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
