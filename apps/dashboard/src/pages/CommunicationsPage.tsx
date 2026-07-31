import { useState } from "react";
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
} from "@mui/material";
import {
  Send as SendIcon,
  Campaign as AnnouncementIcon,
  Delete as DeleteIcon,
  Visibility as ViewIcon,
} from "@mui/icons-material";
import ComposeMessageDialog, {
  type ComposeMessageFormData,
} from "@/components/communications/ComposeMessageDialog";
import AnnouncementFormDialog, {
  type AnnouncementFormData,
} from "@/components/communications/AnnouncementFormDialog";

interface MessageItem {
  id: string;
  subject: string;
  body: string;
  type: "push" | "sms" | "email";
  recipientCount: number;
  status: "sent" | "scheduled" | "draft" | "failed";
  sentAt?: string;
  createdAt: string;
}

interface AnnouncementItem {
  id: string;
  title: string;
  content: string;
  priority: "low" | "normal" | "high" | "urgent";
  isPublished: boolean;
  publishedAt?: string;
  expiresAt?: string;
  createdAt: string;
}

// TODO: Replace with real API data from CommunicationService
const sampleMessages: MessageItem[] = [
  {
    id: "1",
    subject: "Sunday Service Reminder",
    body: "Don't forget to join us this Sunday at 9 AM for worship service!",
    type: "push",
    recipientCount: 892,
    status: "sent",
    sentAt: "2026-03-28T08:00:00",
    createdAt: "2026-03-27T14:30:00",
  },
  {
    id: "2",
    subject: "Easter Service Schedule",
    body: "Special Easter services on April 5th. Multiple service times available.",
    type: "email",
    recipientCount: 1248,
    status: "sent",
    sentAt: "2026-03-25T10:00:00",
    createdAt: "2026-03-24T16:00:00",
  },
  {
    id: "3",
    subject: "Youth Camp Registration",
    body: "Registration for summer youth camp is now open! Limited spots available.",
    type: "sms",
    recipientCount: 156,
    status: "sent",
    sentAt: "2026-03-22T12:00:00",
    createdAt: "2026-03-22T11:30:00",
  },
  {
    id: "4",
    subject: "Mid-Week Bible Study Update",
    body: "This week we continue our study in the book of Romans, chapter 8.",
    type: "push",
    recipientCount: 450,
    status: "scheduled",
    createdAt: "2026-03-29T09:00:00",
  },
  {
    id: "5",
    subject: "Volunteer Appreciation",
    body: "Thank you to all who volunteered at last weekend's community outreach!",
    type: "email",
    recipientCount: 78,
    status: "draft",
    createdAt: "2026-03-29T08:00:00",
  },
];

const sampleAnnouncements: AnnouncementItem[] = [
  {
    id: "1",
    title: "Easter Sunday Service Times",
    content:
      "We will have three services on Easter Sunday: 7 AM Sunrise Service, 9 AM, and 11 AM. Invite your family and friends!",
    priority: "high",
    isPublished: true,
    publishedAt: "2026-03-25T10:00:00",
    expiresAt: "2026-04-06",
    createdAt: "2026-03-25T09:30:00",
  },
  {
    id: "2",
    title: "New Members Welcome Lunch",
    content:
      "Join us for a welcome lunch for new members this Sunday after the 11 AM service in Fellowship Hall.",
    priority: "normal",
    isPublished: true,
    publishedAt: "2026-03-26T08:00:00",
    createdAt: "2026-03-26T07:45:00",
  },
  {
    id: "3",
    title: "Building Renovation Update",
    content:
      "Phase 2 of the building renovation project will begin next month. Some areas may have limited access.",
    priority: "normal",
    isPublished: true,
    publishedAt: "2026-03-20T14:00:00",
    createdAt: "2026-03-20T13:30:00",
  },
  {
    id: "4",
    title: "Urgent: Water Main Repair",
    content:
      "The church water supply will be temporarily unavailable this Tuesday from 8 AM to 2 PM for repairs.",
    priority: "urgent",
    isPublished: true,
    publishedAt: "2026-03-28T16:00:00",
    expiresAt: "2026-03-31",
    createdAt: "2026-03-28T15:45:00",
  },
];

