import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Button,
  TextField,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  InputAdornment,
} from "@mui/material";
import SEO from "@/components/ui/SEO";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SearchIcon from "@mui/icons-material/Search";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import PaymentIcon from "@mui/icons-material/Payment";
import SettingsIcon from "@mui/icons-material/Settings";
import BuildIcon from "@mui/icons-material/Build";

const categories = [
  { label: "All", value: "all" },
  { label: "Getting Started", value: "getting-started", icon: <RocketLaunchIcon sx={{ fontSize: 18 }} /> },
  { label: "Billing", value: "billing", icon: <PaymentIcon sx={{ fontSize: 18 }} /> },
  { label: "Features", value: "features", icon: <SettingsIcon sx={{ fontSize: 18 }} /> },
  { label: "Technical", value: "technical", icon: <BuildIcon sx={{ fontSize: 18 }} /> },
];

const faqs = [
  {
    question: "How do I get started with ALTAR OS?",
    answer:
      "Sign up for a free account at altaros.io/register. Once registered, you can set up your church profile, invite team members, and start adding members to your CRM. Our onboarding wizard will guide you through each step.",
    category: "getting-started",
  },
  {
    question: "How do I add members to my church?",
    answer:
      "Navigate to the Members section in your dashboard. You can add members individually by clicking 'Add Member', or use the bulk import feature to upload a CSV file with your existing member data.",
    category: "getting-started",
  },
  {
    question: "What payment methods does ALTAR OS support?",
    answer:
      "ALTAR OS supports credit/debit cards, mobile money (MTN, Vodafone Cash, AirtelTigo), bank transfers via Paystack, and cryptocurrency donations. Members can choose their preferred payment method when giving.",
    category: "billing",
  },
  {
    question: "Can I change my subscription plan?",
    answer:
      "Yes, you can upgrade or downgrade your plan at any time from the Billing section in your dashboard. Changes take effect immediately, and we will pro-rate any differences.",
    category: "billing",
  },
  {
    question: "How does QR code attendance work?",
    answer:
      "Each event generates a unique QR code. Members scan the code with their phone camera or the ALTAR OS app when they arrive. Attendance is recorded instantly, and you can view real-time check-in data from your dashboard.",
    category: "features",
  },
  {
    question: "Can I send SMS messages to my congregation?",
    answer:
      "Yes, ALTAR OS integrates with Africa's Talking to enable SMS messaging. You can send messages to all members, specific groups, or individual contacts. SMS credits are included in your plan or can be purchased separately.",
    category: "features",
  },
  {
    question: "How do the AI tools work?",
    answer:
      "Our AI tools analyze your church data to provide insights and assistance. The Sermon Assistant generates outlines from topics, Member Insights detects engagement patterns, and the Prayer Assistant offers scripture-based guidance. All AI features run securely and respect your data privacy.",
    category: "features",
  },
  {
    question: "Is my church data secure?",
    answer:
      "Absolutely. ALTAR OS uses enterprise-grade encryption for data at rest and in transit. We are hosted on secure cloud infrastructure with regular backups, and we never share your data with third parties. You can review our full security practices in our Privacy Policy.",
    category: "technical",
  },
  {
    question: "Can I integrate ALTAR OS with other tools?",
    answer:
      "Yes, ALTAR OS provides a RESTful API for custom integrations. We also offer pre-built integrations with Paystack, Africa's Talking, Firebase, and Cloudinary. Visit our API documentation for details.",
    category: "technical",
  },
  {
    question: "What happens if I cancel my subscription?",
    answer:
      "If you cancel, your account will remain active until the end of your billing period. After that, your data is preserved for 90 days in case you want to reactivate. You can export your data at any time.",
    category: "billing",
  },
];

