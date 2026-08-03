import { createTheme, alpha, type Shadows } from "@mui/material/styles";

const ink = "#0B2E2A";
const green = "#157F73";
const mint = "#6DD5C4";
const canvas = "#EEF5F2";
const line = "#D8E5E0";

const theme = createTheme({
  palette: {
    primary: { main: green, light: mint, dark: "#0E5B53", contrastText: "#FFFFFF" },
    secondary: { main: "#B66A3C", light: "#E8BEA3", dark: "#7C4525", contrastText: "#FFFFFF" },
    background: { default: canvas, paper: "#FBFDFC" },
    text: { primary: ink, secondary: "#5D746F" },
    divider: line,
    success: { main: "#287A55", light: "#DCEFE5" },
    error: { main: "#A84545", light: "#F5E2E2" },
    warning: { main: "#96621D", light: "#F5E9D6" },
    info: { main: "#2F6F80", light: "#DCECF0" },
  },
  typography: {
    fontFamily: '"Outfit", "Helvetica Neue", sans-serif',
    h1: { fontSize: "clamp(2.6rem, 5vw, 4.75rem)", fontWeight: 750, lineHeight: .96, letterSpacing: "-.06em" },
    h2: { fontSize: "clamp(2rem, 3.5vw, 3.35rem)", fontWeight: 740, lineHeight: 1, letterSpacing: "-.055em" },
    h3: { fontSize: "1.75rem", fontWeight: 700, lineHeight: 1.1, letterSpacing: "-.04em" },
    h4: { fontSize: "1.45rem", fontWeight: 690, lineHeight: 1.2, letterSpacing: "-.035em" },
    h5: { fontSize: "1.15rem", fontWeight: 680, lineHeight: 1.3 },
    h6: { fontSize: ".98rem", fontWeight: 680, lineHeight: 1.4 },
    body1: { fontSize: ".96rem", lineHeight: 1.65 },
    body2: { fontSize: ".855rem", lineHeight: 1.6 },
    subtitle1: { fontSize: "1rem", fontWeight: 550 },
    subtitle2: { fontSize: ".8rem", fontWeight: 650, letterSpacing: ".015em" },
    overline: { fontSize: ".69rem", fontWeight: 750, letterSpacing: ".17em", lineHeight: 1.4 },
    button: { textTransform: "none", fontWeight: 650, letterSpacing: "-.01em" },
  },
  // Compact controls stay crisp; larger surfaces opt into softer radii below.
  shape: { borderRadius: 8 },
  shadows: Array(25).fill("none") as Shadows,
  components: {
    MuiCssBaseline: { styleOverrides: {
      "html": { scrollBehavior: "smooth" },
      "body": { backgroundColor: canvas, backgroundImage: "radial-gradient(circle at 85% 0%, rgba(109,213,196,.11), transparent 28%)" },
      "*::selection": { backgroundColor: alpha(mint, .42) },
      "*:focus-visible": { outline: `3px solid ${alpha(mint, .65)}`, outlineOffset: 2 },
    }},
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none", border: `1px solid ${line}`, boxShadow: "0 14px 38px rgba(11,46,42,.055)" } } },
    MuiCard: { styleOverrides: { root: {
      border: `1px solid ${line}`, borderRadius: 14, backgroundColor: "#FBFDFC",
      boxShadow: "0 14px 38px rgba(11,46,42,.055)", transition: "transform 200ms ease, box-shadow 200ms ease, border-color 200ms ease",
      "&:hover": { transform: "translateY(-2px)", borderColor: alpha(green,.3), boxShadow: "0 22px 52px rgba(11,46,42,.09)" },
    }}},
    MuiCardContent: { styleOverrides: { root: { padding: 24, "&:last-child": { paddingBottom: 28 } } } },
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: {
      minHeight: 42, borderRadius: 7, padding: "9px 18px", transition: "transform 160ms ease, background-color 160ms ease",
      "&:active": { transform: "scale(.98)" },
      "&.MuiButton-containedPrimary": { boxShadow: "0 10px 24px rgba(21,127,115,.2)", "&:hover": { backgroundColor: "#0F695F", transform: "translateY(-1px)" } },
    }, outlined: { borderWidth: 1, "&:hover": { borderWidth: 1 } } } },
    MuiIconButton: { styleOverrides: { root: { borderRadius: 7, transition: "background-color 160ms ease, transform 160ms ease", "&:active": { transform: "scale(.94)" } } } },
    MuiTextField: { defaultProps: { variant: "outlined" }, styleOverrides: { root: { "& .MuiOutlinedInput-root": { borderRadius: 8, backgroundColor: "#FFFFFF", "& fieldset": { borderColor: line }, "&:hover fieldset": { borderColor: alpha(green,.55) }, "&.Mui-focused fieldset": { borderWidth: 1.5 } } } } },
    MuiSelect: { styleOverrides: { select: { minHeight: "auto" } } },
    MuiChip: { styleOverrides: { root: {
      height: 28,
      borderRadius: 5,
      fontWeight: 650,
      "&.MuiChip-colorDefault": { backgroundColor: "#E7F1ED", color: ink },
      "&.MuiChip-colorSuccess": { backgroundColor: "#DCEFE5", color: "#185A3D" },
      "&.MuiChip-colorInfo": { backgroundColor: "#DCECF0", color: "#235968" },
      "&.MuiChip-colorError": { backgroundColor: "#F5E2E2", color: "#8B3434" },
      "&.MuiChip-colorWarning": { backgroundColor: "#F5E9D6", color: "#71470F" },
      "&.MuiChip-colorPrimary": { backgroundColor: "#CFEDE6", color: "#0E5B53" },
      "&.MuiChip-outlined": { backgroundColor: "transparent" },
    } } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 16, border: `1px solid ${line}`, boxShadow: "0 32px 90px rgba(11,46,42,.2)" } } },
    MuiDrawer: { styleOverrides: { paper: { border: 0, borderRight: `1px solid rgba(216,229,224,.12)`, boxShadow: "none" } } },
    MuiAppBar: { styleOverrides: { root: { boxShadow: "none", border: 0 } } },
    MuiTableContainer: { styleOverrides: { root: { borderRadius: 10, border: `1px solid ${line}`, boxShadow: "none" } } },
    MuiTableHead: { styleOverrides: { root: { "& .MuiTableCell-head": { backgroundColor: "#E7F1ED", color: "#46615C", fontSize: ".68rem", fontWeight: 750, textTransform: "uppercase", letterSpacing: ".12em", borderBottom: 0 } } } },
    MuiTableCell: { styleOverrides: { root: { borderColor: "#E3ECE8", padding: "15px 18px" } } },
    MuiListItemButton: { styleOverrides: { root: { borderRadius: 7 } } },
    MuiMenu: { styleOverrides: { paper: { borderRadius: 10 } } },
    MuiMenuItem: { styleOverrides: { root: { borderRadius: 6 } } },
    MuiSwitch: { styleOverrides: { switchBase: { "&.Mui-checked": { color: green, "& + .MuiSwitch-track": { backgroundColor: green } } } } },
    MuiAlert: { styleOverrides: { root: { borderRadius: 8, border: "1px solid currentColor" } } },
    MuiSkeleton: { styleOverrides: { root: { backgroundColor: "#DCE8E3", "&::after": { background: "linear-gradient(90deg, transparent, rgba(255,255,255,.55), transparent)" } } } },
  },
});

export default theme;
