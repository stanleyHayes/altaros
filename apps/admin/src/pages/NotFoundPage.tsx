import { Box, Typography, Button } from "@mui/material";
import { useNavigate } from "react-router-dom";

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <Box
      sx={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
      }}
    >
      <Typography variant="h1" color="text.secondary" sx={{ fontWeight: 700 }}>
        404
      </Typography>
      <Typography variant="h5" sx={{ mt: 1, mb: 3 }}>
        Page not found
      </Typography>
      <Button variant="contained" onClick={() => navigate("/dashboard")}>
        Go to Dashboard
      </Button>
    </Box>
  );
}
