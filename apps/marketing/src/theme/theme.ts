import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#157F73", light: "#6DD5C4", dark: "#0E5B53", contrastText: "#FFFFFF" },
    secondary: { main: "#A7C4A0", light: "#DFF6F0", dark: "#607D64", contrastText: "#102A27" },
    error: { main: "#A84545" },
    background: { default: "#F7FBF8", paper: "#FFFFFF" },
    text: { primary: "#102A27", secondary: "#58706C" },
    divider: "rgba(16, 42, 39, 0.12)",
  },
  typography: {
    fontFamily: "'Outfit', -apple-system, BlinkMacSystemFont, sans-serif",
    h1: { fontSize: "clamp(3.4rem, 6.8vw, 7rem)", fontWeight: 600, lineHeight: 0.92, letterSpacing: "-0.06em" },
    h2: { fontSize: "clamp(2.65rem, 5vw, 5rem)", fontWeight: 600, lineHeight: 0.98, letterSpacing: "-0.05em" },
    h3: { fontSize: "clamp(1.9rem, 3vw, 2.9rem)", fontWeight: 600, lineHeight: 1.05, letterSpacing: "-0.04em" },
    h4: { fontSize: "1.35rem", fontWeight: 600, lineHeight: 1.3, letterSpacing: "-0.025em" },
    h5: { fontSize: "1.1rem", fontWeight: 600, lineHeight: 1.35 },
    h6: { fontSize: "1rem", fontWeight: 600, lineHeight: 1.4 },
    subtitle1: { fontSize: "1.16rem", lineHeight: 1.65 },
    body1: { fontSize: "1rem", lineHeight: 1.72 },
    body2: { fontSize: "0.875rem", lineHeight: 1.62 },
    overline: { fontSize: "0.7rem", fontWeight: 700, lineHeight: 1.5, letterSpacing: "0.15em" },
    button: { fontWeight: 650, textTransform: "none", letterSpacing: "-0.01em" },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiCssBaseline: { styleOverrides: {
      html: { scrollBehavior: "smooth", backgroundColor: "#F7FBF8" },
      body: { backgroundColor: "#F7FBF8", color: "#102A27" },
      "::selection": { backgroundColor: "#A7E5DA", color: "#102A27" },
      "a:focus-visible, button:focus-visible": { outline: "3px solid #6DD5C4", outlineOffset: 3 },
    } },
    MuiButton: { styleOverrides: { root: {
      borderRadius: 10, padding: "10px 20px", minHeight: 44, boxShadow: "none",
      transition: "transform 180ms ease, background-color 180ms ease, color 180ms ease, box-shadow 180ms ease",
      "&:hover": { boxShadow: "0 10px 28px rgba(21,127,115,.16)", transform: "translateY(-2px)" },
      "&:active": { transform: "translateY(0) scale(.98)" },
    } } },
    MuiCard: { styleOverrides: { root: {
      borderRadius: 16, boxShadow: "none", border: "1px solid rgba(16,42,39,.10)", backgroundImage: "none",
      transition: "transform 220ms ease, border-color 220ms ease, box-shadow 220ms ease",
      "&:hover": { transform: "translateY(-3px)", borderColor: "rgba(21,127,115,.32)", boxShadow: "0 18px 45px rgba(21,75,67,.08)" },
    } } },
    MuiAppBar: { styleOverrides: { root: { boxShadow: "none", backgroundImage: "none" } } },
  },
});

export default theme;
