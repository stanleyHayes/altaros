import {
  Card,
  CardContent,
  CardActions,
  Typography,
  Box,
  Chip,
  IconButton,
  Tooltip,
} from "@mui/material";
import {
  LocationOn as LocationIcon,
  People as PeopleIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
} from "@mui/icons-material";

interface EventCardProps {
  id: string;
  title: string;
  description?: string;
  location?: string;
  startDate: string;
  endDate?: string;
  rsvpCount: number;
  capacity?: number;
  status: "upcoming" | "ongoing" | "completed" | "cancelled";
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
}

const statusColorMap: Record<string, "info" | "success" | "default" | "error"> = {
  upcoming: "info",
  ongoing: "success",
  completed: "default",
  cancelled: "error",
};

export default function EventCard({
  id,
  title,
  description,
  location,
  startDate,
  rsvpCount,
  capacity,
  status,
  onEdit,
  onDelete,
}: EventCardProps) {
  const dateObj = new Date(startDate);
  const month = dateObj.toLocaleString("default", { month: "short" });
  const day = dateObj.getDate();
  const time = dateObj.toLocaleString("default", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return (
    <Card
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        transition: "box-shadow 0.2s",
        "&:hover": { boxShadow: 6 },
      }}
    >
      <CardContent sx={{ flexGrow: 1, p: 3 }}>
        <Box sx={{ display: "flex", gap: 2, mb: 2 }}>
          {/* Date Badge */}
          <Box
            sx={{
              minWidth: 56,
              height: 56,
              borderRadius: 2,
              bgcolor: "primary.light",
              color: "primary.main",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Typography
              variant="caption"
              fontWeight={700}
              textTransform="uppercase"
              lineHeight={1}
            >
              {month}
            </Typography>
            <Typography variant="h5" fontWeight={700} lineHeight={1.2}>
              {day}
            </Typography>
          </Box>

          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 1,
              }}
            >
              <Typography variant="subtitle1" fontWeight={600} noWrap>
                {title}
              </Typography>
              <Chip
                label={status}
                size="small"
                color={statusColorMap[status]}
                sx={{ flexShrink: 0 }}
              />
            </Box>
            <Typography variant="caption" color="text.secondary">
              {time}
            </Typography>
          </Box>
        </Box>

        {description && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              mb: 2,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {description}
          </Typography>
        )}

        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
          {location && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <LocationIcon
                sx={{ fontSize: 16, color: "text.secondary" }}
              />
              <Typography variant="body2" color="text.secondary">
                {location}
              </Typography>
            </Box>
          )}
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <PeopleIcon sx={{ fontSize: 16, color: "text.secondary" }} />
            <Typography variant="body2" color="text.secondary">
              {rsvpCount} RSVP{rsvpCount !== 1 ? "s" : ""}
              {capacity ? ` / ${capacity}` : ""}
            </Typography>
          </Box>
        </Box>
      </CardContent>

      <CardActions
        sx={{ px: 2, pb: 2, pt: 0, justifyContent: "flex-end" }}
      >
        {onEdit && (
          <Tooltip title="Edit">
            <IconButton size="small" onClick={() => onEdit(id)}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {onDelete && (
          <Tooltip title="Delete">
            <IconButton
              size="small"
              color="error"
              onClick={() => onDelete(id)}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </CardActions>
    </Card>
  );
}
