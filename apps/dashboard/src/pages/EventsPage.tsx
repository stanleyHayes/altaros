import { useState } from "react";
import {
  Box,
  Typography,
  Button,
  Grid,
  ToggleButtonGroup,
  ToggleButton,
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

interface EventItem {
  id: string;
  title: string;
  description: string;
  location: string;
  startDate: string;
  endDate?: string;
  rsvpCount: number;
  capacity?: number;
  status: "upcoming" | "ongoing" | "completed" | "cancelled";
  isRecurring: boolean;
  [key: string]: unknown;
}

// TODO: Replace with real API data from EventService
const sampleEvents: EventItem[] = [
  {
    id: "1",
    title: "Sunday Worship Service",
    description:
      "Weekly worship service with praise and the Word. Everyone is welcome to attend.",
    location: "Main Sanctuary",
    startDate: "2026-03-30T09:00:00",
    endDate: "2026-03-30T11:30:00",
    rsvpCount: 245,
    capacity: 400,
    status: "upcoming",
    isRecurring: true,
  },
  {
    id: "2",
    title: "Mid-Week Bible Study",
    description:
      "Deep dive into the book of Romans. Bring your Bible and study materials.",
    location: "Fellowship Hall",
    startDate: "2026-04-01T18:30:00",
    endDate: "2026-04-01T20:00:00",
    rsvpCount: 68,
    capacity: 100,
    status: "upcoming",
    isRecurring: true,
  },
  {
    id: "3",
    title: "Youth Group Meeting",
    description: "Fun, fellowship, and faith-building for teens ages 13-18.",
    location: "Youth Center",
    startDate: "2026-04-03T17:00:00",
    endDate: "2026-04-03T19:00:00",
    rsvpCount: 42,
    status: "upcoming",
    isRecurring: true,
  },
  {
    id: "4",
    title: "Community Outreach",
    description:
      "Monthly food distribution and community service at City Park.",
    location: "City Park",
    startDate: "2026-04-05T10:00:00",
    endDate: "2026-04-05T14:00:00",
    rsvpCount: 35,
    status: "upcoming",
    isRecurring: false,
  },
  {
    id: "5",
    title: "Easter Celebration",
    description:
      "Special Easter service with choir performance, drama, and fellowship dinner.",
    location: "Main Sanctuary",
    startDate: "2026-04-05T08:00:00",
    endDate: "2026-04-05T13:00:00",
    rsvpCount: 380,
    capacity: 500,
    status: "upcoming",
    isRecurring: false,
  },
  {
    id: "6",
    title: "Marriage Retreat",
    description: "A weekend getaway for couples to strengthen their bond.",
    location: "Lakeside Resort",
    startDate: "2026-04-18T14:00:00",
    endDate: "2026-04-20T12:00:00",
    rsvpCount: 24,
    capacity: 30,
    status: "upcoming",
    isRecurring: false,
  },
];

export default function EventsPage() {
  const [events, setEvents] = useState<EventItem[]>(sampleEvents);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [formOpen, setFormOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<EventItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EventItem | null>(null);
  const [attendanceEvent, setAttendanceEvent] = useState<EventItem | null>(null);

  const handleCreate = () => {
    setEditEvent(null);
    setFormOpen(true);
  };

  const handleEdit = (id: string) => {
    const ev = events.find((e) => e.id === id) ?? null;
    setEditEvent(ev);
    setFormOpen(true);
  };

  const handleFormSubmit = async (data: EventFormData) => {
    // TODO: Call EventService.create or EventService.update
    if (editEvent) {
      setEvents((prev) =>
        prev.map((e) =>
          e.id === editEvent.id
            ? { ...e, ...data, isRecurring: data.isRecurring, capacity: data.capacity ? Number(data.capacity) : undefined }
            : e,
        ),
      );
    } else {
      const newEvent: EventItem = {
        id: String(Date.now()),
        title: data.title,
        description: data.description ?? "",
        location: data.location ?? "",
        startDate: data.startDate,
        endDate: data.endDate,
        rsvpCount: 0,
        capacity: data.capacity ? Number(data.capacity) : undefined,
        status: "upcoming",
        isRecurring: data.isRecurring,
      };
      setEvents((prev) => [newEvent, ...prev]);
    }
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    // TODO: Call EventService.remove
    setEvents((prev) => prev.filter((e) => e.id !== deleteTarget.id));
    setDeleteTarget(null);
  };

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

      {viewMode === "grid" ? (
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
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </Box>
  );
}
