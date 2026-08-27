import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Grid,
  LinearProgress,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import ChurchRounded from "@mui/icons-material/ChurchRounded";
import PlaceRounded from "@mui/icons-material/PlaceRounded";
import OpenInNewRounded from "@mui/icons-material/OpenInNew";
import SEO from "@/components/ui/SEO";
import directoryService, {
  type DirectoryCampaign,
  type DirectoryChurch,
} from "@/services/directory.service";

/**
 * The public directory of churches using ALTAR OS.
 *
 * Every church on this page opted in, and the API returns nothing that was not
 * explicitly published — a church appears only if it said so, and a campaign
 * only if the church chose to list it here rather than merely make it public on
 * its own site. That is why this page fetches at runtime instead of being built
 * into the bundle: withdrawing consent has to take effect now, not at the next
 * marketing deploy.
 */

/** Money arrives in minor units, like every amount the finance domain emits. */
function money(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: currency || "GHS",
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

export default function DirectoryPage() {
  const [churches, setChurches] = useState<DirectoryChurch[]>([]);
  const [campaigns, setCampaigns] = useState<DirectoryCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, a] = await Promise.all([
          directoryService.churches(),
          directoryService.campaigns(),
        ]);
        if (cancelled) return;
        setChurches(c);
        setCampaigns(a);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <SEO
        title="Church Directory — ALTAR OS"
        description="Churches running on ALTAR OS, and the appeals they have chosen to share publicly."
      />

      <Box sx={{ bgcolor: "background.paper", borderBottom: "1px solid rgba(16,42,39,.10)" }}>
        <Container maxWidth="lg" sx={{ py: { xs: 6, md: 9 } }}>
          <Typography variant="h2" sx={{ fontWeight: 700, mb: 2 }}>
            Churches on ALTAR OS
          </Typography>
          <Typography variant="h6" color="text.secondary" sx={{ maxWidth: "62ch", fontWeight: 400 }}>
            Congregations who chose to be listed here, and the appeals they are
            running. Every entry is published by the church itself.
          </Typography>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: { xs: 6, md: 8 } }}>
        {failed && (
          <Alert severity="info" sx={{ mb: 4 }}>
            The directory is not available right now. Please try again shortly.
          </Alert>
        )}

        {loading ? (
          <Grid container spacing={3}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={i}>
                <Skeleton variant="rounded" height={148} />
              </Grid>
            ))}
          </Grid>
        ) : (
          <>
            {/*
              An opt-in directory can legitimately be empty, and saying so
              plainly is better than an empty grid that reads as a broken page.
            */}
            {!failed && churches.length === 0 && (
              <Stack spacing={2} sx={{ py: 8, alignItems: "center" }}>
                <ChurchRounded sx={{ fontSize: 48, color: "text.secondary", opacity: 0.5 }} />
                <Typography variant="h6">No churches are listed yet</Typography>
                <Typography color="text.secondary" sx={{ maxWidth: "48ch", textAlign: "center" }}>
                  Churches choose whether to appear here. As congregations opt
                  in, they will show up on this page.
                </Typography>
              </Stack>
            )}

            {churches.length > 0 && (
              <Grid container spacing={3}>
                {churches.map((church) => (
                  <Grid size={{ xs: 12, sm: 6, md: 4 }} key={church.id}>
                    <Card sx={{ height: "100%" }}>
                      <CardContent>
                        <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
                          <ChurchRounded color="primary" />
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                              {church.name}
                            </Typography>
                            {(church.city || church.country) && (
                              <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, alignItems: "center" }}>
                                <PlaceRounded sx={{ fontSize: 16, color: "text.secondary" }} />
                                <Typography variant="body2" color="text.secondary">
                                  {[church.city, church.country].filter(Boolean).join(", ")}
                                </Typography>
                              </Stack>
                            )}
                            {church.website && (
                              <Button
                                size="small"
                                href={church.website}
                                target="_blank"
                                rel="noopener noreferrer nofollow"
                                endIcon={<OpenInNewRounded sx={{ fontSize: 14 }} />}
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

            {campaigns.length > 0 && (
              <Box sx={{ mt: { xs: 7, md: 10 } }}>
                <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
                  Current appeals
                </Typography>
                <Typography color="text.secondary" sx={{ mb: 4, maxWidth: "62ch" }}>
                  Fundraising these churches have chosen to share beyond their
                  own congregations.
                </Typography>

                <Grid container spacing={3}>
                  {campaigns.map((campaign) => (
                    <Grid size={{ xs: 12, sm: 6, md: 4 }} key={campaign.id}>
                      <Card sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
                        {campaign.coverImageUrl && (
                          <Box
                            component="img"
                            src={campaign.coverImageUrl}
                            alt=""
                            loading="lazy"
                            sx={{
                              width: "100%",
                              height: 160,
                              objectFit: "cover",
                              display: "block",
                            }}
                          />
                        )}
                        <CardContent sx={{ flex: 1 }}>
                          <Chip
                            label={campaign.churchName}
                            size="small"
                            sx={{ mb: 1.5 }}
                          />
                          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                            {campaign.title}
                          </Typography>
                          {campaign.description && (
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{ mt: 0.5, mb: 2 }}
                            >
                              {campaign.description}
                            </Typography>
                          )}

                          {/*
                            Progress appears only when the church chose to show
                            it. An appeal that is far from its target is a
                            private matter unless the church decided otherwise,
                            so absence here is a setting, not missing data —
                            and it must not be filled in with a zero bar.
                          */}
                          {typeof campaign.progress === "number" ? (
                            <Box sx={{ mt: 1 }}>
                              <LinearProgress
                                variant="determinate"
                                value={Math.min(100, Math.max(0, campaign.progress))}
                                sx={{ height: 8, borderRadius: 4, mb: 1 }}
                              />
                              <Typography variant="body2" color="text.secondary">
                                {typeof campaign.currentAmount === "number"
                                  ? `${money(campaign.currentAmount, campaign.currency)} of ${money(
                                      campaign.targetAmount,
                                      campaign.currency,
                                    )}`
                                  : `${campaign.progress}% of ${money(
                                      campaign.targetAmount,
                                      campaign.currency,
                                    )}`}
                              </Typography>
                            </Box>
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              Target {money(campaign.targetAmount, campaign.currency)}
                            </Typography>
                          )}
                        </CardContent>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              </Box>
            )}
          </>
        )}
      </Container>
    </>
  );
}
