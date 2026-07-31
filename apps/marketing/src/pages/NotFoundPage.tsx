import { Box, Container, Typography, Button } from "@mui/material";
import { useNavigate } from "react-router-dom";
import HomeIcon from "@mui/icons-material/Home";
import SEO from "@/components/ui/SEO";

/* Kente-inspired color palette for the 404 digits */
const kenteColors = ["#FFB300", "#FF6B6B", "#3F51B5", "#4CAF50"];

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <>
      <SEO
        title="Page Not Found"
        description="The page you are looking for does not exist."
      />
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg, #1A1A2E 0%, #3F51B5 40%, #7C4DFF 100%)",
          textAlign: "center",
          py: 10,
        }}
      >
        <Container maxWidth="sm">
          {/* Kente-styled 404 */}
          <Box sx={{ mb: 4 }}>
            <Typography
              variant="h1"
              sx={{
                fontSize: { xs: "6rem", md: "10rem" },
                fontWeight: 900,
                lineHeight: 1,
                background: `linear-gradient(135deg, ${kenteColors[0]} 0%, ${kenteColors[1]} 25%, ${kenteColors[2]} 50%, ${kenteColors[3]} 75%, ${kenteColors[0]} 100%)`,
                backgroundSize: "300% 100%",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                animation: "kenteShift 4s ease infinite",
              }}
            >
              404
            </Typography>
          </Box>

          <style>{`
            @keyframes kenteShift {
              0%, 100% { background-position: 0% center; }
              50% { background-position: 100% center; }
            }
          `}</style>

          <Typography
            variant="h4"
            sx={{ color: "#fff", mb: 2, fontWeight: 700 }}
          >
            Oops! Page Not Found
          </Typography>
          <Typography
            variant="body1"
            sx={{
              color: "rgba(255,255,255,0.7)",
              mb: 5,
              fontSize: "1.1rem",
              maxWidth: 400,
              mx: "auto",
            }}
          >
            Looks like this page has wandered off the path. Let us guide you
            back home.
          </Typography>

          <Button
            variant="contained"
            color="secondary"
            size="large"
            startIcon={<HomeIcon />}
            onClick={() => navigate("/")}
            sx={{
              px: 5,
              py: 1.8,
              fontSize: "1.1rem",
              color: "#1A1A2E",
              boxShadow: "0 4px 24px rgba(255,179,0,0.4)",
              "&:hover": {
                boxShadow: "0 6px 32px rgba(255,179,0,0.5)",
                transform: "translateY(-2px)",
              },
              transition: "all 0.3s ease",
            }}
          >
            Go Home
          </Button>
        </Container>
      </Box>
    </>
  );
}
