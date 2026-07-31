import type { ReactNode } from "react";
import { Box, Container, Paper, Typography } from "@mui/material";

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

const BRAND_MARK = `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M50 10C30 10 15 25 15 45C15 55 20 65 30 70C25 75 20 80 20 85C20 90 25 95 35 90C40 87 45 82 50 78C55 82 60 87 65 90C75 95 80 90 80 85C80 80 75 75 70 70C80 65 85 55 85 45C85 25 70 10 50 10Z" stroke="currentColor" stroke-width="5" fill="none" stroke-linejoin="round"/>
</svg>`;

/** Shared shell for the member web auth pages (login / register / OTP). */
export default function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        py: { xs: 4, md: 6 },
        px: 2,
        position: "relative",
        overflow: "hidden",
        background:
          "linear-gradient(150deg, #1A1A2E 0%, #4A3470 55%, #6B4C9A 100%)",
      }}
    >
      {/* Ambient colour orbs */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at 18% 22%, rgba(255,107,107,0.18) 0%, transparent 52%), " +
            "radial-gradient(ellipse at 82% 78%, rgba(139,111,187,0.30) 0%, transparent 52%)",
          pointerEvents: "none",
        }}
      />

      <Container maxWidth="sm" sx={{ position: "relative", zIndex: 1 }}>
        {/* Brand */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 1.5,
            mb: 3,
          }}
        >
          <Box
            aria-hidden
            sx={{
              width: 40,
              height: 40,
              color: "#fff",
              "& svg": { width: "100%", height: "100%" },
            }}
            dangerouslySetInnerHTML={{ __html: BRAND_MARK }}
          />
          <Typography
            component="span"
            sx={{
              color: "#fff",
              fontWeight: 800,
              fontSize: "1.4rem",
              letterSpacing: "-0.02em",
            }}
          >
            ALTAR&nbsp;OS
          </Typography>
        </Box>

        <Paper
          elevation={0}
          sx={{
            p: { xs: 3, sm: 4.5 },
            borderRadius: 4,
            backgroundColor: "rgba(255,255,255,0.97)",
            border: "1px solid rgba(255,255,255,0.4)",
            boxShadow: "0 24px 64px rgba(0,0,0,0.28)",
          }}
        >
          <Box sx={{ mb: 3.5, textAlign: "center" }}>
            <Typography variant="h4" sx={{ fontWeight: 700, mb: subtitle ? 0.75 : 0 }}>
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                {subtitle}
              </Typography>
            )}
          </Box>

          {children}
        </Paper>

        <Typography
          variant="body2"
          sx={{ color: "rgba(255,255,255,0.5)", textAlign: "center", mt: 3 }}
        >
          © {new Date().getFullYear()} ALTAR OS
        </Typography>
      </Container>
    </Box>
  );
}
