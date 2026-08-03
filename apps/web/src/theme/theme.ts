import { alpha, createTheme, type Shadows } from "@mui/material/styles";

const ink = "#0B2E2A";
const green = "#157F73";
const mint = "#6DD5C4";
const cream = "#F2F6F2";
const paper = "#FBFDFB";
const line = "#D9E5E0";

const theme = createTheme({
  palette: {
    primary: { main: green, light: mint, dark: "#0E5B53", contrastText: "#FFFFFF" },
    secondary: { main: "#B86F45", light: "#E8BEA5", dark: "#7D4729", contrastText: "#FFFFFF" },
    background: { default: cream, paper },
    text: { primary: ink, secondary: "#607771" },
    divider: line,
    success: { main: "#287A55", light: "#DDEFE5" },
    error: { main: "#A74747", light: "#F4E1E1" },
    warning: { main: "#94611E", light: "#F4E8D5" },
    info: { main: "#317184", light: "#DCECF0" },
  },
  typography: {
    fontFamily: '"Outfit", "Helvetica Neue", sans-serif',
    h1: { fontSize: "clamp(2.6rem, 9vw, 4.7rem)", fontWeight: 760, lineHeight: .96, letterSpacing: "-.06em" },
    h2: { fontSize: "clamp(2rem, 6vw, 3.2rem)", fontWeight: 740, lineHeight: 1, letterSpacing: "-.052em" },
    h3: { fontSize: "1.72rem", fontWeight: 720, lineHeight: 1.08, letterSpacing: "-.04em" },
    h4: { fontSize: "1.35rem", fontWeight: 700, lineHeight: 1.18, letterSpacing: "-.032em" },
    h5: { fontSize: "1.13rem", fontWeight: 680 },
    h6: { fontSize: ".96rem", fontWeight: 680 },
    body1: { fontSize: ".96rem", lineHeight: 1.65 },
    body2: { fontSize: ".84rem", lineHeight: 1.6 },
    overline: { fontSize: ".65rem", fontWeight: 760, letterSpacing: ".17em", lineHeight: 1.4 },
    button: { textTransform: "none", fontWeight: 680, letterSpacing: "-.01em" },
  },
  shape: { borderRadius: 8 },
  shadows: Array(25).fill("none") as Shadows,
  components: {
    MuiCssBaseline: { styleOverrides: { html: { scrollBehavior: "smooth" }, body: { backgroundColor: cream, backgroundImage: "radial-gradient(circle at 85% 0%, rgba(109,213,196,.1), transparent 27%)" }, "*::selection": { backgroundColor: alpha(mint, .42) }, "*:focus-visible": { outline: `3px solid ${alpha(mint, .62)}`, outlineOffset: 2 } } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none", border: `1px solid ${line}`, boxShadow: "0 14px 36px rgba(11,46,42,.055)" } } },
    MuiCard: { styleOverrides: { root: { borderRadius: 14, border: `1px solid ${line}`, backgroundColor: paper, boxShadow: "0 14px 36px rgba(11,46,42,.055)", transition: "transform 180ms ease, border-color 180ms ease", "&:hover": { borderColor: alpha(green, .28) } } } },
    MuiCardContent: { styleOverrides: { root: { padding: 20, "&:last-child": { paddingBottom: 22 } } } },
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { minHeight: 42, borderRadius: 7, padding: "9px 17px", "&:active": { transform: "scale(.98)" } } } },
    MuiIconButton: { styleOverrides: { root: { borderRadius: 7, "&:active": { transform: "scale(.95)" } } } },
    MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 8, backgroundColor: "#fff", "& fieldset": { borderColor: line }, "&:hover fieldset": { borderColor: alpha(green, .55) }, "&.Mui-focused fieldset": { borderWidth: 1.5 } } } },
    MuiChip: { styleOverrides: { root: { height: 27, borderRadius: 5, fontWeight: 680, "&.MuiChip-colorDefault": { bgcolor: "#E7F1ED", color: ink }, "&.MuiChip-colorSuccess": { bgcolor: "#DDEFE5", color: "#185A3D" }, "&.MuiChip-colorInfo": { bgcolor: "#DCECF0", color: "#235968" }, "&.MuiChip-colorError": { bgcolor: "#F4E1E1", color: "#873434" }, "&.MuiChip-colorPrimary": { bgcolor: "#D5F0EA", color: "#0E5B53" }, "&.MuiChip-outlined": { backgroundColor: "transparent" } } } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 16 } } },
    MuiMenu: { styleOverrides: { paper: { borderRadius: 10 } } },
    MuiMenuItem: { styleOverrides: { root: { borderRadius: 6 } } },
    MuiAppBar: { styleOverrides: { root: { boxShadow: "none", border: 0 } } },
    MuiBottomNavigation: { styleOverrides: { root: { height: 68, border: 0, backgroundColor: "transparent" } } },
    MuiBottomNavigationAction: { styleOverrides: { root: { minWidth: 54, color: "#77908A", borderRadius: 7, margin: "6px 3px", "&.Mui-selected": { color: ink, backgroundColor: "#CDEDE6" }, "& .MuiBottomNavigationAction-label": { fontSize: ".62rem", fontWeight: 650, marginTop: 2 } } } },
    MuiAlert: { styleOverrides: { root: { borderRadius: 8, border: "1px solid currentColor" } } },
    MuiSkeleton: { styleOverrides: { root: { backgroundColor: "#DDE8E3" } } },
    MuiTabs: { styleOverrides: { root: { minHeight: 42, borderBottom: `1px solid ${line}` }, indicator: { height: 3, borderRadius: "3px 3px 0 0" } } },
    MuiTab: { styleOverrides: { root: { minHeight: 42, padding: "8px 14px", textTransform: "none", fontSize: ".78rem", fontWeight: 650 } } },
    MuiFab: { styleOverrides: { root: { boxShadow: "0 14px 32px rgba(21,127,115,.24)" } } },
  },
});

export default theme;
