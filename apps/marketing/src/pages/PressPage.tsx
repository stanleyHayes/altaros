import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Button,
  Grid,
  Card,
  CardContent,
  Divider,
} from "@mui/material";
import SEO from "@/components/ui/SEO";
import DownloadIcon from "@mui/icons-material/Download";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

const logoAssets = [
  {
    label: "Full Logo (Dark)",
    format: "SVG, PNG",
    bgColor: "#FFFFFF",
    textColor: "#1A1A2E",
  },
  {
    label: "Full Logo (Light)",
    format: "SVG, PNG",
    bgColor: "#1A1A2E",
    textColor: "#FFFFFF",
  },
  {
    label: "Icon Only",
    format: "SVG, PNG, ICO",
    bgColor: "#3F51B5",
    textColor: "#FFB300",
  },
  {
    label: "Wordmark",
    format: "SVG, PNG",
    bgColor: "#F8F9FC",
    textColor: "#1A1A2E",
  },
];

const pressMentions = [
  {
    outlet: "TechCabal",
    title: "ALTAR OS Raises Seed Round to Digitize African Churches",
    date: "March 2026",
    excerpt:
      "The Accra-based startup is building what it calls a 'digital operating system' for churches across the continent, with mobile money and AI at the center of its approach.",
  },
  {
    outlet: "Disrupt Africa",
    title: "How One Startup Is Bringing Church Management Into the Digital Age",
    date: "February 2026",
    excerpt:
      "ALTAR OS is tackling the operational challenges that African churches face daily, from attendance tracking to financial transparency.",
  },
  {
    outlet: "Ghana Web",
    title: "Ghanaian Tech Company Launches AI-Powered Church Platform",
    date: "January 2026",
    excerpt:
      "ALTAR OS, founded in Accra, has launched a comprehensive church management platform that includes AI-powered sermon assistance and member engagement tools.",
  },
];

const brandColors = [
  { name: "Indigo", hex: "#3F51B5", textColor: "#fff" },
  { name: "Gold", hex: "#FFB300", textColor: "#1A1A2E" },
  { name: "Deep Navy", hex: "#1A1A2E", textColor: "#fff" },
  { name: "Violet", hex: "#7C4DFF", textColor: "#fff" },
  { name: "Coral", hex: "#FF6B6B", textColor: "#fff" },
  { name: "Green", hex: "#4CAF50", textColor: "#fff" },
];

