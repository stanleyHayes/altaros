import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import EventCard from "@/components/events/EventCard";

// TODO: Replace with actual API data
const mockEvents = [
  {
    id: "1",
    title: "Easter Sunday Celebration",
    description:
      "Join us for a special Easter worship service with communion, praise, and fellowship. Invite your family and friends!",
    date: "2026-03-30",
    dayOfWeek: "Sun",
    dayNum: "30",
    month: "Mar",
    startTime: "9:00 AM",
    endTime: "12:00 PM",
    location: "Main Auditorium",
    category: "Worship",
    rsvpCount: 156,
    myRsvp: "going",
  },
  {
    id: "2",
    title: "Midweek Bible Study",
    description:
      "Deep dive into the book of Romans with Pastor James. Open discussion and Q&A session.",
    date: "2026-04-01",
    dayOfWeek: "Wed",
    dayNum: "01",
    month: "Apr",
    startTime: "6:30 PM",
    endTime: "8:00 PM",
    location: "Room 201",
    category: "Study",
    rsvpCount: 34,
  },
  {
    id: "3",
    title: "Youth Fellowship Night",
    description:
      "A night of games, worship, and word for the youth. Ages 13-25 welcome.",
    date: "2026-04-04",
    dayOfWeek: "Fri",
    dayNum: "04",
    month: "Apr",
    startTime: "5:00 PM",
    endTime: "8:00 PM",
    location: "Youth Center",
    category: "Youth",
    rsvpCount: 48,
  },
  {
    id: "4",
    title: "Community Outreach",
    description:
      "Serving our local community through food distribution and neighbourhood clean-up.",
    date: "2026-04-12",
    dayOfWeek: "Sat",
    dayNum: "12",
    month: "Apr",
    startTime: "8:00 AM",
    endTime: "1:00 PM",
    location: "Church Parking Lot",
    category: "Outreach",
    rsvpCount: 22,
  },
];

export default function EventsPage() {
  return (
    <Box sx={{ py: 2 }}>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 0.5 }}>
        Events
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Upcoming church events and activities
      </Typography>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {mockEvents.map((event) => (
          <EventCard
            key={event.id}
            title={event.title}
            description={event.description}
            date={event.date}
            dayOfWeek={event.dayOfWeek}
            dayNum={event.dayNum}
            month={event.month}
            startTime={event.startTime}
            endTime={event.endTime}
            location={event.location}
            category={event.category}
            rsvpCount={event.rsvpCount}
            myRsvp={event.myRsvp}
            onRsvp={() => {
              // TODO: Call EventService.rsvp(event.id, "going")
              console.log("RSVP for event:", event.id);
            }}
            onCheckIn={(code) => {
              // TODO: Call POST /events/check-in/:code with memberId
              console.log("Check-in for event:", event.id, "code:", code);
            }}
          />
        ))}
      </Box>
    </Box>
  );
}
