import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardMedia from "@mui/material/CardMedia";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Box from "@mui/material/Box";

interface AnnouncementBannerProps {
  title: string;
  message: string;
  imageUrl?: string;
  category?: string;
  date: string;
}

export default function AnnouncementBanner({
  title,
  message,
  imageUrl,
  category,
  date,
}: AnnouncementBannerProps) {
  return (
    <Card
      sx={{
        minWidth: 280,
        maxWidth: 320,
        flex: "0 0 auto",
        bgcolor: "primary.main",
        color: "white",
        border: "none",
      }}
    >
      {imageUrl && (
        <CardMedia
          component="img"
          height={120}
          image={imageUrl}
          alt={title}
          sx={{ objectFit: "cover" }}
        />
      )}
      <CardContent sx={{ p: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
          {category && (
            <Chip
              label={category}
              size="small"
              sx={{
                bgcolor: "rgba(255,255,255,0.2)",
                color: "white",
                fontSize: "0.7rem",
              }}
            />
          )}
          <Typography variant="caption" sx={{ opacity: 0.8 }}>
            {date}
          </Typography>
        </Box>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          {title}
        </Typography>
        <Typography
          variant="body2"
          sx={{
            opacity: 0.9,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {message}
        </Typography>
      </CardContent>
    </Card>
  );
}