const channelColor: Record<string, "info" | "success" | "primary"> = {
  push: "info",
  sms: "success",
  email: "primary",
};

const statusColor: Record<string, "success" | "warning" | "default" | "error"> = {
  sent: "success",
  scheduled: "warning",
  draft: "default",
  failed: "error",
};

const priorityColor: Record<string, "default" | "info" | "warning" | "error"> = {
  low: "default",
  normal: "info",
  high: "warning",
  urgent: "error",
};

export default function CommunicationsPage() {
  const [tabIndex, setTabIndex] = useState(0);
  const [composeOpen, setComposeOpen] = useState(false);
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [messages, setMessages] = useState(sampleMessages);
  const [announcements, setAnnouncements] = useState(sampleAnnouncements);

  const handleSendMessage = async (data: ComposeMessageFormData) => {
    // TODO: Call CommunicationService.createMessage
    const newMsg: MessageItem = {
      id: String(Date.now()),
      subject: data.subject,
      body: data.body,
      type: data.type,
      recipientCount: 0,
      status: "sent",
      sentAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [newMsg, ...prev]);
  };

  const handleCreateAnnouncement = async (data: AnnouncementFormData) => {
    // TODO: Call CommunicationService.createAnnouncement
    const newAnn: AnnouncementItem = {
      id: String(Date.now()),
      title: data.title,
      content: data.content,
      priority: data.priority,
      isPublished: data.isPublished,
      publishedAt: data.isPublished ? new Date().toISOString() : undefined,
      expiresAt: data.expiresAt || undefined,
      createdAt: new Date().toISOString(),
    };
    setAnnouncements((prev) => [newAnn, ...prev]);
  };

  const handleDeleteMessage = (id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  };

  const handleDeleteAnnouncement = (id: string) => {
    setAnnouncements((prev) => prev.filter((a) => a.id !== id));
  };

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
            >
              Compose
            </Button>
          )}
          {tabIndex === 1 && (
            <Button
              variant="contained"
              startIcon={<AnnouncementIcon />}
              onClick={() => setAnnouncementOpen(true)}
            >
              Create Announcement
            </Button>
          )}
        </Box>
      </Box>

      <Tabs
        value={tabIndex}
        onChange={(_, v) => setTabIndex(v)}
        sx={{ mb: 3, borderBottom: 1, borderColor: "divider" }}
      >
        <Tab label="Messages" />
        <Tab label="Announcements" />
      </Tabs>

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
                          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                            {msg.subject}
                          </Typography>
                          <Chip
                            label={msg.type.toUpperCase()}
                            size="small"
                            color={channelColor[msg.type]}
                            variant="outlined"
                            sx={{ height: 20, fontSize: 11 }}
                          />
                          <Chip
                            label={msg.status}
                            size="small"
                            color={statusColor[msg.status]}
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
                          <Typography variant="caption" color="text.secondary">
                            {msg.recipientCount} recipients
                            {msg.sentAt &&
                              ` -- Sent ${new Date(msg.sentAt).toLocaleDateString()}`}
                          </Typography>
                        </Box>
                      }
                    />
                    <ListItemSecondaryAction>
                      <Tooltip title="View">
                        <IconButton size="small">
                          <ViewIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDeleteMessage(msg.id)}
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
                          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                            {ann.title}
                          </Typography>
                          <Chip
                            label={ann.priority}
                            size="small"
                            color={priorityColor[ann.priority]}
                            sx={{ height: 20, fontSize: 11 }}
                          />
                          {!ann.isPublished && (
                            <Chip
                              label="Draft"
                              size="small"
                              variant="outlined"
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
                            {ann.content}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {ann.publishedAt
                              ? `Published ${new Date(ann.publishedAt).toLocaleDateString()}`
                              : `Created ${new Date(ann.createdAt).toLocaleDateString()}`}
                            {ann.expiresAt && ` -- Expires ${ann.expiresAt}`}
                          </Typography>
                        </Box>
                      }
                    />
                    <ListItemSecondaryAction>
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDeleteAnnouncement(ann.id)}
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
                        No announcements yet. Click Create Announcement to get
                        started.
                      </Typography>
                    }
                  />
                </ListItem>
              )}
            </List>
          </CardContent>
        </Card>
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
    </Box>
  );
}
