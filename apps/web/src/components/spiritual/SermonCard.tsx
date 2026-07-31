import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardActionArea from "@mui/material/CardActionArea";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import PlayCircleFilledRoundedIcon from "@mui/icons-material/PlayCircleFilledRounded";

interface SermonCardProps {
  title: string;
  speaker: string;
  date: string;
  duration: string;
  thumbnailUrl?: string;
  series?: string;
}

export default function SermonCard({
  title,
  speaker,
  date,
  duration,
  thumbnailUrl,
  series,
}: SermonCardProps) {
  return (
    <Card>
      <CardActionArea>
        <CardContent
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            p: 2,
            "&:last-child": { pb: 2 },
          }}
        >
          <Box
            sx={{
              width: 64,
              height: 64,
              borderRadius: 2,
              bgcolor: "#EDE7F6",
              backgroundImage: thumbnailUrl
                ? `url(${thumbnailUrl})`
                : undefined,
              backgroundSize: "cover",
              backgroundPosition: "center",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {!thumbnailUrl && (
              <PlayCircleFilledRoundedIcon
                sx={{ fontSize: 32, color: "primary.main" }}
              />
            )}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" fontWeight={700} noWrap>
              {title}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {speaker}
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Typography variant="caption" color="text.secondary">
                {date}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                &middot; {duration}
              </Typography>
            </Box>
            {series && (
              <Typography
                variant="caption"
                color="primary.main"
                fontWeight={500}
              >
                {series}
              </Typography>
            )}
          </Box>
          <IconButton color="primary" size="large">
            <PlayCircleFilledRoundedIcon sx={{ fontSize: 36 }} />
          </IconButton>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
