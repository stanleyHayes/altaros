import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Button from "@mui/material/Button";
import Grid from "@mui/material/Grid";
import Skeleton from "@mui/material/Skeleton";
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import LocationOnRoundedIcon from "@mui/icons-material/LocationOnRounded";
import ChurchRoundedIcon from "@mui/icons-material/ChurchRounded";
import directoryService, { type DirectoryChurch } from "@/services/directory.service";
import PageIntro from "@/components/ui/PageIntro";

export default function DiscoverPage() {
  const [churches, setChurches] = useState<DirectoryChurch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await directoryService.churches();
        if (cancelled) return;
        setChurches(data);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredChurches = churches.filter((c) => {
    if (
      searchQuery &&
      !c.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !(c.city?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) &&
      !(c.country?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
    )
      return false;
    return true;
  });

  return (
    <Box sx={{ py: 2 }}>
      <PageIntro
        eyebrow="Across the network"
        title="Discover churches"
        copy="Find Altar OS church communities near you and understand where you may belong."
      />

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

      {/* Error state */}
      {error && (
        <Alert severity="info" sx={{ mb: 4 }}>
          The directory is not available right now. Please try again shortly.
        </Alert>
      )}

      {/* Loading state */}
      {loading ? (
        <Grid container spacing={2}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Grid key={i} size={{ xs: 12, sm: 6 }}>
              <Skeleton variant="rounded" height={200} />
            </Grid>
          ))}
        </Grid>
      ) : (
        <>
          {/* Empty state: an opt-in directory can legitimately be empty */}
          {!error && churches.length === 0 && (
            <Stack spacing={2} sx={{ py: 8, alignItems: "center" }}>
              <ChurchRoundedIcon
                sx={{ fontSize: 48, color: "text.secondary", opacity: 0.5 }}
              />
              <Typography variant="h6">No churches are listed yet</Typography>
              <Typography
                color="text.secondary"
                sx={{ maxWidth: "48ch", textAlign: "center" }}
              >
                Churches choose whether to appear here. As congregations opt in,
                they will show up on this page.
              </Typography>
            </Stack>
          )}

          {/* Church cards */}
          {churches.length > 0 && (
            <Grid container spacing={2}>
              {filteredChurches.map((church) => (
                <Grid key={church.id} size={{ xs: 12, sm: 6 }}>
                  <Card sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
                    <CardContent sx={{ flex: 1 }}>
                      <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
                        <ChurchRoundedIcon color="primary" />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                            {church.name}
                          </Typography>
                          {(church.city || church.country) && (
                            <Stack
                              direction="row"
                              spacing={0.5}
                              sx={{ mt: 0.5, alignItems: "center" }}
                            >
                              <LocationOnRoundedIcon
                                sx={{ fontSize: 16, color: "text.secondary" }}
                              />
                              <Typography variant="body2" color="text.secondary">
                                {[church.city, church.country]
                                  .filter(Boolean)
                                  .join(", ")}
                              </Typography>
                            </Stack>
                          )}
                          {church.website && (
                            <Button
                              size="small"
                              href={church.website}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                              sx={{ mt: 1, px: 0 }}
                            >
                              Visit website
                            </Button>
                          )}
                        </Box>
                      </Stack>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}

          {/* No results after filtering */}
          {churches.length > 0 && filteredChurches.length === 0 && (
            <Box sx={{ textAlign: "center", py: 6 }}>
              <Typography color="text.secondary">
                No churches found matching your search.
              </Typography>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
