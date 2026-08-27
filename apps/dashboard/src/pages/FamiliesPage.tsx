import { Box, Typography, Alert } from "@mui/material";
import { FamilyRestroom as FamilyIcon } from "@mui/icons-material";

/**
 * Families page is not available.
 *
 * There is no families or households domain in the backend. Households do not
 * have HTTP routes. The householdId field exists on member records and can be
 * indexed to group members by household, but there is no screen or API for
 * managing household associations.
 *
 * This page holds the route and heading so navigation does not break. When a
 * households backend is ready, replace this state with the real UI.
 */
export default function FamiliesPage() {
  return (
    <Box sx={{ py: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 3 }}>
        <FamilyIcon sx={{ color: "primary.main", fontSize: 32 }} />
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Families
        </Typography>
      </Box>

      <Alert severity="info" sx={{ mb: 2 }}>
        <Typography variant="body2">
          <strong>Coming soon.</strong> Family management is under development.
          Members can be grouped by household, but there is no screen yet to view
          or manage household associations. Check back later for this capability.
        </Typography>
      </Alert>
    </Box>
  );
}
