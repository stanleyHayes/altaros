import { useState, useCallback, useEffect } from "react";
import {
  Box,
  Typography,
  Button,
  Tabs,
  Tab,
  Chip,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Tooltip,
  Divider,
  Alert,
  CircularProgress,
  Snackbar,
} from "@mui/material";
import {
  Send as SendIcon,
  Campaign as AnnouncementIcon,
  Delete as DeleteIcon,
} from "@mui/icons-material";
import ComposeMessageDialog, {
  type ComposeMessageFormData,
} from "@/components/communications/ComposeMessageDialog";
import AnnouncementFormDialog, {
  type AnnouncementFormData,
} from "@/components/communications/AnnouncementFormDialog";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import CommunicationService, {
  type Campaign,
} from "@/services/communication.service";

const channelColor: Record<string, "info" | "success" | "primary"> = {
  push: "info",
  sms: "success",
  email: "primary",
};

const stateColor: Record<
  string,
  "success" | "warning" | "default" | "error"
> = {
  sent: "success",
  scheduled: "warning",
  draft: "default",
  failed: "error",
  sending: "warning",
  cancelled: "default",
};

export default function CommunicationsPage() {
  const [tabIndex, setTabIndex] = useState(0);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sendTarget, setSendTarget] = useState<Campaign | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);

  // Messages tab: campaigns with channel in [push, sms, email]
  const messages = campaigns.filter((c) => ["push", "sms", "email"].includes(c.channel));

  // Announcements tab: campaigns with channel = "announcement"
  const announcements = campaigns.filter((c) => c.channel === "announcement");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await CommunicationService.getCampaigns();
      setCampaigns(data);
    } catch {
      setLoadError(
        "We could not load your communications. Check your connection and try again.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSendMessage = useCallback(
    async (data: ComposeMessageFormData) => {
      setSubmitting(true);
      try {
        // Create campaign in draft state
        const created = await CommunicationService.createCampaign({
          name: data.subject,
          channel: data.type,
          subject: data.subject,
          body: data.body,
          filter: {
            targetDepartment: data.targetDepartment || undefined,
            targetStatus: data.targetStatus || undefined,
          },
        });

        // Immediately send
        await CommunicationService.sendCampaign(created.id);

        setNotice("Message sent successfully.");
        setCampaigns((prev) => [created, ...prev]);
      } catch (error) {
        // Throw so the form stays open with values intact
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        setNotice(`Could not send message: ${msg}`);
        throw error;
      } finally {
        setSubmitting(false);
      }
    },
    [],
  );

  const handleCreateAnnouncement = useCallback(
    async (data: AnnouncementFormData) => {
      setSubmitting(true);
      try {
        // Create campaign
        const created = await CommunicationService.createCampaign({
          name: data.title,
          channel: "announcement",
          body: data.content,
          filter: {},
        });

        // If published, send it immediately
        let final = created;
        if (data.isPublished) {
          final = await CommunicationService.sendCampaign(created.id);
        }

        setNotice("Announcement created successfully.");
        setCampaigns((prev) => [final, ...prev]);
      } catch (error) {
        // Throw so the form stays open with values intact
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        setNotice(`Could not create announcement: ${msg}`);
        throw error;
      } finally {
        setSubmitting(false);
      }
    },
    [],
  );

  const handleSendCampaign = useCallback(async () => {
    if (!sendTarget) return;
    const target = sendTarget;
    setSendTarget(null);

    setSubmitting(true);
    try {
      const updated = await CommunicationService.sendCampaign(target.id);
      setCampaigns((prev) =>
        prev.map((c) => (c.id === target.id ? updated : c)),
      );
      setNotice("Campaign sent successfully.");
    } catch (error) {
      setNotice(
        `Could not send campaign: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setSubmitting(false);
    }
  }, [sendTarget]);

  /**
   * Cancel a campaign rather than delete it.
   *
   * There is no delete endpoint. A campaign that has gone out has reached
   * real phones, so there is nothing to take back and no honest way to erase
   * the record of having sent it; one that has not gone out is cancelled so
   * it never does. It stays in the list, marked cancelled.
   */
  const handleCancelCampaign = useCallback(async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);

    setSubmitting(true);
    try {
      await CommunicationService.cancelCampaign(target.id);
      setCampaigns((prev) =>
        prev.map((c) =>
          c.id === target.id ? { ...c, state: "cancelled" } : c,
        ),
      );
      setNotice("Campaign cancelled.");
    } catch (error) {
      setNotice(
        `Could not cancel campaign: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setSubmitting(false);
    }
  }, [deleteTarget]);

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
          Communications
        </Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          {tabIndex === 0 && (
            <Button
              variant="contained"
              startIcon={<SendIcon />}
              onClick={() => setComposeOpen(true)}
              disabled={submitting}
            >
              Compose
            </Button>
          )}
          {tabIndex === 1 && (
            <Button
              variant="contained"
              startIcon={<AnnouncementIcon />}
              onClick={() => setAnnouncementOpen(true)}
              disabled={submitting}
            >
              Create Announcement
            </Button>
          )}
        </Box>
      </Box>

      {loadError && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => void load()}>
              Retry
            </Button>
          }
        >
          {loadError}
        </Alert>
      )}

      <Tabs
        value={tabIndex}
        onChange={(_, v) => setTabIndex(v)}
        sx={{ mb: 3, borderBottom: 1, borderColor: "divider" }}
      >
        <Tab label="Messages" />
        <Tab label="Announcements" />
      </Tabs>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          {/* Messages Tab */}
          {tabIndex === 0 && (
            <Card>
              <CardContent sx={{ p: 0 }}>
                <List disablePadding>
                  {messages.map((msg, idx) => (
                    <Box key={msg.id}>
                      {idx > 0 && <Divider />}
                      <ListItem sx={{ py: 2, px: 3 }}>
                        <ListItemText
                          primary={
                            <Box
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 1,
                                mb: 0.5,
                              }}
                            >
                              <Typography
                                variant="subtitle2"
                                sx={{ fontWeight: 600 }}
                              >
                                {msg.subject}
                              </Typography>
                              <Chip
                                label={msg.channel.toUpperCase()}
                                size="small"
                                color={
                                  channelColor[
                                    msg.channel as keyof typeof channelColor
                                  ] || "default"
                                }
                                variant="outlined"
                                sx={{ height: 20, fontSize: 11 }}
                              />
                              <Chip
                                label={msg.state}
                                size="small"
                                color={
                                  stateColor[
                                    msg.state as keyof typeof stateColor
                                  ] || "default"
                                }
                                sx={{ height: 20, fontSize: 11 }}
                              />
                            </Box>
                          }
                          secondary={
                            <Box>
                              <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{
                                  display: "-webkit-box",
                                  WebkitLineClamp: 1,
                                  WebkitBoxOrient: "vertical",
                                  overflow: "hidden",
                                  mb: 0.5,
                                }}
                              >
                                {msg.body}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {msg.recipients} recipients
                                {msg.sentAt &&
                                  ` -- Sent ${new Date(msg.sentAt).toLocaleDateString()}`}
                              </Typography>
                            </Box>
                          }
                        />
                        <ListItemSecondaryAction>
                          {msg.state === "draft" && (
                            <Tooltip title="Send">
                              <IconButton
                                size="small"
                                onClick={() => setSendTarget(msg)}
                                disabled={submitting}
                              >
                                <SendIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                          <Tooltip title="Cancel">
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => setDeleteTarget(msg)}
                              disabled={submitting}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </ListItemSecondaryAction>
                      </ListItem>
                    </Box>
                  ))}
                  {messages.length === 0 && (
                    <ListItem>
                      <ListItemText
                        primary={
                          <Typography
                            color="text.secondary"
                            sx={{ textAlign: "center", py: 4 }}
                          >
                            No messages yet. Click Compose to send your first
                            message.
                          </Typography>
                        }
                      />
                    </ListItem>
                  )}
                </List>
              </CardContent>
            </Card>
          )}

          {/* Announcements Tab */}
          {tabIndex === 1 && (
            <Card>
              <CardContent sx={{ p: 0 }}>
                <List disablePadding>
                  {announcements.map((ann, idx) => (
                    <Box key={ann.id}>
                      {idx > 0 && <Divider />}
                      <ListItem sx={{ py: 2, px: 3 }}>
                        <ListItemText
                          primary={
                            <Box
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 1,
                                mb: 0.5,
                              }}
                            >
                              <Typography
                                variant="subtitle2"
                                sx={{ fontWeight: 600 }}
                              >
                                {ann.name}
                              </Typography>
                              {ann.state === "draft" && (
                                <Chip
                                  label="Draft"
                                  size="small"
                                  variant="outlined"
                                  sx={{ height: 20, fontSize: 11 }}
                                />
                              )}
                              {ann.state === "sent" && (
                                <Chip
                                  label="Published"
                                  size="small"
                                  color="success"
                                  sx={{ height: 20, fontSize: 11 }}
                                />
                              )}
                            </Box>
                          }
                          secondary={
                            <Box>
                              <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{
                                  display: "-webkit-box",
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: "vertical",
                                  overflow: "hidden",
                                  mb: 0.5,
                                }}
                              >
                                {ann.body}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {ann.sentAt
                                  ? `Published ${new Date(ann.sentAt).toLocaleDateString()}`
                                  : `Created ${new Date(ann.createdAt).toLocaleDateString()}`}
                              </Typography>
                            </Box>
                          }
                        />
                        <ListItemSecondaryAction>
                          {ann.state === "draft" && (
                            <Tooltip title="Publish">
                              <IconButton
                                size="small"
                                onClick={() => setSendTarget(ann)}
                                disabled={submitting}
                              >
                                <SendIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                          <Tooltip title="Cancel">
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => setDeleteTarget(ann)}
                              disabled={submitting}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </ListItemSecondaryAction>
                      </ListItem>
                    </Box>
                  ))}
                  {announcements.length === 0 && (
                    <ListItem>
                      <ListItemText
                        primary={
                          <Typography
                            color="text.secondary"
                            sx={{ textAlign: "center", py: 4 }}
                          >
                            No announcements yet. Click Create Announcement to
                            get started.
                          </Typography>
                        }
                      />
                    </ListItem>
                  )}
                </List>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Compose Message Dialog */}
      <ComposeMessageDialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onSubmit={handleSendMessage}
      />

      {/* Create Announcement Dialog */}
      <AnnouncementFormDialog
        open={announcementOpen}
        onClose={() => setAnnouncementOpen(false)}
        onSubmit={handleCreateAnnouncement}
      />

      {/* Send Confirmation Dialog */}
      <ConfirmDialog
        open={!!sendTarget}
        title="Send campaign to congregation"
        message={
          sendTarget
            ? `This will send to all matching recipients. Sending is irreversible.`
            : ""
        }
        confirmLabel="Send"
        confirmColor="warning"
        onConfirm={() => void handleSendCampaign()}
        onCancel={() => setSendTarget(null)}
      />

      {/* Cancel Confirmation Dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Cancel campaign"
        message="This campaign will be cancelled so it is not sent. It stays in the list, marked cancelled — a message that has already gone out cannot be taken back."
        confirmLabel="Cancel campaign"
        confirmColor="error"
        onConfirm={() => void handleCancelCampaign()}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Notification Snackbar */}
      <Snackbar
        open={!!notice}
        autoHideDuration={5000}
        onClose={() => setNotice(null)}
        message={notice ?? ""}
      />
    </Box>
  );
}
