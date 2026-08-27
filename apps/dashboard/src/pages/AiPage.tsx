import { Box, Typography, Alert } from "@mui/material";
import { Psychology as AiIcon } from "@mui/icons-material";

/**
 * AI Assistant features are not yet available.
 *
 * The AI service (sermon generation, member insights, prayer chat) is
 * registered as a placeholder in the backend with no actual implementation.
 * The feature is designed but the API endpoints do not exist yet.
 */
export default function AiPage() {
  return (
    <Box sx={{ py: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 3 }}>
        <AiIcon sx={{ color: "primary.main", fontSize: 32 }} />
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          AI Assistant
        </Typography>
      </Box>

      <Alert severity="info" sx={{ mb: 2 }}>
        <Typography variant="body2">
          <strong>Coming soon.</strong> AI-powered features (sermon generation,
          member insights, and prayer chat) are under development. The backend
          API for AI services is not yet implemented. Check back later for
          these capabilities.
        </Typography>
      </Alert>
    </Box>
  );
}
