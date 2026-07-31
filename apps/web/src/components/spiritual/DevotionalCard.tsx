import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardActionArea from "@mui/material/CardActionArea";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import MenuBookRoundedIcon from "@mui/icons-material/MenuBookRounded";

interface DevotionalCardProps {
  title: string;
  scripture: string;
  excerpt: string;
  date: string;
  author: string;
}

export default function DevotionalCard({
  title,
  scripture,
  excerpt,
  date,
  author,
}: DevotionalCardProps) {
  return (
    <Card>
      <CardActionArea>
        <CardContent sx={{ p: 2.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            <MenuBookRoundedIcon
              sx={{ fontSize: 18, color: "primary.main" }}
            />
            <Typography variant="caption" color="text.secondary">
              {date}
            </Typography>
          </Box>
          <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
          <Chip
            label={scripture}
            size="small"
            variant="outlined"
            color="primary"
            sx={{ mb: 1.5 }}
          />
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {excerpt}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mt: 1.5, display: "block" }}
          >
            By {author}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
