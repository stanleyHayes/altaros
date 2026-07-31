import { useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import ListItemText from "@mui/material/ListItemText";
import Avatar from "@mui/material/Avatar";
import TextField from "@mui/material/TextField";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Fab from "@mui/material/Fab";
import Divider from "@mui/material/Divider";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import type { GroupChat, ChatMessage } from "@altar-os/shared-types";

// TODO: Replace with real API data
const mockGroups: GroupChat[] = [
  {
    id: "g1",
    churchId: "c1",
    name: "Youth Group",
    description: "Youth ministry discussions",
    memberIds: ["m1", "m2", "m3"],
    createdBy: "m1",
    lastMessageAt: "2026-04-11T10:30:00Z",
    createdAt: "2025-01-15T08:00:00Z",
  },
  {
    id: "g2",
    churchId: "c1",
    name: "Prayer Warriors",
    description: "Share and pray for requests",
    memberIds: ["m1", "m4", "m5"],
    createdBy: "m4",
    lastMessageAt: "2026-04-11T09:15:00Z",
    createdAt: "2025-02-01T08:00:00Z",
  },
  {
    id: "g3",
    churchId: "c1",
    name: "Choir",
    description: "Choir rehearsals and song selections",
    memberIds: ["m2", "m3", "m6"],
    createdBy: "m2",
    lastMessageAt: "2026-04-10T18:45:00Z",
    createdAt: "2025-03-10T08:00:00Z",
  },
  {
    id: "g4",
    churchId: "c1",
    name: "General",
    description: "Open discussion for all members",
    memberIds: ["m1", "m2", "m3", "m4", "m5", "m6"],
    createdBy: "m1",
    lastMessageAt: "2026-04-10T14:20:00Z",
    createdAt: "2025-01-01T08:00:00Z",
  },
];

const mockMessages: Record<string, ChatMessage[]> = {
  g1: [
    {
      id: "msg1",
      groupId: "g1",
      senderId: "m2",
      senderName: "David O.",
      content: "Hey everyone! Are we still meeting on Friday?",
      createdAt: "2026-04-11T10:00:00Z",
    },
    {
      id: "msg2",
      groupId: "g1",
      senderId: "m1",
      senderName: "You",
      content: "Yes! 5 PM at the Youth Center as usual.",
      createdAt: "2026-04-11T10:15:00Z",
    },
    {
      id: "msg3",
      groupId: "g1",
      senderId: "m3",
      senderName: "Grace M.",
      content: "Great! I'll bring snacks this time.",
      createdAt: "2026-04-11T10:30:00Z",
    },
  ],
  g2: [
    {
      id: "msg4",
      groupId: "g2",
      senderId: "m4",
      senderName: "Michael T.",
      content: "Please pray for Sister Abena's surgery tomorrow.",
      createdAt: "2026-04-11T09:00:00Z",
    },
    {
      id: "msg5",
      groupId: "g2",
      senderId: "m1",
      senderName: "You",
      content: "Praying! God is in control.",
      createdAt: "2026-04-11T09:15:00Z",
    },
  ],
  g3: [
    {
      id: "msg6",
      groupId: "g3",
      senderId: "m2",
      senderName: "David O.",
      content: "New song list for Sunday has been shared in the drive.",
      createdAt: "2026-04-10T18:45:00Z",
    },
  ],
  g4: [
    {
      id: "msg7",
      groupId: "g4",
      senderId: "m5",
      senderName: "Esther B.",
      content: "Reminder: Church clean-up this Saturday at 8 AM!",
      createdAt: "2026-04-10T14:20:00Z",
    },
  ],
};

const lastMessagePreview: Record<string, string> = {
  g1: "Grace M.: Great! I'll bring snacks this time.",
  g2: "You: Praying! God is in control.",
  g3: "David O.: New song list for Sunday has been shared...",
  g4: "Esther B.: Reminder: Church clean-up this Saturday...",
};

const CURRENT_USER_ID = "m1";

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function ChatsPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    isMobile ? null : mockGroups[0].id,
  );
  const [messageInput, setMessageInput] = useState("");
  const [messages, setMessages] = useState(mockMessages);

  const selectedGroup = mockGroups.find((g) => g.id === selectedGroupId);
  const chatMessages = selectedGroupId ? messages[selectedGroupId] ?? [] : [];

  const handleSend = () => {
    if (!messageInput.trim() || !selectedGroupId) return;
    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      groupId: selectedGroupId,
      senderId: CURRENT_USER_ID,
      senderName: "You",
      content: messageInput.trim(),
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => ({
      ...prev,
      [selectedGroupId]: [...(prev[selectedGroupId] ?? []), newMsg],
    }));
    setMessageInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Mobile: show list or chat, not both
  const showList = !isMobile || !selectedGroupId;
  const showChat = !isMobile || !!selectedGroupId;

  return (
    <Box
      sx={{
        display: "flex",
        height: "calc(100vh - 128px)",
        overflow: "hidden",
      }}
    >
      {/* Group List Panel */}
      {showList && (
        <Box
          sx={{
            width: isMobile ? "100%" : 320,
            borderRight: isMobile ? "none" : "1px solid",
            borderColor: "divider",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
          }}
        >
          <Box sx={{ p: 2, pb: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Chats
            </Typography>
          </Box>
          <List sx={{ flex: 1, overflow: "auto" }}>
            {mockGroups.map((group) => (
              <ListItemButton
                key={group.id}
                selected={selectedGroupId === group.id}
                onClick={() => setSelectedGroupId(group.id)}
              >
                <ListItemAvatar>
                  <Avatar sx={{ bgcolor: "primary.main" }}>
                    {group.name.charAt(0)}
                  </Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={
                    <Typography variant="body1" noWrap sx={{ fontWeight: 600 }}>
                      {group.name}
                    </Typography>
                  }
                  secondary={
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {lastMessagePreview[group.id] ?? "No messages yet"}
                    </Typography>
                  }
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ ml: 1, flexShrink: 0 }}
                >
                  {group.lastMessageAt ? formatTime(group.lastMessageAt) : ""}
                </Typography>
              </ListItemButton>
            ))}
          </List>
          <Fab
            color="primary"
            size="medium"
            sx={{ position: "absolute", bottom: 80, right: 16 }}
            aria-label="New group chat"
            onClick={() => {
              // TODO: Open new group dialog
              console.log("Create new group");
            }}
          >
            <AddRoundedIcon />
          </Fab>
        </Box>
      )}

      {/* Chat Messages Panel */}
      {showChat && (
        <Box
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
          }}
        >
          {selectedGroup ? (
            <>
              {/* Chat Header */}
              <Paper
                elevation={0}
                sx={{
                  px: 2,
                  py: 1.5,
                  borderBottom: "1px solid",
                  borderColor: "divider",
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                }}
              >
                {isMobile && (
                  <IconButton
                    size="small"
                    onClick={() => setSelectedGroupId(null)}
                  >
                    <ArrowBackRoundedIcon />
                  </IconButton>
                )}
                <Avatar sx={{ bgcolor: "primary.main", width: 36, height: 36 }}>
                  {selectedGroup.name.charAt(0)}
                </Avatar>
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {selectedGroup.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {selectedGroup.memberIds.length} members
                  </Typography>
                </Box>
              </Paper>

              {/* Messages */}
              <Box
                sx={{
                  flex: 1,
                  overflow: "auto",
                  px: 2,
                  py: 2,
                  display: "flex",
                  flexDirection: "column",
                  gap: 1.5,
                }}
              >
                {chatMessages.map((msg) => {
                  const isMe = msg.senderId === CURRENT_USER_ID;
                  return (
                    <Box
                      key={msg.id}
                      sx={{
                        display: "flex",
                        justifyContent: isMe ? "flex-end" : "flex-start",
                      }}
                    >
                      <Box
                        sx={{
                          maxWidth: "75%",
                          bgcolor: isMe ? "primary.main" : "grey.100",
                          color: isMe ? "white" : "text.primary",
                          borderRadius: 2,
                          px: 2,
                          py: 1,
                        }}
                      >
                        {!isMe && (
                          <Typography
                            variant="caption"
                            sx={{
                              fontWeight: 700,
                              color: isMe ? "primary.light" : "primary.main",
                              display: "block",
                              mb: 0.25,
                            }}
                          >
                            {msg.senderName}
                          </Typography>
                        )}
                        <Typography variant="body2">{msg.content}</Typography>
                        <Typography
                          variant="caption"
                          sx={{
                            opacity: 0.7,
                            display: "block",
                            textAlign: "right",
                            mt: 0.5,
                          }}
                        >
                          {formatTime(msg.createdAt)}
                        </Typography>
                      </Box>
                    </Box>
                  );
                })}
              </Box>

              {/* Message Input */}
              <Divider />
              <Box
                sx={{
                  p: 1.5,
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 1,
                }}
              >
                <TextField
                  fullWidth
                  multiline
                  maxRows={3}
                  size="small"
                  placeholder="Type a message..."
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  sx={{
                    "& .MuiOutlinedInput-root": { borderRadius: 3 },
                  }}
                />
                <IconButton
                  color="primary"
                  onClick={handleSend}
                  disabled={!messageInput.trim()}
                >
                  <SendRoundedIcon />
                </IconButton>
              </Box>
            </>
          ) : (
            <Box
              sx={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Typography variant="body1" color="text.secondary">
                Select a chat to start messaging
              </Typography>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
