import { useState, useCallback, useEffect } from "react";
import {
  Box,
  Typography,
  TextField,
  InputAdornment,
  Grid,
  Card,
  CardContent,
  CardActions,
  Button,
  Chip,
  Avatar,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Rating,
  Alert,
  CircularProgress,
  type SelectChangeEvent,
} from "@mui/material";
import {
  Search as SearchIcon,
  Verified as VerifiedIcon,
  Public as PublicIcon,
  LocationOn as LocationIcon,
  People as PeopleIcon,
  AccessTime as TimeIcon,
  Send as SendIcon,
} from "@mui/icons-material";
import ChurchService, { type VisibleChurch } from "@/services/church.service";


export default function InterChurchPage() {
  const [churches, setChurches] = useState<VisibleChurch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [denomFilter, setDenomFilter] = useState("");

  // Load visible churches on mount
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await ChurchService.getVisible();
      setChurches(data);
    } catch {
      setLoadError(
        "We could not load the church directory. Check your connection and try again."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Filter churches based on search and dropdowns
  const filteredChurches = churches.filter((c) => {
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

  // Extract unique cities and denominations from loaded data
  const uniqueCities = [...new Set(churches.map((c) => c.city))];
  const uniqueDenominations = [...new Set(churches.map((c) => c.denomination))];

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
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <PublicIcon sx={{ fontSize: 32, color: "primary.main" }} />
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            Church Directory
          </Typography>
        </Box>
      </Box>

      {/* Error State */}
      {loadError && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void load()}>
              Retry
            </Button>
          }
          sx={{ mb: 3 }}
        >
          {loadError}
        </Alert>
      )}

      {/* Loading State */}
      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {/* Discover Content */}
      {!loading && (
        <Box>
          {/* Filters */}
          <Box
            sx={{
              display: "flex",
              gap: 2,
              mb: 3,
              flexWrap: "wrap",
            }}
          >
            <TextField
              placeholder="Search churches..."
              size="small"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon />
                    </InputAdornment>
                  ),
                },
              }}
              sx={{ minWidth: 260 }}
            />
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>City</InputLabel>
              <Select
                value={cityFilter}
                label="City"
                onChange={(e: SelectChangeEvent) =>
                  setCityFilter(e.target.value)
                }
              >
                <MenuItem value="">All Cities</MenuItem>
                {uniqueCities.map((city) => (
                  <MenuItem key={city} value={city}>
                    {city}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Denomination</InputLabel>
              <Select
                value={denomFilter}
                label="Denomination"
                onChange={(e: SelectChangeEvent) =>
                  setDenomFilter(e.target.value)
                }
              >
                <MenuItem value="">All Denominations</MenuItem>
                {uniqueDenominations.map((d) => (
                  <MenuItem key={d} value={d}>
                    {d}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          {/* Church Grid */}
          <Grid container spacing={3}>
            {filteredChurches.map((church) => (
              <Grid key={church.id} size={{ xs: 12, sm: 6, md: 4 }}>
                <Card
                  sx={{
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <CardContent sx={{ flex: 1 }}>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1.5,
                        mb: 2,
                      }}
                    >
                      <Avatar
                        sx={{
                          width: 48,
                          height: 48,
                          bgcolor: "primary.main",
                          fontSize: 20,
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
                            variant="subtitle1"
                            noWrap
                            sx={{ fontWeight: 600 }}
                          >
                            {church.churchName}
                          </Typography>
                          {church.isVerified && (
                            <VerifiedIcon
                              sx={{ fontSize: 18, color: "primary.main" }}
                            />
                          )}
                        </Box>
                        <Chip
                          label={church.denomination}
                          size="small"
                          variant="outlined"
                          sx={{ mt: 0.25 }}
                        />
                      </Box>
                    </Box>

                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        mb: 1.5,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {church.description}
                    </Typography>

                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.5,
                        mb: 0.5,
                      }}
                    >
                      <LocationIcon
                        sx={{ fontSize: 16, color: "text.secondary" }}
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
                        mb: 0.5,
                      }}
                    >
                      <PeopleIcon
                        sx={{ fontSize: 16, color: "text.secondary" }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {church.memberCount.toLocaleString()} members
                      </Typography>
                    </Box>

                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.5,
                        mb: 1.5,
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

                    {/* Service Times */}
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      {church.services.map((s, i) => (
                        <Chip
                          key={i}
                          icon={<TimeIcon sx={{ fontSize: "14px !important" }} />}
                          label={`${s.day} ${s.time}`}
                          size="small"
                          variant="outlined"
                          sx={{ fontSize: "0.75rem" }}
                        />
                      ))}
                    </Box>
                  </CardContent>
                  <CardActions sx={{ px: 2, pb: 2 }}>
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<SendIcon />}
                      fullWidth
                    >
                      Connect
                    </Button>
                  </CardActions>
                </Card>
              </Grid>
            ))}
            {filteredChurches.length === 0 && (
              <Grid size={12}>
                <Box sx={{ textAlign: "center", py: 6 }}>
                  <Typography color="text.secondary">
                    No churches found matching your criteria.
                  </Typography>
                </Box>
              </Grid>
            )}
          </Grid>
        </Box>
      )}
    </Box>
  );
}

