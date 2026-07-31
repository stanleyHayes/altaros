import { useEffect } from "react";
import { Box, Typography } from "@mui/material";

interface SplashScreenProps {
  /** Called once the splash animation has finished. */
  onComplete: () => void;
  /** How long the splash stays on screen, in ms. */
  duration?: number;
}

const BRAND_MARK = `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M50 10C30 10 15 25 15 45C15 55 20 65 30 70C25 75 20 80 20 85C20 90 25 95 35 90C40 87 45 82 50 78C55 82 60 87 65 90C75 95 80 90 80 85C80 80 75 75 70 70C80 65 85 55 85 45C85 25 70 10 50 10Z" stroke="currentColor" stroke-width="5" fill="none" stroke-linejoin="round"/>
</svg>`;

export default function SplashScreen({
  onComplete,
  duration = 1600,
}: SplashScreenProps) {
  useEffect(() => {
    const timer = window.setTimeout(onComplete, duration);
    return () => window.clearTimeout(timer);
  }, [onComplete, duration]);

  return (
    <Box
      role="status"
      aria-live="polite"
      aria-label="Loading ALTAR OS"
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: (t) => t.zIndex.modal + 10,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        background:
          "linear-gradient(150deg, #1A1A2E 0%, #4A3470 55%, #6B4C9A 100%)",
      }}
    >
      <style>{`
        @keyframes splashPulse {
          0%, 100% { transform: scale(1); opacity: 0.95; }
          50% { transform: scale(1.06); opacity: 1; }
        }
        @keyframes splashFadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes splashSweep {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-splash] { animation: none !important; opacity: 1 !important; transform: none !important; }
        }
      `}</style>

      <Box
        data-splash
        aria-hidden
        sx={{
          width: 96,
          height: 96,
          color: "#FFFFFF",
          animation: "splashPulse 1.6s ease-in-out infinite",
          "& svg": { width: "100%", height: "100%" },
        }}
        dangerouslySetInnerHTML={{ __html: BRAND_MARK }}
      />

      <Box data-splash sx={{ textAlign: "center", animation: "splashFadeUp 0.5s ease-out 0.15s both" }}>
        <Typography
          variant="h4"
          sx={{ color: "#fff", fontWeight: 800, letterSpacing: "-0.02em" }}
        >
          ALTAR OS
        </Typography>
        <Typography
          variant="body2"
          sx={{ color: "rgba(255,255,255,0.62)", mt: 0.5 }}
        >
          Your church community
        </Typography>
      </Box>

      {/* Indeterminate progress sweep */}
      <Box
        aria-hidden
        sx={{
          width: 160,
          height: 3,
          borderRadius: 999,
          overflow: "hidden",
          backgroundColor: "rgba(255,255,255,0.16)",
        }}
      >
        <Box
          data-splash
          sx={{
            width: "33%",
            height: "100%",
            borderRadius: 999,
            backgroundColor: "#FF6B6B",
            animation: "splashSweep 1.2s ease-in-out infinite",
          }}
        />
      </Box>
    </Box>
  );
}
