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
  sx,
}: StatCardProps) {
  const isPositive = change !== undefined && change >= 0;

  return (
    <Card sx={{ height: "100%", bgcolor: "rgba(251,253,252,.82)", boxShadow: "none", ...sx }}>
      <CardContent sx={{ p: 2.4, "&:last-child": { pb: 2.6 } }}>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            mb: 2.5,
          }}
        >
          <Box>
            <Typography
              variant="overline"
              color="text.secondary"
              gutterBottom
              sx={{ fontWeight: 700, color: "text.secondary", letterSpacing: ".11em" }}
            >
              {title}
            </Typography>
            <Typography sx={{ mt: .6, fontSize: "2rem", lineHeight: 1, fontWeight: 750, letterSpacing: "-.05em", fontVariantNumeric: "tabular-nums" }}>
              {value}
            </Typography>
          </Box>
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: "14px 14px 24px 14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "#E1F2ED",
              color: "primary.main",
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
