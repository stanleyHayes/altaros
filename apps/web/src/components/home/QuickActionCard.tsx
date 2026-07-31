import { type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

interface QuickActionCardProps {
  icon: ReactNode;
  label: string;
  path: string;
  color: string;
  bgcolor: string;
}

export default function QuickActionCard({
  icon,
  label,
  path,
  color,
  bgcolor,
}: QuickActionCardProps) {
  const navigate = useNavigate();

  return (
    <Card sx={{ border: "none" }}>
      <CardActionArea
        onClick={() => navigate(path)}
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          py: 2,
          px: 1,
          gap: 1,
        }}
      >
        <Box
          sx={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor,
            color,
          }}
        >
          {icon}
        </Box>
        <Typography
          variant="caption"
          fontWeight={600}
          color="text.primary"
          textAlign="center"
        >
          {label}
        </Typography>
      </CardActionArea>
    </Card>
  );
}
