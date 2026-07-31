import type { ReactNode } from "react";
import { Box, Card, CardContent, Typography } from "@mui/material";
import { TrendingUp, TrendingDown } from "@mui/icons-material";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  change?: number;
  changeLabel?: string;
}

export default function StatCard({
  title,
  value,
  icon,
  change,
  changeLabel,
}: StatCardProps) {
  const isPositive = (change ?? 0) >= 0;

  return (
    <Card>
      <CardContent sx={{ p: 3 }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {title}
          </Typography>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: 2,
              bgcolor: "primary.light",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "primary.main",
            }}
          >
            {icon}
          </Box>
        </Box>
        <Typography variant="h4" fontWeight={700}>
          {value}
        </Typography>
        {change !== undefined && (
          <Box sx={{ display: "flex", alignItems: "center", mt: 1, gap: 0.5 }}>
            {isPositive ? (
              <TrendingUp sx={{ fontSize: 16, color: "success.main" }} />
            ) : (
              <TrendingDown sx={{ fontSize: 16, color: "error.main" }} />
            )}
            <Typography
              variant="caption"
              color={isPositive ? "success.main" : "error.main"}
              fontWeight={600}
            >
              {isPositive ? "+" : ""}
              {change}%
            </Typography>
            {changeLabel && (
              <Typography variant="caption" color="text.secondary">
                {changeLabel}
              </Typography>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