export default function HelpPage() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");

  const filteredFaqs = faqs.filter((faq) => {
    const matchesSearch =
      search === "" ||
      faq.question.toLowerCase().includes(search.toLowerCase()) ||
      faq.answer.toLowerCase().includes(search.toLowerCase());
    const matchesCategory =
      activeCategory === "all" || faq.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <>
      <SEO
        title="Help Center"
        description="Find answers to common questions about ALTAR OS. Browse FAQs on getting started, billing, features, and technical topics."
      />

      {/* Hero */}
      <Box
        sx={{
          pt: { xs: 16, md: 20 },
          pb: { xs: 8, md: 12 },
          background:
            "linear-gradient(135deg, #1A1A2E 0%, #3F51B5 40%, #7C4DFF 100%)",
          textAlign: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse at 30% 50%, rgba(124,77,255,0.3) 0%, transparent 60%)",
            pointerEvents: "none",
          }}
        />
        <Container maxWidth="md" sx={{ position: "relative", zIndex: 1 }}>
          <Typography
            variant="overline"
            sx={{
              color: "#FFB300",
              fontWeight: 700,
              letterSpacing: "0.15em",
              mb: 1,
              display: "block",
            }}
          >
            Help Center
          </Typography>
          <Typography variant="h1" sx={{ color: "#fff", mb: 4 }}>
            How Can We Help?
          </Typography>
          <TextField
            fullWidth
            placeholder="Search for answers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: "rgba(255,255,255,0.5)" }} />
                  </InputAdornment>
                ),
              },
            }}
            sx={{
              maxWidth: 500,
              mx: "auto",
              "& .MuiOutlinedInput-root": {
                backgroundColor: "rgba(255,255,255,0.1)",
                borderRadius: "14px",
                color: "#fff",
                "& fieldset": { borderColor: "rgba(255,255,255,0.2)" },
                "&:hover fieldset": { borderColor: "rgba(255,255,255,0.4)" },
                "&.Mui-focused fieldset": { borderColor: "#FFB300" },
              },
              "& .MuiInputBase-input::placeholder": {
                color: "rgba(255,255,255,0.5)",
                opacity: 1,
              },
            }}
          />
        </Container>
      </Box>

      {/* FAQ */}
      <Box sx={{ py: { xs: 8, md: 12 }, backgroundColor: "#FFFFFF" }}>
        <Container maxWidth="md">
          {/* Category filters */}
          <Box
            sx={{
              display: "flex",
              gap: 1,
              mb: 4,
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            {categories.map((cat) => (
              <Chip
                key={cat.value}
                label={cat.label}
                icon={cat.icon}
                onClick={() => setActiveCategory(cat.value)}
                sx={{
                  fontWeight: 600,
                  backgroundColor:
                    activeCategory === cat.value
                      ? "primary.main"
                      : "rgba(63,81,181,0.08)",
                  color:
                    activeCategory === cat.value ? "#fff" : "text.primary",
                  "&:hover": {
                    backgroundColor:
                      activeCategory === cat.value
                        ? "primary.dark"
                        : "rgba(63,81,181,0.15)",
                  },
                }}
              />
            ))}
          </Box>

          {/* Accordion */}
          {filteredFaqs.length === 0 ? (
            <Box sx={{ textAlign: "center", py: 6 }}>
              <Typography
                variant="h6"
                sx={{ color: "text.secondary", mb: 1 }}
              >
                No results found
              </Typography>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Try adjusting your search or category filter.
              </Typography>
            </Box>
          ) : (
            filteredFaqs.map((faq, index) => (
              <Accordion
                key={index}
                sx={{
                  mb: 1,
                  border: "1px solid rgba(0,0,0,0.06)",
                  boxShadow: "none",
                  borderRadius: "12px !important",
                  "&::before": { display: "none" },
                  "&:hover": { borderColor: "primary.main" },
                }}
              >
                <AccordionSummary
                  expandIcon={<ExpandMoreIcon />}
                  sx={{ py: 1 }}
                >
                  <Typography variant="h6" sx={{ fontWeight: 600 }}>
                    {faq.question}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0 }}>
                  <Typography
                    variant="body1"
                    sx={{ color: "text.secondary", lineHeight: 1.8 }}
                  >
                    {faq.answer}
                  </Typography>
                </AccordionDetails>
              </Accordion>
            ))
          )}
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
            Still Need Help?
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{ color: "rgba(255,255,255,0.8)", mb: 5 }}
          >
            Our support team is here for you. Reach out and we will get back
            to you within 24 hours.
          </Typography>
          <Button
            component={RouterLink}
            to="/contact"
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
            Contact Support
          </Button>
        </Container>
      </Box>
    </>
  );
}
