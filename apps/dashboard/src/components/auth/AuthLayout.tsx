import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { ChurchRounded, Groups2Outlined, LockOutlined, PaymentsOutlined } from "@mui/icons-material";

interface AuthLayoutProps { title: string; subtitle?: string; children: ReactNode }

const signals = [
  { icon: Groups2Outlined, text: "Know who needs attention this week" },
  { icon: PaymentsOutlined, text: "Keep giving and church records together" },
  { icon: LockOutlined, text: "Role-based access for every ministry team" },
];

export default function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  return (
    <Box sx={{ minHeight: "100dvh", display: "grid", gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1.08fr) minmax(440px, .92fr)" }, bgcolor: "#F4F8F5" }}>
      <Box sx={{ display: { xs: "none", md: "flex" }, flexDirection: "column", justifyContent: "space-between", bgcolor: "#102A27", color: "#F5FAF7", p: { md: 6, lg: 8 }, minHeight: "100dvh" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.4 }}>
          <Box sx={{ width: 42, height: 42, borderRadius: "14px", bgcolor: "#9DE3D2", color: "#102A27", display: "grid", placeItems: "center" }}><ChurchRounded /></Box>
          <Typography sx={{ fontWeight: 800, fontSize: "1.2rem", letterSpacing: "-.03em" }}>ALTAR <Box component="span" sx={{ color: "#9DE3D2" }}>OS</Box></Typography>
        </Box>

        <Box sx={{ maxWidth: 590, my: 8 }}>
          <Typography sx={{ color: "#9DE3D2", fontSize: ".72rem", fontWeight: 800, letterSpacing: ".16em", mb: 2 }}>CHURCH OPERATIONS</Typography>
          <Typography component="h1" sx={{ fontSize: { md: "3.3rem", lg: "4.25rem" }, lineHeight: .98, letterSpacing: "-.055em", fontWeight: 750, maxWidth: 560 }}>Lead the week with the whole church in view.</Typography>
          <Typography sx={{ color: "rgba(245,250,247,.64)", fontSize: "1.05rem", lineHeight: 1.65, mt: 3, maxWidth: 490 }}>One place for people, giving, events and pastoral follow-up.</Typography>
        </Box>

        <Box sx={{ display: "grid", gap: 2.2, maxWidth: 500 }}>
          {signals.map(({ icon: Icon, text }) => (
            <Box key={text} sx={{ display: "flex", alignItems: "center", gap: 1.8 }}>
              <Box sx={{ width: 36, height: 36, borderRadius: "12px", border: "1px solid rgba(157,227,210,.22)", display: "grid", placeItems: "center", color: "#9DE3D2" }}><Icon sx={{ fontSize: 19 }} /></Box>
              <Typography sx={{ color: "rgba(245,250,247,.76)", fontSize: ".9rem" }}>{text}</Typography>
            </Box>
          ))}
        </Box>
      </Box>

      <Box component="main" sx={{ minHeight: "100dvh", display: "flex", flexDirection: "column", px: { xs: 2.5, sm: 6, lg: 9 }, py: { xs: 3, md: 5 }, bgcolor: "#F4F8F5" }}>
        <Box sx={{ display: { xs: "flex", md: "none" }, alignItems: "center", gap: 1.2, mb: 6 }}>
          <Box sx={{ width: 38, height: 38, borderRadius: "13px", bgcolor: "#CFEFE6", color: "#102A27", display: "grid", placeItems: "center" }}><ChurchRounded sx={{ fontSize: 21 }} /></Box>
          <Typography sx={{ fontWeight: 800, color: "#102A27" }}>ALTAR OS</Typography>
        </Box>
        <Box sx={{ width: "100%", maxWidth: 480, m: "auto" }}>
          <Typography sx={{ color: "#197665", fontSize: ".72rem", fontWeight: 800, letterSpacing: ".14em", mb: 1.5 }}>CHURCH DASHBOARD</Typography>
          <Typography variant="h3" component="h2" sx={{ color: "#102A27", fontWeight: 750, fontSize: { xs: "2rem", sm: "2.45rem" }, letterSpacing: "-.04em", mb: 1 }}>{title}</Typography>
          {subtitle ? <Typography sx={{ color: "#58706C", mb: 4 }}>{subtitle}</Typography> : null}
          {children}
        </Box>
        <Typography sx={{ color: "#7A918C", fontSize: ".75rem", mt: 5 }}>© {new Date().getFullYear()} Altar OS</Typography>
      </Box>
    </Box>
  );
}