export default function PressPage() {
  return (
    <>
      <SEO
        title="Press Kit"
        description="ALTAR OS press kit — logos, brand guidelines, brand colors, and recent press mentions. For media inquiries, contact press@altaros.io."
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
            Press
          </Typography>
          <Typography variant="h1" sx={{ color: "#fff", mb: 3 }}>
            Press Kit
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{
              color: "rgba(255,255,255,0.85)",
              maxWidth: 600,
              mx: "auto",
            }}
          >
            Logos, brand assets, and media resources for press and partners.
            For media inquiries, contact press@altaros.io.
          </Typography>
        </Container>
      </Box>

      {/* Logo Downloads */}
      <Box sx={{ py: { xs: 8, md: 12 }, backgroundColor: "#FFFFFF" }}>
        <Container maxWidth="lg">
          <Typography variant="h3" sx={{ mb: 1 }}>
            Logo Assets
          </Typography>
          <Typography
            variant="body1"
            sx={{ color: "text.secondary", mb: 4 }}
          >
            Download our logo in various formats. Please do not modify,
            recolor, or distort the logo.
          </Typography>

          <Grid container spacing={3}>
            {logoAssets.map((asset) => (
              <Grid size={{ xs: 12, sm: 6, md: 3 }} key={asset.label}>
                <Card
                  sx={{
                    border: "1px solid rgba(0,0,0,0.06)",
                    overflow: "hidden",
                  }}
                >
                  <Box
                    sx={{
                      height: 120,
                      backgroundColor: asset.bgColor,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderBottom: "1px solid rgba(0,0,0,0.06)",
                    }}
                  >
                    <Typography
                      variant="h6"
                      sx={{
                        color: asset.textColor,
                        fontWeight: 800,
                        letterSpacing: "0.04em",
                      }}
                    >
                      ALTAR OS
                    </Typography>
                  </Box>
                  <CardContent sx={{ p: 2 }}>
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 700, mb: 0.5 }}
                    >
                      {asset.label}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{ color: "text.secondary", display: "block", mb: 1 }}
                    >
                      {asset.format}
                    </Typography>
                    <Button
                      size="small"
                      startIcon={<DownloadIcon sx={{ fontSize: 16 }} />}
                      sx={{ fontSize: "0.8rem", p: 0 }}
                    >
                      Download
                    </Button>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>

      {/* Brand Guidelines */}
      <Box sx={{ py: { xs: 8, md: 12 }, backgroundColor: "#F8F9FC" }}>
        <Container maxWidth="lg">
          <Typography variant="h3" sx={{ mb: 1 }}>
            Brand Guidelines
          </Typography>
          <Typography
            variant="body1"
            sx={{ color: "text.secondary", mb: 4, maxWidth: 700 }}
          >
            ALTAR OS brand identity blends African heritage with modern
            technology. Our visual language draws from Kente patterns and
            Adinkra symbolism, paired with a clean, professional design
            system.
          </Typography>

          <Grid container spacing={3} sx={{ mb: 4 }}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="h5" sx={{ mb: 2, fontWeight: 700 }}>
                Typography
              </Typography>
              <Typography
                variant="body1"
                sx={{ color: "text.secondary", lineHeight: 1.8 }}
              >
                Our primary typeface is <strong>Nunito Sans</strong> — used
                across all marketing materials, the product interface, and
                documentation. It conveys warmth, readability, and
                professionalism.
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="h5" sx={{ mb: 2, fontWeight: 700 }}>
                Voice & Tone
              </Typography>
              <Typography
                variant="body1"
                sx={{ color: "text.secondary", lineHeight: 1.8 }}
              >
                We speak with confidence and warmth. Our tone is empowering,
                never condescending. We respect the mission of every church
                and communicate with clarity and purpose.
              </Typography>
            </Grid>
          </Grid>

          <Typography variant="h5" sx={{ mb: 2, fontWeight: 700 }}>
            Brand Colors
          </Typography>
          <Grid container spacing={2}>
            {brandColors.map((color) => (
              <Grid size={{ xs: 6, sm: 4, md: 2 }} key={color.name}>
                <Box
                  sx={{
                    height: 80,
                    backgroundColor: color.hex,
                    borderRadius: 2,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    mb: 1,
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{ color: color.textColor, fontWeight: 700 }}
                  >
                    {color.hex}
                  </Typography>
                </Box>
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 600, textAlign: "center" }}
                >
                  {color.name}
                </Typography>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>

      {/* Press Mentions */}
      <Box sx={{ py: { xs: 8, md: 12 }, backgroundColor: "#FFFFFF" }}>
        <Container maxWidth="lg">
          <Typography variant="h3" sx={{ mb: 1 }}>
            Recent Press
          </Typography>
          <Typography
            variant="body1"
            sx={{ color: "text.secondary", mb: 4 }}
          >
            Selected coverage of ALTAR OS in the media.
          </Typography>

          {pressMentions.map((mention, index) => (
            <Box key={mention.title}>
              <Box sx={{ py: 3 }}>
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    flexWrap: "wrap",
                    gap: 1,
                    mb: 1,
                  }}
                >
                  <Typography
                    variant="body2"
                    sx={{
                      color: "secondary.main",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      fontSize: "0.75rem",
                    }}
                  >
                    {mention.outlet}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    {mention.date}
                  </Typography>
                </Box>
                <Typography variant="h5" sx={{ mb: 1, fontWeight: 700 }}>
                  {mention.title}
                </Typography>
                <Typography
                  variant="body1"
                  sx={{ color: "text.secondary", lineHeight: 1.7, mb: 1.5 }}
                >
                  {mention.excerpt}
                </Typography>
                <Button
                  size="small"
                  endIcon={<OpenInNewIcon sx={{ fontSize: 16 }} />}
                  sx={{ fontSize: "0.85rem", p: 0 }}
                >
                  Read Article
                </Button>
              </Box>
              {index < pressMentions.length - 1 && <Divider />}
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
            Media Inquiries
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{ color: "rgba(255,255,255,0.8)", mb: 5 }}
          >
            For press inquiries, interviews, or partnership opportunities,
            reach out to our communications team.
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
            Contact Us
          </Button>
        </Container>
      </Box>
    </>
  );
}
