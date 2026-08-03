import { useEffect } from "react";
import { Box, Typography } from "@mui/material";

interface SplashScreenProps {
  onComplete: () => void;
  duration?: number;
  context?: string;
}

export default function SplashScreen({ onComplete, duration = 1250, context = "Opening your space" }: SplashScreenProps) {
  useEffect(() => {
    const timer = window.setTimeout(onComplete, duration);
    return () => window.clearTimeout(timer);
  }, [onComplete, duration]);

  return (
    <Box role="status" aria-live="polite" aria-label={`ALTAR OS. ${context}`} sx={{
      position: "fixed", inset: 0, zIndex: (t) => t.zIndex.modal + 10,
      display: "grid", placeItems: "center", overflow: "hidden", bgcolor: "#0C302C", color: "#F4FAF8",
      backgroundImage: "radial-gradient(circle at 18% 14%, rgba(109,213,196,.16), transparent 28%), radial-gradient(circle at 86% 82%, rgba(109,213,196,.08), transparent 30%)",
    }}>
      <style>{`
        @keyframes altarReveal { from { opacity: 0; transform: translateY(14px) scale(.96); } to { opacity: 1; transform: none; } }
        @keyframes altarTrace { from { stroke-dashoffset: 120; } to { stroke-dashoffset: 0; } }
        @keyframes altarProgress { 0% { transform: scaleX(.08); opacity: .5; } 65% { transform: scaleX(.72); opacity: 1; } 100% { transform: scaleX(1); opacity: .8; } }
        @media (prefers-reduced-motion: reduce) { [data-altar-motion] { animation: none !important; opacity: 1 !important; transform: none !important; } }
      `}</style>
      <Box aria-hidden sx={{ position: "absolute", inset: 20, border: "1px solid rgba(190,234,226,.12)", borderRadius: { xs: 5, md: 8 } }} />
      <Box data-altar-motion sx={{ width: "min(82vw, 430px)", animation: "altarReveal .55s cubic-bezier(.2,.8,.2,1) both" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2.25 }}>
          <Box sx={{ width: 66, height: 66, borderRadius: "22px", bgcolor: "#6DD5C4", color: "#0C302C", display: "grid", placeItems: "center", boxShadow: "0 18px 48px rgba(0,0,0,.2)" }}>
            <svg width="39" height="39" viewBox="0 0 48 48" fill="none">
              <path data-altar-motion d="M10 31V22C10 14.3 16.3 8 24 8s14 6.3 14 14v9" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeDasharray="120" style={{ animation: "altarTrace .8s ease-out .2s both" }} />
              <path d="M24 24v14" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
            </svg>
          </Box>
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: "1.65rem", letterSpacing: "-.045em", lineHeight: 1 }}>ALTAR <Box component="span" sx={{ color: "#6DD5C4" }}>OS</Box></Typography>
            <Typography sx={{ mt: .75, color: "rgba(228,244,240,.58)", fontSize: ".8rem", letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 650 }}>{context}</Typography>
          </Box>
        </Box>
        <Box sx={{ mt: 5, height: 2, bgcolor: "rgba(190,234,226,.12)", overflow: "hidden" }}>
          <Box data-altar-motion sx={{ height: "100%", bgcolor: "#6DD5C4", transformOrigin: "left", animation: "altarProgress 1.15s cubic-bezier(.2,.8,.2,1) both" }} />
        </Box>
        <Typography sx={{ mt: 2, color: "rgba(228,244,240,.4)", fontSize: ".76rem" }}>Built in Accra for church communities across Africa.</Typography>
      </Box>
    </Box>
  );
}

