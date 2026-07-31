import { createTheme, alpha } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    primary: {
      main: "#3F51B5",
      light: "#7986CB",
      dark: "#303F9F",
      contrastText: "#FFFFFF",
    },
    secondary: {
      main: "#FF9800",
      light: "#FFB74D",
      dark: "#F57C00",
      contrastText: "#000000",
    },
    background: {
      default: "#F5F7FA",
      paper: "#FFFFFF",
    },
    text: {
      primary: "#1A1A2E",
      secondary: "#6B7280",
    },
    divider: "#E5E7EB",
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
      main: "#3B82F6",
      light: "#DBEAFE",
    },
  },
  typography: {
    fontFamily: '"Nunito Sans", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: {
      fontSize: "2.25rem",
      fontWeight: 700,
      lineHeight: 1.2,
    },
    h2: {
      fontSize: "1.875rem",
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
    borderRadius: 12,
  },
  shadows: [
    "none",
    "0px 1px 3px rgba(0, 0, 0, 0.04), 0px 1px 2px rgba(0, 0, 0, 0.06)",
    "0px 2px 4px rgba(0, 0, 0, 0.04), 0px 1px 3px rgba(0, 0, 0, 0.08)",
    "0px 4px 6px rgba(0, 0, 0, 0.04), 0px 2px 4px rgba(0, 0, 0, 0.06)",
    "0px 6px 8px rgba(0, 0, 0, 0.04), 0px 3px 6px rgba(0, 0, 0, 0.06)",
    "0px 8px 16px rgba(0, 0, 0, 0.06), 0px 4px 8px rgba(0, 0, 0, 0.04)",
    "0px 12px 24px rgba(0, 0, 0, 0.06), 0px 6px 12px rgba(0, 0, 0, 0.04)",
    "0px 16px 32px rgba(0, 0, 0, 0.08), 0px 8px 16px rgba(0, 0, 0, 0.04)",
    "0px 20px 40px rgba(0, 0, 0, 0.08), 0px 10px 20px rgba(0, 0, 0, 0.04)",
    "0px 24px 48px rgba(0, 0, 0, 0.1), 0px 12px 24px rgba(0, 0, 0, 0.06)",
    "0px 28px 56px rgba(0, 0, 0, 0.1), 0px 14px 28px rgba(0, 0, 0, 0.06)",
    "0px 32px 64px rgba(0, 0, 0, 0.12), 0px 16px 32px rgba(0, 0, 0, 0.06)",
    "0px 36px 72px rgba(0, 0, 0, 0.12), 0px 18px 36px rgba(0, 0, 0, 0.06)",
    "0px 40px 80px rgba(0, 0, 0, 0.12), 0px 20px 40px rgba(0, 0, 0, 0.06)",
    "0px 44px 88px rgba(0, 0, 0, 0.14), 0px 22px 44px rgba(0, 0, 0, 0.06)",
    "0px 48px 96px rgba(0, 0, 0, 0.14), 0px 24px 48px rgba(0, 0, 0, 0.06)",
    "0px 48px 96px rgba(0, 0, 0, 0.14), 0px 24px 48px rgba(0, 0, 0, 0.06)",
    "0px 48px 96px rgba(0, 0, 0, 0.14), 0px 24px 48px rgba(0, 0, 0, 0.06)",
    "0px 48px 96px rgba(0, 0, 0, 0.14), 0px 24px 48px rgba(0, 0, 0, 0.06)",
    "0px 48px 96px rgba(0, 0, 0, 0.14), 0px 24px 48px rgba(0, 0, 0, 0.06)",
    "0px 48px 96px rgba(0, 0, 0, 0.14), 0px 24px 48px rgba(0, 0, 0, 0.06)",
    "0px 48px 96px rgba(0, 0, 0, 0.14), 0px 24px 48px rgba(0, 0, 0, 0.06)",
    "0px 48px 96px rgba(0, 0, 0, 0.14), 0px 24px 48px rgba(0, 0, 0, 0.06)",
    "0px 48px 96px rgba(0, 0, 0, 0.14), 0px 24px 48px rgba(0, 0, 0, 0.06)",
    "0px 48px 96px rgba(0, 0, 0, 0.14), 0px 24px 48px rgba(0, 0, 0, 0.06)",
  ],
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          boxShadow:
            "0px 2px 4px rgba(0, 0, 0, 0.04), 0px 1px 3px rgba(0, 0, 0, 0.08)",
          border: "1px solid #E5E7EB",
          "&:hover": {
            boxShadow:
              "0px 8px 16px rgba(0, 0, 0, 0.06), 0px 4px 8px rgba(0, 0, 0, 0.04)",
          },
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
          "&:hover": {
            boxShadow: "none",
          },
        },
        contained: {
          "&:hover": {
            boxShadow:
              "0px 4px 6px rgba(0, 0, 0, 0.04), 0px 2px 4px rgba(0, 0, 0, 0.06)",
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
            borderRadius: 10,
            "& fieldset": {
              borderColor: "#E5E7EB",
            },
            "&:hover fieldset": {
              borderColor: "#3F51B5",
            },
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 16,
        },
        elevation1: {
          boxShadow:
            "0px 2px 4px rgba(0, 0, 0, 0.04), 0px 1px 3px rgba(0, 0, 0, 0.08)",
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          fontWeight: 500,
        },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          "& .MuiTableCell-head": {
            fontWeight: 600,
            backgroundColor: "#F9FAFB",
            color: "#6B7280",
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
          border: "none",
          boxShadow:
            "0px 8px 16px rgba(0, 0, 0, 0.06), 0px 4px 8px rgba(0, 0, 0, 0.04)",
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow:
            "0px 1px 3px rgba(0, 0, 0, 0.04), 0px 1px 2px rgba(0, 0, 0, 0.06)",
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: ({ theme: t }) => ({
          borderRadius: 10,
          margin: "2px 8px",
          "&.Mui-selected": {
            backgroundColor: alpha("#3F51B5", 0.08),
            color: "#3F51B5",
            "& .MuiListItemIcon-root": {
              color: "#3F51B5",
            },
            "&:hover": {
              backgroundColor: alpha("#3F51B5", 0.12),
            },
          },
        }),
      },
    },
  },
});

export default theme;
