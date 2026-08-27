import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
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
import MemberService from "@/services/member.service";
import EventService from "@/services/event.service";

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
  const [attendees, setAttendees] = useState<AttendeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !eventId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        // Two requests, joined here. Attendance records say who checked IN,
        // keyed by member id with no name on them; the roster supplies both
        // the names and the people who did not come. Neither answers "who was
        // missing" alone.
        const [members, attendance] = await Promise.all([
          MemberService.getAll(),
          EventService.getAttendance(eventId),
        ]);
        if (cancelled) return;

        const checkedInAt = new Map<string, string>();
        for (const record of attendance?.attendance ?? []) {
          checkedInAt.set(record.memberId, record.occurrenceAt);
        }

        setAttendees(
          members.map((m) => {
            const at = checkedInAt.get(m.id);
            return {
              id: m.id,
              name: `${m.firstName} ${m.lastName}`.trim(),
              phone: m.phone ?? "",
              checkedIn: at !== undefined,
              checkedInAt: at
                ? new Date(at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : undefined,
            };
          }),
        );
      } catch {
        if (!cancelled) {
          // No fallback roster. An attendance sheet of invented people is
          // worse than an empty one: it gets marked, saved and believed.
          setLoadError("We could not load the attendance list. Please try again.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, eventId]);

  /**
   * Export the sheet as CSV.
   *
   * Built in the browser from the rows already on screen rather than fetched:
   * there is no export endpoint, and the button previously logged to the
   * console and did nothing, which reads to an usher as a broken download.
   *
   * Fields are quoted and embedded quotes doubled — a member whose name or
   * address contains a comma would otherwise shift every later column, and
   * one starting with = or + is prefixed so a spreadsheet treats it as text
   * rather than a formula.
   */
  const exportCsv = () => {
    const cell = (value: string) => {
      const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const rows = [
      ["Name", "Phone", "Checked in", "Time"],
      ...attendees.map((a) => [
        a.name,
        a.phone,
        a.checkedIn ? "yes" : "no",
        a.checkedInAt ?? "",
      ]),
    ];
    const csv = rows.map((r) => r.map(cell).join(",")).join("\r\n");

    const url = URL.createObjectURL(
      new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `attendance-${eventTitle.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

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
        {loadError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {loadError}
          </Alert>
        )}
        {loading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress size={26} />
          </Box>
        )}
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
          onClick={exportCsv}
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
