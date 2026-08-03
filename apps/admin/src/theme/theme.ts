import { alpha, createTheme, type Shadows } from "@mui/material/styles";

const ink = "#071B19";
const panel = "#0C2724";
const panelRaised = "#10312D";
const mint = "#71D7C5";
const line = "rgba(196,230,222,.13)";

const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: mint, light: "#A8E8DD", dark: "#3EAD9A", contrastText: ink },
    secondary: { main: "#D5B478", light: "#E8D3AA", dark: "#9A743B", contrastText: ink },
    background: { default: ink, paper: panel },
    text: { primary: "#F1F8F6", secondary: "#91AAA5" },
    divider: line,
    success: { main: "#71D7A2", light: "#193D30" },
    error: { main: "#E58A86", light: "#472524" },
    warning: { main: "#D8B56F", light: "#44371D" },
    info: { main: "#7DBDD0", light: "#193740" },
  },
  typography: {
    fontFamily: '"Outfit", "Helvetica Neue", sans-serif',
    h1: { fontSize: "clamp(2.7rem, 5vw, 4.8rem)", fontWeight: 760, lineHeight: .96, letterSpacing: "-.06em" },
    h2: { fontSize: "clamp(2rem, 3.2vw, 3.15rem)", fontWeight: 740, lineHeight: 1, letterSpacing: "-.052em" },
    h3: { fontSize: "1.8rem", fontWeight: 720, lineHeight: 1.08, letterSpacing: "-.042em" },
    h4: { fontSize: "1.4rem", fontWeight: 700, lineHeight: 1.18, letterSpacing: "-.032em" },
    h5: { fontSize: "1.12rem", fontWeight: 680 },
    h6: { fontSize: ".96rem", fontWeight: 680 },
    body1: { fontSize: ".94rem", lineHeight: 1.65 },
    body2: { fontSize: ".82rem", lineHeight: 1.6 },
    overline: { fontSize: ".65rem", fontWeight: 760, letterSpacing: ".17em", lineHeight: 1.4 },
    button: { textTransform: "none", fontWeight: 680, letterSpacing: "-.01em" },
  },
  shape: { borderRadius: 8 },
  shadows: Array(25).fill("none") as Shadows,
  components: {
    MuiCssBaseline: { styleOverrides: {
      html: { scrollBehavior: "smooth" },
      body: { backgroundColor: ink, backgroundImage: "radial-gradient(circle at 88% -5%, rgba(113,215,197,.09), transparent 26%)" },
      "*::selection": { backgroundColor: alpha(mint, .35) },
      "*:focus-visible": { outline: `3px solid ${alpha(mint, .55)}`, outlineOffset: 2 },
    } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none", border: `1px solid ${line}`, boxShadow: "0 18px 44px rgba(0,0,0,.12)" } } },
    MuiCard: { styleOverrides: { root: { borderRadius: 14, backgroundColor: panel, border: `1px solid ${line}`, boxShadow: "0 18px 44px rgba(0,0,0,.12)", transition: "border-color 180ms ease, transform 180ms ease", "&:hover": { borderColor: "rgba(113,215,197,.25)" } } } },
    MuiCardContent: { styleOverrides: { root: { padding: 24, "&:last-child": { paddingBottom: 26 } } } },
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { minHeight: 40, borderRadius: 7, padding: "8px 16px", "&:active": { transform: "scale(.98)" } } } },
    MuiIconButton: { styleOverrides: { root: { borderRadius: 7, "&:active": { transform: "scale(.95)" } } } },
    MuiOutlinedInput: { styleOverrides: { root: { minHeight: 42, borderRadius: 8, backgroundColor: "rgba(255,255,255,.025)", "& fieldset": { borderColor: "rgba(196,230,222,.18)" }, "&:hover fieldset": { borderColor: "rgba(113,215,197,.5)" }, "&.Mui-focused fieldset": { borderWidth: 1, borderColor: mint } } } },
    MuiChip: { styleOverrides: { root: { height: 27, borderRadius: 5, fontWeight: 680, "&.MuiChip-colorDefault": { backgroundColor: "rgba(196,230,222,.09)", color: "#C4DED8" }, "&.MuiChip-colorSuccess": { backgroundColor: "#193D30", color: "#8DE0B2" }, "&.MuiChip-colorError": { backgroundColor: "#472524", color: "#F0A19D" }, "&.MuiChip-colorWarning": { backgroundColor: "#44371D", color: "#E8CA8A" }, "&.MuiChip-colorInfo": { backgroundColor: "#193740", color: "#9AD0DF" }, "&.MuiChip-colorPrimary": { backgroundColor: "rgba(113,215,197,.16)", color: "#A8E8DD" }, "&.MuiChip-outlined": { backgroundColor: "transparent" } } } },
    MuiTableContainer: { styleOverrides: { root: { border: 0, borderRadius: 0, boxShadow: "none" } } },
    MuiTableHead: { styleOverrides: { root: { "& .MuiTableCell-head": { backgroundColor: "rgba(196,230,222,.055)", color: "#78948E", fontSize: ".63rem", fontWeight: 760, textTransform: "uppercase", letterSpacing: ".13em", borderBottom: `1px solid ${line}` } } } },
    MuiTableCell: { styleOverrides: { root: { borderColor: line, padding: "15px 18px", fontVariantNumeric: "tabular-nums" } } },
    MuiTableRow: { styleOverrides: { root: { "&.MuiTableRow-hover:hover": { backgroundColor: "rgba(113,215,197,.035)" } } } },
    MuiTablePagination: { styleOverrides: { root: { borderTop: `1px solid ${line}`, color: "#91AAA5" } } },
    MuiDrawer: { styleOverrides: { paper: { border: 0, borderRight: `1px solid ${line}`, boxShadow: "none", backgroundColor: "#081F1D" } } },
    MuiAppBar: { styleOverrides: { root: { border: 0, boxShadow: "none", backgroundColor: "transparent" } } },
    MuiListItemButton: { styleOverrides: { root: { borderRadius: 7 } } },
    MuiMenu: { styleOverrides: { paper: { borderRadius: 10, backgroundColor: panelRaised } } },
    MuiMenuItem: { styleOverrides: { root: { borderRadius: 6 } } },
    MuiAlert: { styleOverrides: { root: { borderRadius: 8, border: "1px solid currentColor" } } },
    MuiSkeleton: { styleOverrides: { root: { backgroundColor: "rgba(196,230,222,.08)", "&::after": { background: "linear-gradient(90deg, transparent, rgba(255,255,255,.06), transparent)" } } } },
  },
});

export default theme;
