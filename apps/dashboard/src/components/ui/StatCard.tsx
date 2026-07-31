import { Card, CardContent, Box, Typography, type SxProps } from "@mui/material";
import {
  TrendingUp as TrendUpIcon,
  TrendingDown as TrendDownIcon,
} from "@mui/icons-material";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  change?: number;
  changeLabel?: string;
  iconBgColor?: string;
  iconColor?: string;
  sx?: SxProps;
}

export default function StatCard({
  title,
  value,
  icon,
  change,
  changeLabel,
  iconBgColor = "primary.light",
  iconColor = "primary.main",
  sx,
}: StatCardProps) {
  const isPositive = change !== undefined && change >= 0;

  return (
    <Card sx={{ height: "100%", ...sx }}>
      <CardContent sx={{ p: 3, "&:last-child": { pb: 3 } }}>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            mb: 2,
          }}
        >
          <Box>
            <Typography
              variant="body2"
              color="text.secondary"
              gutterBottom
              sx={{ fontWeight: 500 }}
            >
              {title}
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 700 }}>
              {value}
            </Typography>
          </Box>
          <Box
            sx={{
              width: 48,
              height: 48,
              borderRadius: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: iconBgColor,
              color: iconColor,
            }}
          >
            {icon}
          </Box>
        </Box>

        {change !== undefined && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            {isPositive ? (
              <TrendUpIcon
                sx={{ fontSize: 18, color: "success.main" }}
              />
            ) : (
              <TrendDownIcon
                sx={{ fontSize: 18, color: "error.main" }}
              />
            )}
            <Typography
              variant="body2"
              color={isPositive ? "success.main" : "error.main"}
              sx={{ fontWeight: 600 }}
            >
              {isPositive ? "+" : ""}
              {change}%
            </Typography>
            {changeLabel && (
              <Typography variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>
                {changeLabel}
              </Typography>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
