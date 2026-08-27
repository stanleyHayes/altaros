import { useState, useCallback, useEffect } from "react";
import {
  Box,
  Typography,
  Button,
  Grid,
  ToggleButtonGroup,
  ToggleButton,
  Alert,
  CircularProgress,
  Snackbar,
} from "@mui/material";
import {
  Add as AddIcon,
  GridView as GridIcon,
  ViewList as ListIcon,
} from "@mui/icons-material";
import DataTable, { type Column } from "@/components/ui/DataTable";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import EventCard from "@/components/events/EventCard";
import EventFormDialog, {
  type EventFormData,
} from "@/components/events/EventFormDialog";
import AttendanceDialog from "@/components/events/AttendanceDialog";
import EventService, { type Event } from "@/services/event.service";

interface EventItem extends Event {
  status: "upcoming" | "ongoing" | "completed" | "cancelled";
  [key: string]: unknown;
}

/**
 * Calculate event status based on current time and event dates.
 *
 * Status is not a field in the backend — it's derived from comparing the
 * event's start/end dates to now.
 */
function calculateStatus(
  startDate: string,
  endDate?: string,
): "upcoming" | "ongoing" | "completed" | "cancelled" {
  const now = new Date();
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : start;

  if (now < start) return "upcoming";
  if (now > end) return "completed";
  return "ongoing";
}

export default function EventsPage() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [formOpen, setFormOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<EventItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EventItem | null>(null);
  const [attendanceEvent, setAttendanceEvent] = useState<EventItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await EventService.getAll();
      const eventsWithStatus = result.events.map((e) => ({
        ...e,
        status: calculateStatus(e.startDate, e.endDate),
      }));
      setEvents(eventsWithStatus);
    } catch {
      // The list stays empty and SAYS so. Falling back to placeholder events
      // here would be worse than an error: a church cannot tell invented
      // events from real ones.
      setLoadError("We could not load your events. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = useCallback(() => {
    setEditEvent(null);
    setFormOpen(true);
  }, []);

  const handleEdit = useCallback((id: string) => {
    const ev = events.find((e) => e.id === id) ?? null;
    setEditEvent(ev);
    setFormOpen(true);
  }, [events]);

  const handleFormSubmit = useCallback(
    async (data: EventFormData) => {
      try {
        if (editEvent) {
          const updated = await EventService.update(editEvent.id, {
            title: data.title,
            description: data.description,
            location: data.location,
            startDate: data.startDate,
            endDate: data.endDate,
            capacity: data.capacity ? Number(data.capacity) : undefined,
            isRecurring: data.isRecurring,
          });
          const eventWithStatus = {
            ...updated,
            status: calculateStatus(updated.startDate, updated.endDate),
          };
          setEvents((prev) =>
            prev.map((e) => (e.id === eventWithStatus.id ? eventWithStatus : e)),
          );
          setNotice(`${updated.title} updated.`);
        } else {
          const created = await EventService.create({
            title: data.title,
            description: data.description,
            location: data.location,
            startDate: data.startDate,
            endDate: data.endDate,
            capacity: data.capacity ? Number(data.capacity) : undefined,
            isRecurring: data.isRecurring,
          });
          const eventWithStatus = {
            ...created,
            status: calculateStatus(created.startDate, created.endDate),
          };
          setEvents((prev) => [eventWithStatus, ...prev]);
          setNotice(`${created.title} added.`);
        }
        setFormOpen(false);
      } catch {
        // Left open with the values intact — closing the form on failure
        // discards what someone just typed and implies it saved.
        setNotice("That did not save. Please check the details and try again.");
      }
    },
    [editEvent],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await EventService.remove(target.id);
      setEvents((prev) => prev.filter((e) => e.id !== target.id));
      setNotice(`${target.title} deleted.`);
    } catch {
      setNotice("We could not delete that event. Please try again.");
    }
  }, [deleteTarget]);

  const listColumns: Column<EventItem>[] = [
    { id: "title", label: "Title", minWidth: 200 },
    {
      id: "startDate",
      label: "Date",
      minWidth: 160,
      render: (row) => (
        <Typography variant="body2">
          {new Date(row.startDate).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </Typography>
      ),
    },
    { id: "location", label: "Location", minWidth: 150 },
    {
      id: "rsvpCount",
      label: "RSVPs",
      minWidth: 80,
      render: (row) => (
        <Typography variant="body2">
          {row.rsvpCount}
          {row.capacity ? ` / ${row.capacity}` : ""}
        </Typography>
      ),
    },
    { id: "status", label: "Status", minWidth: 100 },
  ];

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3,
        }}
      >
        <Typography variant="h4" sx={{ fontWeight: 700 }}>
          Events
        </Typography>
        <Box sx={{ display: "flex", gap: 2 }}>
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(_, v) => v && setViewMode(v)}
            size="small"
          >
            <ToggleButton value="grid">
              <GridIcon fontSize="small" />
            </ToggleButton>
            <ToggleButton value="list">
              <ListIcon fontSize="small" />
            </ToggleButton>
          </ToggleButtonGroup>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleCreate}
          >
            Add Event
          </Button>
        </Box>
      </Box>

      {loadError && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => void load()}>
              Retry
            </Button>
          }
        >
          {loadError}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      ) : viewMode === "grid" ? (
        <Grid container spacing={3}>
          {events.map((event) => (
            <Grid key={event.id} size={{ xs: 12, sm: 6, md: 4 }}>
              <EventCard
                id={event.id}
                title={event.title}
                description={event.description}
                location={event.location}
                startDate={event.startDate}
                endDate={event.endDate}
                rsvpCount={event.rsvpCount}
                capacity={event.capacity}
                status={event.status}
                onEdit={handleEdit}
                onDelete={(id) =>
                  setDeleteTarget(events.find((e) => e.id === id) ?? null)
                }
                onAttendance={(id) =>
                  setAttendanceEvent(events.find((e) => e.id === id) ?? null)
                }
              />
            </Grid>
          ))}
        </Grid>
      ) : (
        <DataTable
          columns={listColumns}
          rows={events}
          getRowId={(row) => row.id}
          searchPlaceholder="Search events..."
        />
      )}

      {/* Event Form Dialog */}
      <EventFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleFormSubmit}
        isEdit={!!editEvent}
        initialData={
          editEvent
            ? {
                title: editEvent.title,
                description: editEvent.description,
                location: editEvent.location,
                startDate: editEvent.startDate,
                endDate: editEvent.endDate,
                capacity: editEvent.capacity
                  ? String(editEvent.capacity)
                  : "",
                isRecurring: editEvent.isRecurring,
              }
            : undefined
        }
      />

      {/* Attendance Dialog */}
      <AttendanceDialog
        open={!!attendanceEvent}
        onClose={() => setAttendanceEvent(null)}
        eventTitle={attendanceEvent?.title ?? ""}
        eventId={attendanceEvent?.id ?? ""}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Event"
        message={`Are you sure you want to delete "${deleteTarget?.title}"? This action cannot be undone.`}
        confirmLabel="Delete"
        confirmColor="error"
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      <Snackbar
        open={!!notice}
        autoHideDuration={5000}
        onClose={() => setNotice(null)}
        message={notice ?? ""}
      />
    </Box>
  );
}
