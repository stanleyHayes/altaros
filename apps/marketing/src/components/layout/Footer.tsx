import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  Button,
  Container,
  Divider,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded";
import ArrowOutwardRounded from "@mui/icons-material/ArrowOutwardRounded";
import { Brand } from "./Navbar";
import { portalLinks } from "@/config/portalLinks";

const footerLinks = [
  {
    label: "Explore",
    items: [
      ["Platform", "/features"],
      ["Pricing", "/pricing"],
      ["For churches", "/solutions/churches"],
      ["Member web", "/mobile-app"],
      ["Responsible AI", "/ai-tools"],
    ],
  },
  {
    label: "Altar OS",
    items: [
      ["About", "/about"],
      ["Journal", "/blog"],
      ["Help centre", "/help"],
      ["Contact", "/contact"],
    ],
  },
] as const;

const legalLinks = [
  ["Privacy", "/privacy"],
  ["Terms", "/terms"],
  ["Cookies", "/cookies"],
] as const;

export default function Footer() {
  return (
    <Box
      component="footer"
      sx={{
        position: "relative",
        overflow: "hidden",
        bgcolor: "#0B2421",
        color: "white",
        pt: { xs: 3, md: 4 },
        pb: { xs: 3, md: 4 },
        "&::before": {
          content: '""',
          position: "absolute",
          width: { xs: 330, md: 620 },
          height: { xs: 330, md: 620 },
          right: { xs: -210, md: -220 },
          top: { xs: 210, md: 120 },
          borderRadius: "50%",
          border: "1px solid rgba(109,213,196,.12)",
          boxShadow: "0 0 0 70px rgba(109,213,196,.025), 0 0 0 150px rgba(109,213,196,.018)",
          pointerEvents: "none",
        },
      }}
    >
      <Container maxWidth={false} sx={{ position: "relative", maxWidth: 1360, px: { xs: 2, sm: 3, lg: 4 } }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "minmax(0,1.35fr) minmax(320px,.65fr)" },
            gap: { xs: 4, md: 7 },
            alignItems: "end",
            px: { xs: 3, sm: 5, md: 7 },
            py: { xs: 4, sm: 5, md: 6 },
            borderRadius: { xs: "18px", md: "26px" },
            bgcolor: "#DFF6F0",
            color: "#102A27",
            backgroundImage: "radial-gradient(circle at 78% 18%, rgba(109,213,196,.42), transparent 32%)",
          }}
        >
          <Box>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", mb: { xs: 2.5, md: 3.5 } }}>
              <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "primary.main", boxShadow: "0 0 0 5px rgba(21,127,115,.10)" }} />
              <Typography variant="overline" sx={{ color: "primary.dark" }}>Built for the week ahead</Typography>
            </Stack>
            <Typography
              variant="h2"
              sx={{ maxWidth: 760, fontSize: "clamp(2.5rem,5.3vw,5.25rem)", textWrap: "balance" }}
            >
              Make next Sunday feel lighter.
            </Typography>
          </Box>
          <Box sx={{ maxWidth: 430, justifySelf: { md: "end" } }}>
            <Typography sx={{ color: "text.secondary", fontSize: { xs: "1rem", md: "1.08rem" }, lineHeight: 1.65, textWrap: "pretty" }}>
              Bring your people, giving, communication, and care into one dependable home for your church.
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} sx={{ mt: 3 }}>
              <Button component={RouterLink} to="/get-started" variant="contained" endIcon={<ArrowForwardRounded />}>
                Start free
              </Button>
              <Button component={RouterLink} to="/contact" variant="text" sx={{ color: "text.primary" }}>
                Talk to our team
              </Button>
            </Stack>
          </Box>
        </Box>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "1.25fr .75fr .75fr", md: "1.7fr .65fr .65fr" },
            gap: { xs: 5, sm: 4, md: 8 },
            pt: { xs: 7, md: 9 },
            pb: { xs: 7, md: 9 },
          }}
        >
          <Box>
            <Box sx={{ "& a": { color: "white" }, "& a span span": { color: "#6DD5C4" } }}>
              <Brand />
            </Box>
            <Typography sx={{ mt: 2.5, maxWidth: 370, color: "rgba(255,255,255,.58)", lineHeight: 1.65, textWrap: "pretty" }}>
              Church life, held together. Designed and built in Accra for communities across Africa.
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={{ xs: 1.5, sm: 3 }} sx={{ mt: 4, alignItems: { sm: "center" } }}>
              {[
                ["Church staff login", portalLinks.churchLogin],
                ["Member login", portalLinks.memberLogin],
              ].map(([label, href]) => (
                <Link
                  key={label}
                  href={href}
                  underline="none"
                  sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 1,
                    width: "fit-content",
                    color: "white",
                    fontWeight: 600,
                    "& svg": { transition: "transform 180ms ease" },
                    "&:hover": { color: "#6DD5C4", "& svg": { transform: "translate(2px,-2px)" } },
                  }}
                >
                  {label} <ArrowOutwardRounded sx={{ fontSize: 18 }} />
                </Link>
              ))}
            </Stack>
          </Box>

          {footerLinks.map((group) => (
            <Box component="nav" aria-label={`${group.label} links`} key={group.label}>
              <Typography variant="overline" sx={{ color: "#6DD5C4" }}>{group.label}</Typography>
              <Stack spacing={1.45} sx={{ mt: 2.5 }}>
                {group.items.map(([label, to]) => (
                  <Link
                    key={to}
                    component={RouterLink}
                    to={to}
                    underline="none"
                    sx={{
                      width: "fit-content",
                      color: "rgba(255,255,255,.62)",
                      fontSize: ".92rem",
                      transition: "color 180ms ease, transform 180ms ease",
                      "&:hover": { color: "white", transform: "translateX(3px)" },
                    }}
                  >
                    {label}
                  </Link>
                ))}
              </Stack>
            </Box>
          ))}
        </Box>

        <Divider sx={{ borderColor: "rgba(255,255,255,.11)" }} />
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={{ xs: 2, sm: 3 }}
          sx={{ pt: 3, alignItems: { sm: "center" }, justifyContent: "space-between" }}
        >
          <Typography variant="caption" sx={{ color: "rgba(255,255,255,.42)" }}>
            © {new Date().getFullYear()} Altar OS · Accra, Ghana
          </Typography>
          <Stack component="nav" aria-label="Legal" direction="row" spacing={{ xs: 2, sm: 3 }}>
            {legalLinks.map(([label, to]) => (
              <Link key={to} component={RouterLink} to={to} underline="none" sx={{ color: "rgba(255,255,255,.48)", fontSize: ".78rem", "&:hover": { color: "white" } }}>
                {label}
              </Link>
            ))}
          </Stack>
        </Stack>
      </Container>
    </Box>
  );
}
