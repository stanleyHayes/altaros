import { Box, Button, Typography } from "@mui/material";
import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded";
import HomeRounded from "@mui/icons-material/HomeRounded";
import SearchOffRounded from "@mui/icons-material/SearchOffRounded";
import { useNavigate } from "react-router-dom";

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Box component="main" sx={{ minHeight: "min(78dvh, 820px)", display: "grid", placeItems: "center", px: { xs: 2.5, md: 5 }, py: { xs: 7, md: 10 }, bgcolor: "#F3F8F6", color: "#0C302C", overflow: "hidden", position: "relative" }}>
      <Box aria-hidden sx={{ position: "absolute", width: { xs: 280, md: 460 }, height: { xs: 280, md: 460 }, borderRadius: "50%", border: "1px solid rgba(21,127,115,.12)", right: { xs: -180, md: -170 }, top: { xs: -110, md: -170 }, boxShadow: "0 0 0 48px rgba(21,127,115,.025), 0 0 0 96px rgba(21,127,115,.018)" }} />
      <Box sx={{ width: "min(100%, 1040px)", display: "grid", gridTemplateColumns: { xs: "1fr", md: "minmax(280px,.78fr) minmax(360px,1.22fr)" }, gap: { xs: 5, md: 10 }, alignItems: "center", position: "relative" }}>
        <Box aria-hidden sx={{ minHeight: { xs: 210, md: 390 }, bgcolor: "#0C302C", borderRadius: { xs: "32px 32px 110px 32px", md: "48px 48px 180px 48px" }, display: "grid", placeItems: "center", position: "relative", boxShadow: "0 28px 70px rgba(12,48,44,.18)" }}>
          <Typography sx={{ fontSize: { xs: "6.5rem", md: "9rem" }, fontWeight: 800, letterSpacing: "-.09em", lineHeight: .8, color: "#F4FAF8", transform: "translateX(-.04em)" }}>404</Typography>
          <Box sx={{ position: "absolute", left: 24, bottom: 22, width: 48, height: 48, borderRadius: "16px", bgcolor: "#6DD5C4", color: "#0C302C", display: "grid", placeItems: "center" }}><SearchOffRounded /></Box>
        </Box>
        <Box>
          <Typography sx={{ color: "#157F73", fontSize: ".76rem", textTransform: "uppercase", letterSpacing: ".18em", fontWeight: 750 }}>Platform operations</Typography>
          <Typography component="h1" sx={{ mt: 2.25, fontSize: "clamp(2.7rem,6vw,5.4rem)", fontWeight: 800, letterSpacing: "-.065em", lineHeight: .95, maxWidth: 660, textWrap: "balance" }}>No operation lives at this address.</Typography>
          <Typography sx={{ mt: 3, color: "#58706C", fontSize: { xs: "1rem", md: "1.12rem" }, lineHeight: 1.75, maxWidth: 560, textWrap: "pretty" }}>The route may have moved during a platform update. Return to system overview or retrace your last step.</Typography>
          <Box sx={{ mt: 4.5, display: "flex", flexWrap: "wrap", gap: 1.5 }}>
            <Button variant="contained" startIcon={<HomeRounded />} onClick={() => navigate("/dashboard")} sx={{ px: 3, py: 1.4, bgcolor: "#157F73", "&:hover": { bgcolor: "#0F695F", transform: "translateY(-2px)" }, transition: "transform 180ms ease, background-color 180ms ease" }}>Return to operations</Button>
            <Button startIcon={<ArrowBackRounded />} onClick={() => navigate(-1)} sx={{ px: 2.5, color: "#0C302C" }}>Go back</Button>
          </Box>
          <Typography sx={{ mt: 5, pt: 2.5, borderTop: "1px solid #D6E5E1", color: "#78908B", fontSize: ".78rem" }}>ALTAR OS · The route ends here, your work does not.</Typography>
        </Box>
      </Box>
    </Box>
  );
}
