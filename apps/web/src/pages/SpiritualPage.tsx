import { useState, useRef, useEffect, useCallback } from "react";

// Type for the actual response from the Go backend
interface SpritualApiResponse<T> {
  devotionals?: T[];
  sermons?: T[];
  requests?: T[];
  data?: T[];
  total: number;
}
import { useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import IconButton from "@mui/material/IconButton";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import SendIcon from "@mui/icons-material/Send";
import DevotionalCard from "@/components/spiritual/DevotionalCard";
import SermonCard from "@/components/spiritual/SermonCard";
import PrayerRequestForm from "@/components/spiritual/PrayerRequestForm";
import type { PrayerChatMessage } from "@altar-os/shared-types";
import PageIntro from "@/components/ui/PageIntro";
import { useSnackbar } from "notistack";
import SpiritualService, { Devotional, Sermon } from "@/services/spiritual.service";
import { ApiError } from "@/services/api";

const tabMap: Record<string, number> = {
  devotionals: 0,
  sermons: 1,
  bible: 2,
  prayer: 3,
  "ai-prayer": 4,
};

export default function SpiritualPage() {
  const [searchParams] = useSearchParams();
  const initialTab = tabMap[searchParams.get("tab") || ""] ?? 0;
  const [tab, setTab] = useState(initialTab);
  const [devotionals, setDevotionals] = useState<Devotional[]>([]);
  const [sermons, setSermons] = useState<Sermon[]>([]);
  const [loadingDevotionals, setLoadingDevotionals] = useState(false);
  const [loadingSermons, setLoadingSermons] = useState(false);
  const [devotionalsError, setDevotionalsError] = useState<string | null>(null);
  const [sermonsError, setSermonsError] = useState<string | null>(null);
  const { enqueueSnackbar } = useSnackbar();

  const loadDevotionals = useCallback(async () => {
    try {
      setLoadingDevotionals(true);
      setDevotionalsError(null);
      const response = await SpiritualService.getDevotionals(1);
      // The Go handler returns {devotionals: [...], total: N}
      // Extract devotionals from the custom envelope
      const typedResponse = response as SpritualApiResponse<Devotional>;
      const devotionalsList = typedResponse.devotionals || typedResponse.data || [];
      setDevotionals(Array.isArray(devotionalsList) ? devotionalsList : []);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Failed to load devotionals";
      setDevotionalsError(message);
      enqueueSnackbar(message, { variant: "error" });
    } finally {
      setLoadingDevotionals(false);
    }
  }, [enqueueSnackbar]);

  const loadSermons = useCallback(async () => {
    try {
      setLoadingSermons(true);
      setSermonsError(null);
      const response = await SpiritualService.getSermons(1);
      // The Go handler returns {sermons: [...], total: N}
      // Extract sermons from the custom envelope
      const typedResponse = response as SpritualApiResponse<Sermon>;
      const sermonsList = typedResponse.sermons || typedResponse.data || [];
      setSermons(Array.isArray(sermonsList) ? sermonsList : []);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Failed to load sermons";
      setSermonsError(message);
      enqueueSnackbar(message, { variant: "error" });
    } finally {
      setLoadingSermons(false);
    }
  }, [enqueueSnackbar]);

  // Load devotionals when tab changes to 0
  useEffect(() => {
    if (tab === 0 && devotionals.length === 0 && !loadingDevotionals) {
      loadDevotionals();
    }
  }, [tab, devotionals.length, loadingDevotionals, loadDevotionals]);

  // Load sermons when tab changes to 1
  useEffect(() => {
    if (tab === 1 && sermons.length === 0 && !loadingSermons) {
      loadSermons();
    }
  }, [tab, sermons.length, loadingSermons, loadSermons]);

  const handlePrayerSubmit = async (data: {
    title: string;
    description: string;
    isAnonymous: boolean;
  }) => {
    try {
      await SpiritualService.submitPrayerRequest(data);
      enqueueSnackbar("Prayer request submitted. Your church is praying with you.", {
        variant: "success",
      });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Failed to submit prayer request";
      enqueueSnackbar(message, { variant: "error" });
    }
  };

  return (
    <Box sx={{ py: 2 }}>
      <PageIntro eyebrow="Spiritual life" title="A place to grow" copy="Read, listen, pray and keep a steady rhythm through the week." />

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 3 }}
      >
        <Tab label="Devotionals" />
        <Tab label="Sermons" />
        <Tab label="Bible" />
        <Tab label="Prayer" />
        <Tab label="AI Prayer" />
      </Tabs>

      {/* Devotionals */}
      {tab === 0 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {loadingDevotionals && <CircularProgress />}
          {devotionalsError && (
            <Alert severity="error" onClose={() => setDevotionalsError(null)}>
              {devotionalsError}
            </Alert>
          )}
          {!loadingDevotionals && devotionals.length === 0 && !devotionalsError && (
            <Alert severity="info">No devotionals available right now.</Alert>
          )}
          {devotionals.map((d) => (
            <DevotionalCard
              key={d.id}
              title={d.title}
              scripture={d.scripture}
              excerpt={d.scriptureText}
              date={d.date}
              author={d.author}
            />
          ))}
        </Box>
      )}

      {/* Sermons */}
      {tab === 1 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {loadingSermons && <CircularProgress />}
          {sermonsError && (
            <Alert severity="error" onClose={() => setSermonsError(null)}>
              {sermonsError}
            </Alert>
          )}
          {!loadingSermons && sermons.length === 0 && !sermonsError && (
            <Alert severity="info">No sermons available right now.</Alert>
          )}
          {sermons.map((s) => (
            <SermonCard
              key={s.id}
              title={s.title}
              speaker={s.speaker}
              date={s.date}
              duration={s.duration}
              series={s.series}
            />
          ))}
        </Box>
      )}

      {/* Bible */}
      {tab === 2 && (
        <Box sx={{ textAlign: "center", py: 6 }}>
          <Typography variant="h6" color="text.secondary" gutterBottom>
            Bible Reader
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Coming soon. Read and study Scripture right from your church app.
          </Typography>
        </Box>
      )}

      {/* Prayer */}
      {tab === 3 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <PrayerRequestForm onSubmit={handlePrayerSubmit} />
        </Box>
      )}

      {/* AI Prayer Chat */}
      {tab === 4 && <AiPrayerChat />}
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  AI Prayer Chat Component                                           */
/* ------------------------------------------------------------------ */

/**
 * Prayer chat — not available.
 *
 * This component used to hold a conversation. It seeded a welcome message,
 * then answered whatever a member typed with locally written replies and
 * canned scripture, because there is no AI backend: `ai` is still a
 * placeholder in the service registry with no routes behind it.
 *
 * That made it the most dishonest screen in the product. Someone typing a
 * real fear — a diagnosis, a marriage, a bereavement — received what looked
 * like pastoral counsel and was in fact a hardcoded string chosen by keyword.
 * A member cannot tell the difference, and the ones most likely to use it are
 * the ones least able to afford being deceived by it.
 *
 * It says what is true instead, until there is something real behind it.
 */
function AiPrayerChat() {
  return (
    <Box sx={{ textAlign: "center", py: 8, px: 3 }}>
      <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
        Prayer chat is not available yet
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: "46ch", mx: "auto" }}>
        We are still building this. In the meantime you can send a prayer
        request from the Prayer Requests tab and someone at your church will
        see it.
      </Typography>
    </Box>
  );
}
