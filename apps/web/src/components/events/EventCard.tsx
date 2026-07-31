import { useState } from "react";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import LocationOnRoundedIcon from "@mui/icons-material/LocationOnRounded";
import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import PeopleRoundedIcon from "@mui/icons-material/PeopleRounded";

interface EventCardProps {
  title: string;
  description: string;
  date: string;
  dayOfWeek: string;
  dayNum: string;
  month: string;
  startTime: string;
  endTime: string;
  location: string;
  category: string;
  rsvpCount: number;
  myRsvp?: string;
  onRsvp: () => void;
  onCheckIn?: (code: string) => void;
}

export default function EventCard({
  title,
  description,
  dayOfWeek,
  dayNum,
  month,
  startTime,
  endTime,
  location,
  category,
  rsvpCount,
  myRsvp,
  onRsvp,
  onCheckIn,
}: EventCardProps) {
  const [checkInDialogOpen, setCheckInDialogOpen] = useState(false);
  const [checkInCode, setCheckInCode] = useState("");

  const handleCheckIn = () => {
    if (checkInCode.trim() && onCheckIn) {
      onCheckIn(checkInCode.trim());
      setCheckInDialogOpen(false);
      setCheckInCode("");
    }
  };

  return (
    <Card>
      <CardContent
        sx={{
          display: "flex",
          gap: 2,
          p: 2.5,
          "&:last-child": { pb: 2.5 },
        }}
      >
        {/* Date Badge */}
        <Box
          sx={{
            minWidth: 56,
            height: 64,
            borderRadius: 2,
            bgcolor: "primary.main",
            color: "white",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Typography variant="caption" sx={{ opacity: 0.8, lineHeight: 1 }}>
            {dayOfWeek}
          </Typography>
          <Typography variant="h5" fontWeight={700} sx={{ lineHeight: 1.2 }}>
            {dayNum}
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.8, lineHeight: 1 }}>
            {month}
          </Typography>
        </Box>

        {/* Details */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
            <Typography variant="subtitle1" fontWeight={700} noWrap sx={{ flex: 1 }}>
              {title}
            </Typography>
            <Chip label={category} size="small" variant="outlined" />
          </Box>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              mb: 1,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {description}
          </Typography>
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              gap: 1.5,
              mb: 1.5,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <AccessTimeRoundedIcon
                sx={{ fontSize: 14, color: "text.secondary" }}
              />
              <Typography variant="caption" color="text.secondary">
                {startTime} - {endTime}
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <LocationOnRoundedIcon
                sx={{ fontSize: 14, color: "text.secondary" }}
              />
              <Typography variant="caption" color="text.secondary">
                {location}
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <PeopleRoundedIcon
                sx={{ fontSize: 14, color: "text.secondary" }}
              />
              <Typography variant="caption" color="text.secondary">
                {rsvpCount} attending
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button
              variant={myRsvp === "going" ? "contained" : "outlined"}
              size="small"
              onClick={onRsvp}
            >
              {myRsvp === "going" ? "Going" : "RSVP"}
            </Button>
            {myRsvp === "going" && onCheckIn && (
              <Button
                variant="outlined"
                size="small"
                color="secondary"
                onClick={() => setCheckInDialogOpen(true)}
              >
                Check In
              </Button>
            )}
          </Box>
        </Box>
      </CardContent>

      {/* Check-in Code Dialog */}
      <Dialog
        open={checkInDialogOpen}
        onClose={() => setCheckInDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Event Check-In</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Enter the check-in code provided at the event.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            label="Check-in Code"
            value={checkInCode}
            onChange={(e) => setCheckInCode(e.target.value.toUpperCase())}
            placeholder="e.g. A1B2C3D4"
            inputProps={{ style: { letterSpacing: 2, fontFamily: "monospace" } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCheckInDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCheckIn}
            disabled={!checkInCode.trim()}
          >
            Check In
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
