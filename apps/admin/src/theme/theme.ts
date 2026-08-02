import { createTheme, alpha } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: "#5B8DEF",
      light: "#8AB4F8",
      dark: "#3D6BC7",
      contrastText: "#FFFFFF",
    },
    secondary: {
      main: "#FFB300",
      light: "#FFD54F",
      dark: "#FF8F00",
      contrastText: "#000000",
    },
    background: {
      default: "#0B1120",
      paper: "#111827",
    },
    text: {
      primary: "#E5E7EB",
      secondary: "#9CA3AF",
    },
    divider: "#1F2937",
    success: {
      main: "#10B981",
      light: alpha("#10B981", 0.15),
    },
    error: {
      main: "#EF4444",
      light: alpha("#EF4444", 0.15),
    },
    warning: {
      main: "#F59E0B",
      light: alpha("#F59E0B", 0.15),
    },
    info: {
      main: "#3B82F6",
      light: alpha("#3B82F6", 0.15),
    },
  },
  typography: {
    fontFamily: '"Outfit", "Helvetica", "Arial", sans-serif',
    h1: { fontSize: "2.25rem", fontWeight: 700, lineHeight: 1.2 },
    h2: { fontSize: "1.875rem", fontWeight: 700, lineHeight: 1.3 },
    h3: { fontSize: "1.5rem", fontWeight: 600, lineHeight: 1.3 },
    h4: { fontSize: "1.25rem", fontWeight: 600, lineHeight: 1.4 },
    h5: { fontSize: "1.125rem", fontWeight: 600, lineHeight: 1.4 },
    h6: { fontSize: "1rem", fontWeight: 600, lineHeight: 1.5 },
    button: { textTransform: "none" as const, fontWeight: 600 },
    body1: { fontSize: "1rem", lineHeight: 1.6 },
    body2: { fontSize: "0.875rem", lineHeight: 1.6 },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          backgroundColor: "#111827",
          border: "1px solid #1F2937",
          backgroundImage: "none",
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          padding: "10px 24px",
          fontSize: "0.9375rem",
          fontWeight: 600,
          boxShadow: "none",
          "&:hover": { boxShadow: "none" },
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": {
            borderRadius: 10,
            "& fieldset": { borderColor: "#374151" },
            "&:hover fieldset": { borderColor: "#5B8DEF" },
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          backgroundImage: "none",
        },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          "& .MuiTableCell-head": {
            fontWeight: 600,
            backgroundColor: "#1F2937",
            color: "#9CA3AF",
            fontSize: "0.8125rem",
            textTransform: "uppercase" as const,
            letterSpacing: "0.05em",
          },
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: "#111827",
          border: "none",
          borderRight: "1px solid #1F2937",
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: "#111827",
          borderBottom: "1px solid #1F2937",
          boxShadow: "none",
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          margin: "2px 8px",
          "&.Mui-selected": {
            backgroundColor: alpha("#5B8DEF", 0.12),
            color: "#5B8DEF",
            "& .MuiListItemIcon-root": { color: "#5B8DEF" },
            "&:hover": { backgroundColor: alpha("#5B8DEF", 0.18) },
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 8, fontWeight: 500 },
      },
    },
  },
});

export default theme;
