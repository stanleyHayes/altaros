import { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Skeleton,
  Chip,
} from "@mui/material";
import {
  CheckCircle,
  Error as ErrorIcon,
} from "@mui/icons-material";
import AdminService, { type SystemHealth } from "@/services/admin.service";
import PageIntro from "@/components/ui/PageIntro";

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

export default function SystemHealthPage() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    AdminService.getHealth()
      .then(setHealth)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Grid container spacing={2}>{[0, 1].map((item) => <Grid key={item} size={{ xs: 12, md: 6 }}><Skeleton variant="rounded" height={320} /></Grid>)}</Grid>
    );
  }

  return (
    <Box>
      <PageIntro eyebrow="Infrastructure" title="System health" copy="Read the current state of the API, database and runtime memory without leaving the operator console." action={<Chip label={error ? "Attention required" : "All systems normal"} color={error ? "error" : "success"} />} />

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
                Service status
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Typography color="text.secondary">API</Typography>
                  <Chip
                    icon={error ? <ErrorIcon /> : <CheckCircle />}
                    label={error ? "Unreachable" : "Operational"}
                    color={error ? "error" : "success"}
                    size="small"
                  />
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Typography color="text.secondary">Database</Typography>
                  <Chip
                    icon={
                      health?.database === "connected" ? (
                        <CheckCircle />
                      ) : (
                        <ErrorIcon />
                      )
                    }
                    label={health?.database ?? "unknown"}
                    color={
                      health?.database === "connected" ? "success" : "error"
                    }
                    size="small"
                  />
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Typography color="text.secondary">Uptime</Typography>
                  <Typography sx={{ fontWeight: 600 }}>
                    {health ? formatUptime(health.uptime) : "—"}
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Typography color="text.secondary">Node Version</Typography>
                  <Typography sx={{ fontWeight: 600 }}>
                    {health?.nodeVersion ?? "—"}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
                Memory Usage
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography color="text.secondary">Heap Used</Typography>
                  <Typography sx={{ fontWeight: 600 }}>
                    {health?.memory.heapUsed ?? 0} MB
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography color="text.secondary">Heap Total</Typography>
                  <Typography sx={{ fontWeight: 600 }}>
                    {health?.memory.heapTotal ?? 0} MB
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography color="text.secondary">RSS</Typography>
                  <Typography sx={{ fontWeight: 600 }}>
                    {health?.memory.rss ?? 0} MB
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography color="text.secondary">Last Check</Typography>
                  <Typography sx={{ fontWeight: 600 }}>
                    {health
                      ? new Date(health.timestamp).toLocaleTimeString()
                      : "—"}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
