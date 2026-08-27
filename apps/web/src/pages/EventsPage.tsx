import { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import EventCard from "@/components/events/EventCard";
import PageIntro from "@/components/ui/PageIntro";
import EventService, { ChurchEvent, RsvpStatus } from "@/services/event.service";
import { useAuth } from "@/hooks/useAuth";
import { ApiError } from "@/services/api";

// Helper to parse date string and extract components for EventCard display
function parseDateForDisplay(dateString: string) {
  try {
    const date = new Date(dateString);
    const dayOfWeek = date.toLocaleDateString("en-US", { weekday: "short" });
    const dayNum = String(date.getDate()).padStart(2, "0");
    const month = date.toLocaleDateString("en-US", { month: "short" });
    return { dayOfWeek, dayNum, month };
  } catch {
    // Fallback if date parsing fails
    return { dayOfWeek: "", dayNum: "", month: "" };
  }
}

export default function EventsPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState<ChurchEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load events on mount
  useEffect(() => {
    const fetchEvents = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await EventService.getEvents();
        setEvents(data);
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Failed to load events";
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, []);

  const handleRsvp = async (eventId: string) => {
    if (!user?.memberId) {
      setError("Unable to determine your member ID");
      return;
    }

    try {
      await EventService.rsvp(eventId, "going" as RsvpStatus);

      // Update the event's RSVP status optimistically
      setEvents((prev) =>
        prev.map((e) => (e.id === eventId ? { ...e, myRsvp: "going" } : e))
      );
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to RSVP";
      setError(message);
    }
  };

  // Note: code parameter is provided by EventCard but not used in current API implementation
  const handleCheckIn = async (eventId: string, _code: string) => {
    if (!user?.memberId) {
      setError("Unable to determine your member ID");
      return;
    }

    try {
      await EventService.checkIn(eventId, user.memberId);
      // On success, show a success message (component will handle dialog close)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Check-in failed";
      setError(message);
    }
  };

  return (
    <Box sx={{ py: 2 }}>
      <PageIntro eyebrow="Gather together" title="Events" copy="Services, groups and moments where your church community meets." />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      ) : events.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 4 }}>
          <Typography variant="body2" color="text.secondary">
            No upcoming events at the moment.
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {events.map((event) => {
            const { dayOfWeek, dayNum, month } = parseDateForDisplay(event.date);
            return (
              <EventCard
                key={event.id}
                title={event.title}
                description={event.description}
                date={event.date}
                dayOfWeek={dayOfWeek}
                dayNum={dayNum}
                month={month}
                startTime={event.startTime}
                endTime={event.endTime}
                location={event.location}
                category={event.category}
                rsvpCount={event.rsvpCount}
                myRsvp={event.myRsvp}
                onRsvp={() => handleRsvp(event.id)}
                onCheckIn={(code) => handleCheckIn(event.id, code)}
              />
            );
          })}
        </Box>
      )}
    </Box>
  );
}
