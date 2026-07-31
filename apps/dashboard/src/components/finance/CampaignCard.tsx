import {
  Card,
  CardContent,
  Typography,
  Box,
  LinearProgress,
  Chip,
} from "@mui/material";

interface CampaignCardProps {
  name: string;
  description?: string;
  goalAmount: number;
  currentAmount: number;
  startDate: string;
  endDate?: string;
  status: "active" | "completed" | "paused";
}

export default function CampaignCard({
  name,
  description,
  goalAmount,
  currentAmount,
  startDate,
  endDate,
  status,
}: CampaignCardProps) {
  const progress = Math.min((currentAmount / goalAmount) * 100, 100);

  const statusColor =
    status === "active"
      ? "success"
      : status === "completed"
        ? "info"
        : "warning";

  return (
    <Card sx={{ height: "100%" }}>
      <CardContent sx={{ p: 3 }}>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            mb: 1.5,
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {name}
          </Typography>
          <Chip label={status} size="small" color={statusColor} />
        </Box>

        {description && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mb: 2, lineHeight: 1.5 }}
          >
            {description}
          </Typography>
        )}

        <Box sx={{ mb: 1.5 }}>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              mb: 0.5,
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              ${currentAmount.toLocaleString()}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              of ${goalAmount.toLocaleString()}
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={progress}
            sx={{
              height: 8,
              borderRadius: 4,
              bgcolor: "grey.200",
              "& .MuiLinearProgress-bar": {
                borderRadius: 4,
                bgcolor:
                  progress >= 100
                    ? "success.main"
                    : progress >= 50
                      ? "primary.main"
                      : "warning.main",
              },
            }}
          />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mt: 0.5, display: "block" }}
          >
            {progress.toFixed(1)}% raised
          </Typography>
        </Box>

        <Box
          sx={{ display: "flex", justifyContent: "space-between", mt: 2 }}
        >
          <Typography variant="caption" color="text.secondary">
            Started: {startDate}
          </Typography>
          {endDate && (
            <Typography variant="caption" color="text.secondary">
              Ends: {endDate}
            </Typography>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
