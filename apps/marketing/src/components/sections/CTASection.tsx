import { Box, Container, Typography, Button } from "@mui/material";

/* Reuse adinkra SVGs from hero */
const adinkraSymbols = [
  `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M50 10C30 10 15 25 15 45C15 55 20 65 30 70C25 75 20 80 20 85C20 90 25 95 35 90C40 87 45 82 50 78C55 82 60 87 65 90C75 95 80 90 80 85C80 80 75 75 70 70C80 65 85 55 85 45C85 25 70 10 50 10Z" stroke="currentColor" stroke-width="2" fill="none"/>
  </svg>`,
  `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M50 15C40 15 30 25 30 35C30 45 40 50 50 50C60 50 70 45 70 35C70 25 60 15 50 15Z" stroke="currentColor" stroke-width="2" fill="none"/>
    <path d="M50 50C40 50 30 55 30 65C30 75 40 85 50 85C60 85 70 75 70 65C70 55 60 50 50 50Z" stroke="currentColor" stroke-width="2" fill="none"/>
  </svg>`,
];

const floatingPositions = [
  { top: "10%", left: "5%", size: 70, delay: 0, duration: 18, symbol: 0 },
  { top: "60%", right: "4%", size: 55, delay: 3, duration: 22, symbol: 1 },
  { top: "25%", right: "10%", size: 45, delay: 5, duration: 20, symbol: 0 },
  { top: "75%", left: "8%", size: 60, delay: 2, duration: 24, symbol: 1 },
];

export default function CTASection() {
  return (
    <Box
      id="cta"
      sx={{
        py: { xs: 10, md: 14 },
        position: "relative",
        overflow: "hidden",
        background:
          "linear-gradient(135deg, #1A1A2E 0%, #3F51B5 40%, #7C4DFF 100%)",
      }}
    >
      {/* Floating Adinkra Symbols */}
      <style>{`
        @keyframes floatCTA {
          0%, 100% { transform: translateY(0) rotate(0deg); opacity: 0.06; }
          50% { transform: translateY(-20px) rotate(5deg); opacity: 0.12; }
        }
      `}</style>

      {floatingPositions.map((pos, i) => (
        <Box
          key={i}
          sx={{
            position: "absolute",
            top: pos.top,
            left: pos.left,
            right: pos.right,
            width: pos.size,
            height: pos.size,
            color: "rgba(255,255,255,0.08)",
            animation: `floatCTA ${pos.duration}s ease-in-out ${pos.delay}s infinite`,
            pointerEvents: "none",
            "& svg": { width: "100%", height: "100%" },
          }}
          dangerouslySetInnerHTML={{ __html: adinkraSymbols[pos.symbol] }}
        />
      ))}

      {/* Gradient orbs */}
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at 20% 50%, rgba(255,179,0,0.15) 0%, transparent 50%), " +
            "radial-gradient(ellipse at 80% 50%, rgba(124,77,255,0.2) 0%, transparent 50%)",
          pointerEvents: "none",
        }}
      />

      <Container
        maxWidth="md"
        sx={{ position: "relative", zIndex: 1, textAlign: "center" }}
      >
        <Typography
          variant="h2"
          sx={{
            color: "#fff",
            mb: 2,
            fontWeight: 800,
          }}
        >
          Ready to Transform Your Church?
        </Typography>
        <Typography
          variant="subtitle1"
          sx={{
            color: "rgba(255,255,255,0.8)",
            mb: 5,
            fontSize: { xs: "1.1rem", md: "1.3rem" },
          }}
        >
          Join thousands of churches already using ALTAR OS to empower their
          congregations.
        </Typography>
        <Button
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
        <Typography
          variant="body2"
          sx={{
            color: "rgba(255,255,255,0.55)",
            mt: 2.5,
            fontSize: "0.9rem",
          }}
        >
          No credit card required. Free plan available forever.
        </Typography>
      </Container>
    </Box>
  );
}
