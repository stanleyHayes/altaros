import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import Chip from "@mui/material/Chip";
import VolunteerActivismRoundedIcon from "@mui/icons-material/VolunteerActivismRounded";
import AutoStoriesRoundedIcon from "@mui/icons-material/AutoStoriesRounded";
import EventRoundedIcon from "@mui/icons-material/EventRounded";
import FavoriteBorderRoundedIcon from "@mui/icons-material/FavoriteBorderRounded";
import PlayCircleOutlineRoundedIcon from "@mui/icons-material/PlayCircleOutlineRounded";
import CalendarTodayRoundedIcon from "@mui/icons-material/CalendarTodayRounded";
import LocationOnRoundedIcon from "@mui/icons-material/LocationOnRounded";
import { useAuth } from "@/hooks/useAuth";
import { firstNameOf } from "@/services/auth.service";
import QuickActionCard from "@/components/home/QuickActionCard";
import AnnouncementBanner from "@/components/home/AnnouncementBanner";

// TODO: Replace with actual API data
const mockAnnouncements = [
  {
    id: "1",
    title: "Easter Sunday Celebration",
    message:
      "Join us for a special Easter service with worship, communion, and fellowship. Invite a friend!",
    category: "Event",
    date: "Mar 30",
  },
  {
    id: "2",
    title: "New Member Orientation",
    message:
      "Welcome to our church family! Attend the new member orientation this Saturday at 10 AM.",
    category: "Notice",
    date: "Apr 5",
  },
];

const mockUpcomingEvents = [
  {
    id: "1",
    title: "Sunday Worship Service",
    date: "Sun, Mar 30",
    time: "9:00 AM",
    location: "Main Auditorium",
  },
  {
    id: "2",
    title: "Bible Study Group",
    date: "Wed, Apr 2",
    time: "6:30 PM",
    location: "Room 201",
  },
  {
    id: "3",
    title: "Youth Fellowship",
    date: "Fri, Apr 4",
    time: "5:00 PM",
    location: "Youth Center",
  },
];

const mockRecentSermons = [
  {
    id: "1",
    title: "Walking in Faith",
    speaker: "Pastor James",
    date: "Mar 23",
    duration: "45 min",
  },
  {
    id: "2",
    title: "The Power of Prayer",
    speaker: "Minister Grace",
    date: "Mar 16",
    duration: "38 min",
  },
];

export default function HomePage() {
  const { user } = useAuth();
  const firstName = user ? firstNameOf(user) : "Friend";

  return (
    <Box sx={{ py: 2 }}>
      {/* Welcome */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Good morning, {firstName}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Welcome to your church community
        </Typography>
      </Box>

      {/* Quick Actions */}
      <Grid container spacing={1.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 3 }}>
          <QuickActionCard
            icon={<VolunteerActivismRoundedIcon />}
            label="Give"
            path="/giving"
            color="#FF6B6B"
            bgcolor="#FFF0F0"
          />
        </Grid>
        <Grid size={{ xs: 3 }}>
          <QuickActionCard
            icon={<FavoriteBorderRoundedIcon />}
            label="Prayer"
            path="/spiritual?tab=prayer"
            color="#6B4C9A"
            bgcolor="#EDE7F6"
          />
        </Grid>
        <Grid size={{ xs: 3 }}>
          <QuickActionCard
            icon={<EventRoundedIcon />}
            label="Events"
            path="/events"
            color="#10B981"
            bgcolor="#D1FAE5"
          />
        </Grid>
        <Grid size={{ xs: 3 }}>
          <QuickActionCard
            icon={<AutoStoriesRoundedIcon />}
            label="Bible"
            path="/spiritual?tab=bible"
            color="#F59E0B"
            bgcolor="#FEF3C7"
          />
        </Grid>
      </Grid>

      {/* Announcements */}
      <Typography variant="h6" sx={{ mb: 1.5 }}>
        Announcements
      </Typography>
      <Box
        sx={{
          display: "flex",
          gap: 2,
          overflowX: "auto",
          pb: 1,
          mb: 3,
          "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        {mockAnnouncements.map((a) => (
          <AnnouncementBanner
            key={a.id}
            title={a.title}
            message={a.message}
            category={a.category}
            date={a.date}
          />
        ))}
      </Box>

      {/* Upcoming Events */}
      <Typography variant="h6" sx={{ mb: 1.5 }}>
        Upcoming Events
      </Typography>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mb: 3 }}>
        {mockUpcomingEvents.map((event) => (
          <Card key={event.id}>
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
                  minWidth: 48,
                  height: 48,
                  borderRadius: 2,
                  bgcolor: "primary.main",
                  color: "white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <CalendarTodayRoundedIcon fontSize="small" />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600 }}>
                  {event.title}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {event.date} at {event.time}
                </Typography>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <LocationOnRoundedIcon
                    sx={{ fontSize: 12, color: "text.secondary" }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {event.location}
                  </Typography>
                </Box>
              </Box>
              <Chip label="RSVP" size="small" color="primary" variant="outlined" />
            </CardContent>
          </Card>
        ))}
      </Box>

      {/* Recent Sermons */}
      <Typography variant="h6" sx={{ mb: 1.5 }}>
        Recent Sermons
      </Typography>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mb: 3 }}>
        {mockRecentSermons.map((sermon) => (
          <Card key={sermon.id}>
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
                  width: 52,
                  height: 52,
                  borderRadius: 2,
                  bgcolor: "#EDE7F6",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <PlayCircleOutlineRoundedIcon
                  sx={{ color: "primary.main", fontSize: 28 }}
                />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600 }}>
                  {sermon.title}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {sermon.speaker} &middot; {sermon.date}
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary">
                {sermon.duration}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      {/* Giving Summary */}
      <Typography variant="h6" sx={{ mb: 1.5 }}>
        My Giving This Month
      </Typography>
      <Card
        sx={{
          background: "linear-gradient(135deg, #6B4C9A 0%, #9B7FCB 100%)",
          color: "white",
          border: "none",
          mb: 2,
        }}
      >
        <CardContent sx={{ p: 2.5 }}>
          <Typography variant="body2" sx={{ opacity: 0.85 }}>
            Total Given
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 700, my: 0.5 }}>
            $250.00
          </Typography>
          <Box sx={{ display: "flex", gap: 2, mt: 1 }}>
            <Box>
              <Typography variant="caption" sx={{ opacity: 0.7 }}>
                Tithe
              </Typography>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                $200.00
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" sx={{ opacity: 0.7 }}>
                Offering
              </Typography>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                $50.00
              </Typography>
            </Box>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
