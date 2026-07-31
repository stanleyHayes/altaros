import { useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardActions from "@mui/material/CardActions";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Avatar from "@mui/material/Avatar";
import Grid from "@mui/material/Grid";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Rating from "@mui/material/Rating";
import type { SelectChangeEvent } from "@mui/material/Select";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import VerifiedRoundedIcon from "@mui/icons-material/VerifiedRounded";
import LocationOnRoundedIcon from "@mui/icons-material/LocationOnRounded";
import PeopleRoundedIcon from "@mui/icons-material/PeopleRounded";
import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import type { ChurchListing } from "@altar-os/shared-types";

// ---------- Mock Data ----------

const mockChurches: ChurchListing[] = [
  {
    id: "c1",
    churchId: "ch-001",
    churchName: "Grace Community Church",
    city: "Accra",
    country: "Ghana",
    denomination: "Non-Denominational",
    memberCount: 1200,
    description:
      "A vibrant, spirit-filled community of believers committed to worship and outreach.",
    services: [
      { day: "Sunday", time: "8:00 AM", name: "First Service" },
      { day: "Sunday", time: "10:30 AM", name: "Second Service" },
      { day: "Wednesday", time: "6:30 PM", name: "Mid-Week Service" },
    ],
    isVerified: true,
    rating: 4.8,
    reviewCount: 156,
  },
  {
    id: "c2",
    churchId: "ch-002",
    churchName: "Redeemer Baptist Church",
    city: "Lagos",
    country: "Nigeria",
    denomination: "Baptist",
    memberCount: 850,
    description:
      "Rooted in scripture, reaching the nations. A Baptist church with a heart for missions.",
    services: [
      { day: "Sunday", time: "9:00 AM", name: "Worship Service" },
      { day: "Friday", time: "7:00 PM", name: "Prayer Meeting" },
    ],
    isVerified: true,
    rating: 4.5,
    reviewCount: 98,
  },
  {
    id: "c3",
    churchId: "ch-003",
    churchName: "Hillside Presbyterian Church",
    city: "Nairobi",
    country: "Kenya",
    denomination: "Presbyterian",
    memberCount: 620,
    description:
      "A Reformed church community serving families and building disciples in East Africa.",
    services: [
      { day: "Sunday", time: "10:00 AM", name: "Morning Worship" },
      { day: "Thursday", time: "6:00 PM", name: "Bible Study" },
    ],
    isVerified: false,
    rating: 4.2,
    reviewCount: 47,
  },
  {
    id: "c4",
    churchId: "ch-004",
    churchName: "Living Waters Assembly",
    city: "Accra",
    country: "Ghana",
    denomination: "Pentecostal",
    memberCount: 2100,
    description:
      "An energetic Pentecostal assembly with a focus on youth ministry and community impact.",
    services: [
      { day: "Sunday", time: "7:30 AM", name: "Dawn Service" },
      { day: "Sunday", time: "10:00 AM", name: "Main Service" },
      { day: "Tuesday", time: "6:30 PM", name: "Miracle Night" },
    ],
    isVerified: true,
    rating: 4.6,
    reviewCount: 210,
  },
  {
    id: "c5",
    churchId: "ch-005",
    churchName: "Christ the King Catholic Parish",
    city: "Kumasi",
    country: "Ghana",
    denomination: "Catholic",
    memberCount: 3200,
    description:
      "A historic Catholic parish with a rich liturgical tradition and active social ministries.",
    services: [
      { day: "Sunday", time: "6:30 AM", name: "First Mass" },
      { day: "Sunday", time: "9:00 AM", name: "Family Mass" },
      { day: "Daily", time: "6:00 AM", name: "Weekday Mass" },
    ],
    isVerified: true,
    rating: 4.7,
    reviewCount: 320,
  },
  {
    id: "c6",
    churchId: "ch-006",
    churchName: "Covenant Life Chapel",
    city: "Johannesburg",
    country: "South Africa",
    denomination: "Charismatic",
    memberCount: 480,
    description:
      "A growing charismatic congregation passionate about worship and discipleship.",
    services: [
      { day: "Sunday", time: "9:30 AM", name: "Sunday Celebration" },
    ],
    isVerified: false,
    rating: 4.0,
    reviewCount: 22,
  },
];

export default function DiscoverPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [denomFilter, setDenomFilter] = useState("");

  const uniqueCities = [...new Set(mockChurches.map((c) => c.city))];
  const uniqueDenominations = [
    ...new Set(mockChurches.map((c) => c.denomination)),
  ];

  const filteredChurches = mockChurches.filter((c) => {
    if (
      searchQuery &&
      !c.churchName.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !c.city.toLowerCase().includes(searchQuery.toLowerCase())
    )
      return false;
    if (cityFilter && c.city !== cityFilter) return false;
    if (denomFilter && c.denomination !== denomFilter) return false;
    return true;
  });

  return (
    <Box sx={{ py: 2 }}>
      {/* Header */}
      <Box sx={{ mb: 2.5 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Discover Churches
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Find and connect with churches in your area
        </Typography>
      </Box>

      {/* Search */}
      <TextField
        placeholder="Search by name or city..."
        size="small"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        fullWidth
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchRoundedIcon />
              </InputAdornment>
            ),
          },
        }}
        sx={{ mb: 2 }}
      />

      {/* Filters */}
      <Box sx={{ display: "flex", gap: 1.5, mb: 2.5, flexWrap: "wrap" }}>
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel>City</InputLabel>
          <Select
            value={cityFilter}
            label="City"
            onChange={(e: SelectChangeEvent) => setCityFilter(e.target.value)}
          >
            <MenuItem value="">All Cities</MenuItem>
            {uniqueCities.map((city) => (
              <MenuItem key={city} value={city}>
                {city}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Denomination</InputLabel>
          <Select
            value={denomFilter}
            label="Denomination"
            onChange={(e: SelectChangeEvent) => setDenomFilter(e.target.value)}
          >
            <MenuItem value="">All</MenuItem>
            {uniqueDenominations.map((d) => (
              <MenuItem key={d} value={d}>
                {d}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {/* Church Cards */}
      <Grid container spacing={2}>
        {filteredChurches.map((church) => (
          <Grid key={church.id} size={{ xs: 12, sm: 6 }}>
            <Card
              sx={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <CardContent sx={{ flex: 1, pb: 1 }}>
                {/* Top row: avatar + name */}
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1.5,
                    mb: 1.5,
                  }}
                >
                  <Avatar
                    sx={{
                      width: 44,
                      height: 44,
                      bgcolor: "primary.main",
                      fontSize: 18,
                    }}
                  >
                    {church.churchName.charAt(0)}
                  </Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.5,
                      }}
                    >
                      <Typography
                        variant="subtitle2"
                        noWrap
                        sx={{ fontWeight: 600 }}
                      >
                        {church.churchName}
                      </Typography>
                      {church.isVerified && (
                        <VerifiedRoundedIcon
                          sx={{ fontSize: 16, color: "primary.main" }}
                        />
                      )}
                    </Box>
                    <Chip
                      label={church.denomination}
                      size="small"
                      variant="outlined"
                      sx={{ height: 20, fontSize: "0.7rem" }}
                    />
                  </Box>
                </Box>

                {/* Location + Members */}
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 2,
                    mb: 1,
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.5,
                    }}
                  >
                    <LocationOnRoundedIcon
                      sx={{ fontSize: 14, color: "text.secondary" }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {church.city}, {church.country}
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.5,
                    }}
                  >
                    <PeopleRoundedIcon
                      sx={{ fontSize: 14, color: "text.secondary" }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {church.memberCount.toLocaleString()}
                    </Typography>
                  </Box>
                </Box>

                {/* Rating */}
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                    mb: 1,
                  }}
                >
                  <Rating
                    value={church.rating}
                    precision={0.1}
                    size="small"
                    readOnly
                  />
                  <Typography variant="caption" color="text.secondary">
                    ({church.reviewCount})
                  </Typography>
                </Box>

                {/* Service times */}
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                  {church.services.slice(0, 3).map((s, i) => (
                    <Chip
                      key={i}
                      icon={
                        <AccessTimeRoundedIcon
                          sx={{ fontSize: "13px !important" }}
                        />
                      }
                      label={`${s.day} ${s.time}`}
                      size="small"
                      variant="outlined"
                      sx={{ fontSize: "0.7rem", height: 24 }}
                    />
                  ))}
                </Box>
              </CardContent>
              <CardActions sx={{ px: 2, pb: 2 }}>
                <Button variant="contained" size="small" fullWidth>
                  View Profile
                </Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
        {filteredChurches.length === 0 && (
          <Grid size={12}>
            <Box sx={{ textAlign: "center", py: 6 }}>
              <Typography color="text.secondary">
                No churches found matching your search.
              </Typography>
            </Box>
          </Grid>
        )}
      </Grid>
    </Box>
  );
}
