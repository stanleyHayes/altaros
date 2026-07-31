import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    primary: {
      main: "#3F51B5",
      light: "#7986CB",
      dark: "#303F9F",
      contrastText: "#FFFFFF",
    },
    secondary: {
      main: "#FFB300",
      light: "#FFD54F",
      dark: "#FF8F00",
      contrastText: "#1A1A2E",
    },
    error: {
      main: "#FF6B6B",
    },
    background: {
      default: "#FFFFFF",
      paper: "#FFFFFF",
    },
    text: {
      primary: "#1A1A2E",
      secondary: "#4A4A68",
    },
  },
  typography: {
    fontFamily: "'Nunito Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    h1: {
      fontSize: "3.5rem",
      fontWeight: 800,
      lineHeight: 1.15,
      letterSpacing: "-0.02em",
      "@media (max-width:900px)": {
        fontSize: "2.5rem",
      },
      "@media (max-width:600px)": {
        fontSize: "2rem",
      },
    },
    h2: {
      fontSize: "2.75rem",
      fontWeight: 700,
      lineHeight: 1.2,
      letterSpacing: "-0.01em",
      "@media (max-width:900px)": {
        fontSize: "2.25rem",
      },
      "@media (max-width:600px)": {
        fontSize: "1.75rem",
      },
    },
    h3: {
      fontSize: "2rem",
      fontWeight: 700,
      lineHeight: 1.3,
    },
    h4: {
      fontSize: "1.5rem",
      fontWeight: 600,
      lineHeight: 1.35,
    },
    h5: {
      fontSize: "1.25rem",
      fontWeight: 600,
      lineHeight: 1.4,
    },
    h6: {
      fontSize: "1.125rem",
      fontWeight: 600,
      lineHeight: 1.5,
    },
    subtitle1: {
      fontSize: "1.25rem",
      fontWeight: 400,
      lineHeight: 1.6,
    },
    body1: {
      fontSize: "1rem",
      lineHeight: 1.7,
    },
    body2: {
      fontSize: "0.875rem",
      lineHeight: 1.6,
    },
    button: {
      fontWeight: 700,
      textTransform: "none" as const,
      letterSpacing: "0.02em",
    },
  },
  shape: {
    borderRadius: 16,
  },
  shadows: [
    "none",
    "0px 2px 8px rgba(0,0,0,0.06)",
    "0px 4px 16px rgba(0,0,0,0.08)",
    "0px 6px 24px rgba(0,0,0,0.1)",
    "0px 8px 32px rgba(0,0,0,0.12)",
    "0px 12px 40px rgba(0,0,0,0.14)",
    "0px 16px 48px rgba(0,0,0,0.16)",
    "0px 20px 56px rgba(0,0,0,0.18)",
    "0px 24px 64px rgba(0,0,0,0.2)",
    "0px 2px 8px rgba(0,0,0,0.06)",
    "0px 4px 16px rgba(0,0,0,0.08)",
    "0px 6px 24px rgba(0,0,0,0.1)",
    "0px 8px 32px rgba(0,0,0,0.12)",
    "0px 12px 40px rgba(0,0,0,0.14)",
    "0px 16px 48px rgba(0,0,0,0.16)",
    "0px 20px 56px rgba(0,0,0,0.18)",
    "0px 24px 64px rgba(0,0,0,0.2)",
    "0px 2px 8px rgba(0,0,0,0.06)",
    "0px 4px 16px rgba(0,0,0,0.08)",
    "0px 6px 24px rgba(0,0,0,0.1)",
    "0px 8px 32px rgba(0,0,0,0.12)",
    "0px 12px 40px rgba(0,0,0,0.14)",
    "0px 16px 48px rgba(0,0,0,0.16)",
    "0px 20px 56px rgba(0,0,0,0.18)",
    "0px 24px 64px rgba(0,0,0,0.2)",
  ] as unknown as import("@mui/material/styles").Shadows,
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          padding: "12px 32px",
          fontSize: "1rem",
          fontWeight: 700,
          boxShadow: "none",
          "&:hover": {
            boxShadow: "0px 4px 16px rgba(0,0,0,0.12)",
          },
        },
        sizeLarge: {
          padding: "16px 40px",
          fontSize: "1.125rem",
        },
      },
      variants: [
        {
          props: { variant: "contained", color: "secondary" },
          style: {
            color: "#1A1A2E",
            "&:hover": {
              backgroundColor: "#FFC107",
            },
          },
        },
      ],
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 20,
          boxShadow: "0px 8px 32px rgba(0,0,0,0.08)",
          transition: "transform 0.3s ease, box-shadow 0.3s ease",
          "&:hover": {
            transform: "translateY(-4px)",
            boxShadow: "0px 16px 48px rgba(0,0,0,0.14)",
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 600,
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: "none",
        },
      },
    },
  },
});

export default theme;
