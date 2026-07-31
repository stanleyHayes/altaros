import { Box, Button, Chip, Container, Stack, Typography } from "@mui/material";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutlineRounded";

/**
 * Adinkra symbols — the same visual language used by CTASection, kept
 * consistent so the page reads as one system rather than stitched parts.
 */
const adinkraSymbols = [
  `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M50 10C30 10 15 25 15 45C15 55 20 65 30 70C25 75 20 80 20 85C20 90 25 95 35 90C40 87 45 82 50 78C55 82 60 87 65 90C75 95 80 90 80 85C80 80 75 75 70 70C80 65 85 55 85 45C85 25 70 10 50 10Z" stroke="currentColor" stroke-width="2" fill="none"/>
  </svg>`,
  `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M50 15C40 15 30 25 30 35C30 45 40 50 50 50C60 50 70 45 70 35C70 25 60 15 50 15Z" stroke="currentColor" stroke-width="2" fill="none"/>
    <path d="M50 50C40 50 30 55 30 65C30 75 40 85 50 85C60 85 70 75 70 65C70 55 60 50 50 50Z" stroke="currentColor" stroke-width="2" fill="none"/>
  </svg>`,
  `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M50 8L58 30L82 30L63 44L70 68L50 54L30 68L37 44L18 30L42 30Z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>
    <circle cx="50" cy="78" r="12" stroke="currentColor" stroke-width="2" fill="none"/>
  </svg>`,
];

const floatingPositions = [
  { top: "12%", left: "6%", size: 78, delay: 0, duration: 20, symbol: 0 },
  { top: "68%", left: "10%", size: 54, delay: 4, duration: 26, symbol: 2 },
  { top: "18%", right: "8%", size: 62, delay: 2, duration: 23, symbol: 1 },
  { top: "72%", right: "6%", size: 88, delay: 6, duration: 28, symbol: 0 },
];

const trustSignals = [
  "Mobile Money first",
  "Works offline",
  "Multi-branch ready",
];

export default function HeroSection() {
  return (
    <Box
      component="section"
      sx={{
        position: "relative",
        overflow: "hidden",
        pt: { xs: 10, md: 16 },
        pb: { xs: 10, md: 18 },
        background:
          "linear-gradient(160deg, #FFFFFF 0%, #F5F6FC 45%, #EEF0FA 100%)",
      }}
    >
      <style>{`
        @keyframes floatHero {
          0%, 100% { transform: translateY(0) rotate(0deg); opacity: 0.10; }
          50% { transform: translateY(-24px) rotate(6deg); opacity: 0.20; }
        }
        @keyframes heroRise {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-hero-animate] { animation: none !important; opacity: 1 !important; transform: none !important; }
        }
      `}</style>

      {/* Floating adinkra motifs */}
      {floatingPositions.map((pos, i) => (
        <Box
          key={i}
          aria-hidden
          data-hero-animate
          sx={{
            position: "absolute",
            top: pos.top,
            left: pos.left,
            right: pos.right,
            width: pos.size,
            height: pos.size,
            color: "rgba(63,81,181,0.16)",
            animation: `floatHero ${pos.duration}s ease-in-out ${pos.delay}s infinite`,
            pointerEvents: "none",
            "& svg": { width: "100%", height: "100%" },
          }}
          dangerouslySetInnerHTML={{ __html: adinkraSymbols[pos.symbol] }}
        />
      ))}

      {/* Soft colour wash */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at 15% 20%, rgba(63,81,181,0.10) 0%, transparent 55%), " +
            "radial-gradient(ellipse at 85% 75%, rgba(255,179,0,0.14) 0%, transparent 55%)",
          pointerEvents: "none",
        }}
      />

      <Container maxWidth="md" sx={{ position: "relative", zIndex: 1, textAlign: "center" }}>
        <Box data-hero-animate sx={{ animation: "heroRise 0.6s ease-out both" }}>
          <Chip
            label="Built in Ghana, for the African church"
            sx={{
              mb: 3,
              px: 1.5,
              py: 2.25,
              fontSize: "0.85rem",
              fontWeight: 700,
              color: "primary.dark",
              backgroundColor: "rgba(63,81,181,0.10)",
              border: "1px solid rgba(63,81,181,0.20)",
            }}
          />
        </Box>

        <Typography
          variant="h1"
          data-hero-animate
          sx={{
            mb: 2.5,
            animation: "heroRise 0.6s ease-out 0.08s both",
            background: "linear-gradient(135deg, #1A1A2E 0%, #3F51B5 70%, #7C4DFF 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          The Digital Operating System for the Church
        </Typography>

        <Typography
          variant="subtitle1"
          data-hero-animate
          sx={{
            color: "text.secondary",
            maxWidth: 680,
            mx: "auto",
            mb: 4.5,
            fontSize: { xs: "1.05rem", md: "1.25rem" },
            animation: "heroRise 0.6s ease-out 0.16s both",
          }}
        >
          Members, giving, events, and communication in one place — with Mobile
          Money built in, offline support for real-world connectivity, and
          multi-branch reporting your denomination actually needs.
        </Typography>

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          data-hero-animate
          sx={{
            justifyContent: "center",
            mb: 4,
            animation: "heroRise 0.6s ease-out 0.24s both",
          }}
        >
          <Button
            variant="contained"
            color="primary"
            size="large"
            endIcon={<ArrowForwardIcon />}
            sx={{
              px: 5,
              boxShadow: "0 6px 28px rgba(63,81,181,0.32)",
              "&:hover": {
                boxShadow: "0 8px 36px rgba(63,81,181,0.42)",
                transform: "translateY(-2px)",
              },
              transition: "all 0.3s ease",
            }}
          >
            Start Free
          </Button>
          <Button
            variant="outlined"
            size="large"
            startIcon={<PlayCircleOutlineIcon />}
            sx={{
              px: 4,
              borderWidth: 2,
              borderColor: "rgba(26,26,46,0.18)",
              color: "text.primary",
              "&:hover": {
                borderWidth: 2,
                borderColor: "primary.main",
                backgroundColor: "rgba(63,81,181,0.04)",
              },
            }}
          >
            Watch demo
          </Button>
        </Stack>

        <Stack
          direction="row"
          spacing={{ xs: 1, sm: 2 }}
          useFlexGap
          data-hero-animate
          sx={{
            justifyContent: "center",
            flexWrap: "wrap",
            animation: "heroRise 0.6s ease-out 0.32s both",
          }}
        >
          {trustSignals.map((signal) => (
            <Typography
              key={signal}
              variant="body2"
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.75,
                color: "text.secondary",
                fontWeight: 600,
                "&::before": {
                  content: '""',
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  backgroundColor: "secondary.main",
                },
              }}
            >
              {signal}
            </Typography>
          ))}
        </Stack>
      </Container>
    </Box>
  );
}
