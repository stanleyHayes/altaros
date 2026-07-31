import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  Container,
  Divider,
  IconButton,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import XIcon from "@mui/icons-material/X";
import FacebookIcon from "@mui/icons-material/Facebook";
import LinkedInIcon from "@mui/icons-material/LinkedIn";
import YouTubeIcon from "@mui/icons-material/YouTube";

const BRAND_MARK = `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M50 10C30 10 15 25 15 45C15 55 20 65 30 70C25 75 20 80 20 85C20 90 25 95 35 90C40 87 45 82 50 78C55 82 60 87 65 90C75 95 80 90 80 85C80 80 75 75 70 70C80 65 85 55 85 45C85 25 70 10 50 10Z" stroke="currentColor" stroke-width="6" fill="none" stroke-linejoin="round"/>
</svg>`;

const FOOTER_COLUMNS: { heading: string; links: { label: string; to: string }[] }[] = [
  {
    heading: "Product",
    links: [
      { label: "Features", to: "/features" },
      { label: "AI Tools", to: "/ai-tools" },
      { label: "Mobile App", to: "/mobile-app" },
      { label: "Integrations", to: "/integrations" },
      { label: "Changelog", to: "/changelog" },
    ],
  },
  {
    heading: "Solutions",
    links: [
      { label: "For Pastors", to: "/solutions/pastors" },
      { label: "For Churches", to: "/solutions/churches" },
      { label: "For Denominations", to: "/solutions/denominations" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Blog", to: "/blog" },
      { label: "Documentation", to: "/docs" },
      { label: "API Reference", to: "/api" },
      { label: "Help Centre", to: "/help" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", to: "/about" },
      { label: "Careers", to: "/careers" },
      { label: "Contact", to: "/contact" },
      { label: "Press", to: "/press" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy", to: "/privacy" },
      { label: "Terms", to: "/terms" },
      { label: "Cookies", to: "/cookies" },
    ],
  },
];

const SOCIALS = [
  { label: "ALTAR OS on X", Icon: XIcon, href: "https://x.com" },
  { label: "ALTAR OS on Facebook", Icon: FacebookIcon, href: "https://facebook.com" },
  { label: "ALTAR OS on LinkedIn", Icon: LinkedInIcon, href: "https://linkedin.com" },
  { label: "ALTAR OS on YouTube", Icon: YouTubeIcon, href: "https://youtube.com" },
];

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <Box
      component="footer"
      sx={{
        backgroundColor: "#1A1A2E",
        color: "rgba(255,255,255,0.72)",
        pt: { xs: 7, md: 9 },
        pb: 4,
      }}
    >
      <Container maxWidth="lg">
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={{ xs: 5, md: 4 }}
          useFlexGap
          sx={{ justifyContent: "space-between", flexWrap: "wrap" }}
        >
          {/* Brand block */}
          <Box sx={{ flex: "1 1 260px", maxWidth: 320 }}>
            <Box
              component={RouterLink}
              to="/"
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.25,
                textDecoration: "none",
                mb: 2,
              }}
            >
              <Box
                aria-hidden
                sx={{
                  width: 32,
                  height: 32,
                  color: "secondary.main",
                  "& svg": { width: "100%", height: "100%" },
                }}
                dangerouslySetInnerHTML={{ __html: BRAND_MARK }}
              />
              <Typography
                component="span"
                sx={{
                  fontWeight: 800,
                  fontSize: "1.25rem",
                  letterSpacing: "-0.02em",
                  color: "#fff",
                }}
              >
                ALTAR&nbsp;OS
              </Typography>
            </Box>

            <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.6)", mb: 2.5 }}>
              The digital operating system for the church — built in Ghana for
              congregations across Africa.
            </Typography>

            <Stack direction="row" spacing={0.5}>
              {SOCIALS.map(({ label, Icon, href }) => (
                <IconButton
                  key={label}
                  aria-label={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  size="small"
                  sx={{
                    color: "rgba(255,255,255,0.6)",
                    "&:hover": {
                      color: "secondary.main",
                      backgroundColor: "rgba(255,255,255,0.06)",
                    },
                  }}
                >
                  <Icon fontSize="small" />
                </IconButton>
              ))}
            </Stack>
          </Box>

          {/* Link columns */}
          {FOOTER_COLUMNS.map((column) => (
            <Box key={column.heading} sx={{ flex: "1 1 140px", minWidth: 140 }}>
              <Typography
                variant="subtitle2"
                sx={{
                  color: "#fff",
                  fontWeight: 700,
                  mb: 1.75,
                  fontSize: "0.9rem",
                  letterSpacing: "0.02em",
                }}
              >
                {column.heading}
              </Typography>
              <Stack spacing={1.1}>
                {column.links.map((link) => (
                  <Link
                    key={link.to + link.label}
                    component={RouterLink}
                    to={link.to}
                    underline="none"
                    sx={{
                      color: "rgba(255,255,255,0.62)",
                      fontSize: "0.9rem",
                      transition: "color 0.2s ease",
                      "&:hover": { color: "secondary.main" },
                    }}
                  >
                    {link.label}
                  </Link>
                ))}
              </Stack>
            </Box>
          ))}
        </Stack>

        <Divider sx={{ my: 4, borderColor: "rgba(255,255,255,0.10)" }} />

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{
            justifyContent: "space-between",
            alignItems: { xs: "flex-start", sm: "center" },
          }}
        >
          <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.45)" }}>
            © {year} ALTAR OS. All rights reserved.
          </Typography>
          <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.45)" }}>
            Made with care in Accra, Ghana 🇬🇭
          </Typography>
        </Stack>
      </Container>
    </Box>
  );
}
