import { createTheme, alpha } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    primary: {
      main: "#6B4C9A",
      light: "#9B7FCB",
      dark: "#4A3570",
      contrastText: "#FFFFFF",
    },
    secondary: {
      main: "#FF6B6B",
      light: "#FF9E9E",
      dark: "#E04848",
      contrastText: "#FFFFFF",
    },
    background: {
      default: "#FAFAFA",
      paper: "#FFFFFF",
    },
    text: {
      primary: "#2D2D3A",
      secondary: "#6B7280",
    },
    divider: "#E8E4EF",
    success: {
      main: "#10B981",
      light: "#D1FAE5",
    },
    error: {
      main: "#EF4444",
      light: "#FEE2E2",
    },
    warning: {
      main: "#F59E0B",
      light: "#FEF3C7",
    },
    info: {
      main: "#6B4C9A",
      light: "#EDE7F6",
    },
  },
  typography: {
    fontFamily: '"Nunito Sans", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: {
      fontSize: "2rem",
      fontWeight: 700,
      lineHeight: 1.2,
    },
    h2: {
      fontSize: "1.75rem",
      fontWeight: 700,
      lineHeight: 1.3,
    },
    h3: {
      fontSize: "1.5rem",
      fontWeight: 600,
      lineHeight: 1.3,
    },
    h4: {
      fontSize: "1.25rem",
      fontWeight: 600,
      lineHeight: 1.4,
    },
    h5: {
      fontSize: "1.125rem",
      fontWeight: 600,
      lineHeight: 1.4,
    },
    h6: {
      fontSize: "1rem",
      fontWeight: 600,
      lineHeight: 1.5,
    },
    subtitle1: {
      fontSize: "1rem",
      fontWeight: 500,
    },
    subtitle2: {
      fontSize: "0.875rem",
      fontWeight: 500,
    },
    body1: {
      fontSize: "1rem",
      lineHeight: 1.6,
    },
    body2: {
      fontSize: "0.875rem",
      lineHeight: 1.6,
    },
    button: {
      textTransform: "none" as const,
      fontWeight: 600,
    },
  },
  shape: {
    borderRadius: 16,
  },
  shadows: [
    "none",
    "0px 2px 8px rgba(107, 76, 154, 0.06)",
    "0px 4px 12px rgba(107, 76, 154, 0.08)",
    "0px 6px 16px rgba(107, 76, 154, 0.08)",
    "0px 8px 20px rgba(107, 76, 154, 0.10)",
    "0px 10px 24px rgba(107, 76, 154, 0.10)",
    "0px 12px 28px rgba(107, 76, 154, 0.12)",
    "0px 14px 32px rgba(107, 76, 154, 0.12)",
    "0px 16px 36px rgba(107, 76, 154, 0.14)",
    "0px 18px 40px rgba(107, 76, 154, 0.14)",
    "0px 20px 44px rgba(107, 76, 154, 0.14)",
    "0px 22px 48px rgba(107, 76, 154, 0.16)",
    "0px 24px 52px rgba(107, 76, 154, 0.16)",
    "0px 26px 56px rgba(107, 76, 154, 0.16)",
    "0px 28px 60px rgba(107, 76, 154, 0.18)",
    "0px 30px 64px rgba(107, 76, 154, 0.18)",
    "0px 30px 64px rgba(107, 76, 154, 0.18)",
    "0px 30px 64px rgba(107, 76, 154, 0.18)",
    "0px 30px 64px rgba(107, 76, 154, 0.18)",
    "0px 30px 64px rgba(107, 76, 154, 0.18)",
    "0px 30px 64px rgba(107, 76, 154, 0.18)",
    "0px 30px 64px rgba(107, 76, 154, 0.18)",
    "0px 30px 64px rgba(107, 76, 154, 0.18)",
    "0px 30px 64px rgba(107, 76, 154, 0.18)",
    "0px 30px 64px rgba(107, 76, 154, 0.18)",
  ],
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 20,
          boxShadow: "0px 4px 12px rgba(107, 76, 154, 0.08)",
          border: "1px solid #E8E4EF",
          transition: "box-shadow 0.2s ease, transform 0.2s ease",
          "&:hover": {
            boxShadow: "0px 8px 24px rgba(107, 76, 154, 0.12)",
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          padding: "10px 24px",
          fontSize: "0.9375rem",
          fontWeight: 600,
          boxShadow: "none",
          "&:hover": {
            boxShadow: "none",
          },
        },
        contained: {
          "&:hover": {
            boxShadow: "0px 4px 12px rgba(107, 76, 154, 0.2)",
          },
        },
        outlined: {
          borderWidth: 2,
          "&:hover": {
            borderWidth: 2,
          },
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": {
            borderRadius: 12,
            "& fieldset": {
              borderColor: "#E8E4EF",
            },
            "&:hover fieldset": {
              borderColor: "#6B4C9A",
            },
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 20,
        },
        elevation1: {
          boxShadow: "0px 4px 12px rgba(107, 76, 154, 0.08)",
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          fontWeight: 500,
        },
      },
    },
    MuiBottomNavigation: {
      styleOverrides: {
        root: {
          borderTop: "1px solid #E8E4EF",
          height: 68,
        },
      },
    },
    MuiBottomNavigationAction: {
      styleOverrides: {
        root: {
          minWidth: 60,
          "&.Mui-selected": {
            color: "#6B4C9A",
          },
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: "0px 2px 8px rgba(107, 76, 154, 0.06)",
        },
      },
    },
    MuiFab: {
      styleOverrides: {
        root: {
          boxShadow: "0px 4px 16px rgba(107, 76, 154, 0.24)",
        },
      },
    },
  },
});

export default theme;
