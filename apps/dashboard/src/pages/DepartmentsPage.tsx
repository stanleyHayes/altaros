import { Box, Typography, Alert } from "@mui/material";
import { Groups as DepartmentIcon } from "@mui/icons-material";

/**
 * Departments page is not available.
 *
 * There is no departments domain or department management routes in the backend.
 * Members can be assigned to departments via PUT /members/{id}/ministries, which
 * writes departmentIds/groupIds onto a member record, but there is no endpoint
 * to list, create, or manage departments themselves.
 *
 * This page holds the route and heading so navigation does not break. When a
 * departments backend is ready, replace this state with the real UI.
 */
export default function DepartmentsPage() {
  return (
    <Box sx={{ py: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 3 }}>
        <DepartmentIcon sx={{ color: "primary.main", fontSize: 32 }} />
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Departments
        </Typography>
      </Box>

      <Alert severity="info" sx={{ mb: 2 }}>
        <Typography variant="body2">
          <strong>Coming soon.</strong> Department management is under development.
          The backend API for creating and managing departments does not yet exist.
          Check back later for this capability.
        </Typography>
      </Alert>
    </Box>
  );
}
