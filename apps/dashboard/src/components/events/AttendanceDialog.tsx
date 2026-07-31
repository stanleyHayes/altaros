import { useMemo, useState } from "react";
import {
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import SearchIcon from "@mui/icons-material/Search";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import DownloadIcon from "@mui/icons-material/Download";

interface AttendanceDialogProps {
  open: boolean;
  onClose: () => void;
  eventTitle: string;
  eventId: string;
}

interface AttendeeRow {
  id: string;
  name: string;
  phone: string;
  checkedIn: boolean;
  checkedInAt?: string;
}

// TODO: Replace with real API data (GET /events/:id/attendance).
const MOCK_ATTENDEES: AttendeeRow[] = [
  { id: "1", name: "Kwame Mensah", phone: "+233 24 123 4567", checkedIn: true, checkedInAt: "09:12" },
  { id: "2", name: "Ama Owusu", phone: "+233 20 987 6543", checkedIn: true, checkedInAt: "09:18" },
  { id: "3", name: "Kofi Boateng", phone: "+233 55 234 5678", checkedIn: false },
  { id: "4", name: "Abena Sarpong", phone: "+233 27 345 6789", checkedIn: true, checkedInAt: "09:31" },
  { id: "5", name: "Yaw Darko", phone: "+233 24 456 7890", checkedIn: false },
  { id: "6", name: "Akosua Frimpong", phone: "+233 50 567 8901", checkedIn: false },
];

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function AttendanceDialog({
  open,
  onClose,
  eventTitle,
  eventId,
}: AttendanceDialogProps) {
  const [query, setQuery] = useState("");
  const [attendees, setAttendees] = useState<AttendeeRow[]>(MOCK_ATTENDEES);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return attendees;
    return attendees.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.phone.replace(/\s/g, "").includes(q.replace(/\s/g, "")),
    );
  }, [attendees, query]);

  const checkedInCount = attendees.filter((a) => a.checkedIn).length;

  const toggleCheckIn = (id: string) => {
    setAttendees((prev) =>
      prev.map((a) =>
        a.id === id
          ? {
              ...a,
              checkedIn: !a.checkedIn,
              checkedInAt: !a.checkedIn
                ? new Date().toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : undefined,
            }
          : a,
      ),
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      slotProps={{ paper: { sx: { borderRadius: 3 } } }}
    >
      <DialogTitle sx={{ pr: 6, pb: 1.5 }}>
        <Typography component="div" variant="h6" sx={{ fontWeight: 700 }}>
          Attendance
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }} noWrap>
          {eventTitle}
        </Typography>
        <IconButton
          aria-label="Close attendance dialog"
          onClick={onClose}
          sx={{ position: "absolute", right: 12, top: 12 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <Divider />

      <DialogContent sx={{ pt: 2.5 }}>
        <Stack
          direction="row"
          spacing={1.5}
          sx={{ alignItems: "center", justifyContent: "space-between", mb: 2 }}
        >
          <Chip
            label={`${checkedInCount} of ${attendees.length} checked in`}
            color={checkedInCount > 0 ? "success" : "default"}
            sx={{ fontWeight: 600 }}
          />
          <Tooltip title="Scan a member's QR code to check them in">
            <Button
              size="small"
              variant="outlined"
              startIcon={<QrCodeScannerIcon />}
              sx={{ borderWidth: 2, "&:hover": { borderWidth: 2 } }}
            >
              Scan QR
            </Button>
          </Tooltip>
        </Stack>

        <TextField
          fullWidth
          size="small"
          placeholder="Search by name or phone…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ mb: 1 }}
        />

        {filtered.length === 0 ? (
          <Box sx={{ py: 5, textAlign: "center" }}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              No members match &ldquo;{query}&rdquo;.
            </Typography>
          </Box>
        ) : (
          <List dense sx={{ maxHeight: 340, overflowY: "auto" }}>
            {filtered.map((attendee) => (
              <ListItem
                key={attendee.id}
                secondaryAction={
                  <IconButton
                    edge="end"
                    aria-label={
                      attendee.checkedIn
                        ? `Undo check-in for ${attendee.name}`
                        : `Check in ${attendee.name}`
                    }
                    onClick={() => toggleCheckIn(attendee.id)}
                    sx={{ color: attendee.checkedIn ? "success.main" : "text.disabled" }}
                  >
                    {attendee.checkedIn ? <CheckCircleIcon /> : <RadioButtonUncheckedIcon />}
                  </IconButton>
                }
                sx={{ borderRadius: 2, "&:hover": { backgroundColor: "action.hover" } }}
              >
                <ListItemAvatar>
                  <Avatar
                    sx={{
                      bgcolor: attendee.checkedIn ? "success.light" : "grey.300",
                      color: attendee.checkedIn ? "success.dark" : "text.secondary",
                      fontWeight: 700,
                      fontSize: "0.85rem",
                    }}
                  >
                    {initials(attendee.name)}
                  </Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={attendee.name}
                  secondary={
                    attendee.checkedIn && attendee.checkedInAt
                      ? `${attendee.phone} · checked in ${attendee.checkedInAt}`
                      : attendee.phone
                  }
                  slotProps={{ primary: { sx: { fontWeight: 600 } } }}
                />
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>

      <Divider />

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button
          startIcon={<DownloadIcon />}
          onClick={() => {
            // TODO: wire to GET /events/:id/attendance/export
            console.info("Export attendance for event", eventId);
          }}
          sx={{ mr: "auto" }}
        >
          Export
        </Button>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" onClick={onClose}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
