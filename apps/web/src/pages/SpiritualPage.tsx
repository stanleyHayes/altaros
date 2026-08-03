import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import IconButton from "@mui/material/IconButton";
import CircularProgress from "@mui/material/CircularProgress";
import SendIcon from "@mui/icons-material/Send";
import DevotionalCard from "@/components/spiritual/DevotionalCard";
import SermonCard from "@/components/spiritual/SermonCard";
import PrayerRequestForm from "@/components/spiritual/PrayerRequestForm";
import type { PrayerChatMessage } from "@altar-os/shared-types";
import PageIntro from "@/components/ui/PageIntro";

// TODO: Replace with actual API data
const mockDevotionals = [
  {
    id: "1",
    title: "Trust in the Lord",
    scripture: "Proverbs 3:5-6",
    excerpt:
      "Trust in the Lord with all your heart and lean not on your own understanding. In all your ways submit to him, and he will make your paths straight.",
    date: "Mar 29, 2026",
    author: "Pastor James",
  },
  {
    id: "2",
    title: "His Mercies Are New",
    scripture: "Lamentations 3:22-23",
    excerpt:
      "Because of the Lord's great love we are not consumed, for his compassions never fail. They are new every morning; great is your faithfulness.",
    date: "Mar 28, 2026",
    author: "Minister Grace",
  },
];

const mockSermons = [
  {
    id: "1",
    title: "Walking in Faith",
    speaker: "Pastor James",
    date: "Mar 23, 2026",
    duration: "45 min",
    series: "Faith Series",
  },
  {
    id: "2",
    title: "The Power of Prayer",
    speaker: "Minister Grace",
    date: "Mar 16, 2026",
    duration: "38 min",
  },
  {
    id: "3",
    title: "Grace Abounding",
    speaker: "Pastor James",
    date: "Mar 9, 2026",
    duration: "42 min",
    series: "Grace Series",
  },
];

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

  const handlePrayerSubmit = async (data: {
    title: string;
    description: string;
    isAnonymous: boolean;
  }) => {
    // TODO: Call SpiritualService.submitPrayerRequest(data)
    console.log("Prayer request submitted:", data);
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
          {mockDevotionals.map((d) => (
            <DevotionalCard
              key={d.id}
              title={d.title}
              scripture={d.scripture}
              excerpt={d.excerpt}
              date={d.date}
              author={d.author}
            />
          ))}
        </Box>
      )}

      {/* Sermons */}
      {tab === 1 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {mockSermons.map((s) => (
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

function AiPrayerChat() {
  const [messages, setMessages] = useState<PrayerChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Peace be with you. I'm here to pray with you and share Scripture that speaks to your heart. What would you like to talk about today?",
      scriptures: [
        {
          reference: "Matthew 11:28",
          text: "Come to me, all you who are weary and burdened, and I will give you rest.",
        },
      ],
      timestamp: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: PrayerChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);

    try {
      // TODO: Replace with AiService.prayerChat(text, conversationId)
      await new Promise((r) => setTimeout(r, 1000));

      const lower = text.toLowerCase();
      let response = {
        content:
          "Thank you for sharing that with me. God hears every prayer and is always near. Let us be still in His presence together.",
        scriptures: [
          {
            reference: "Psalm 46:10",
            text: "Be still, and know that I am God.",
          },
        ],
      };

      if (lower.includes("anxious") || lower.includes("worry") || lower.includes("afraid")) {
        response = {
          content:
            "God cares deeply about what troubles you. His Word invites us to bring every worry to Him in prayer. When we do, He promises a peace that goes beyond understanding.",
          scriptures: [
            {
              reference: "Philippians 4:6-7",
              text: "Do not be anxious about anything, but in every situation, by prayer and petition, with thanksgiving, present your requests to God.",
            },
          ],
        };
      } else if (lower.includes("strength") || lower.includes("tired") || lower.includes("weak")) {
        response = {
          content:
            "When we feel depleted, God reminds us that our strength is renewed in Him. Rest in His presence and trust that He will lift you up.",
          scriptures: [
            {
              reference: "Isaiah 40:31",
              text: "But those who hope in the Lord will renew their strength. They will soar on wings like eagles.",
            },
          ],
        };
      } else if (lower.includes("sad") || lower.includes("grief") || lower.includes("loss")) {
        response = {
          content:
            "In your moments of sadness, know that God draws especially near. He is not distant in your pain - He is right beside you, holding you close.",
          scriptures: [
            {
              reference: "Psalm 34:18",
              text: "The Lord is close to the brokenhearted and saves those who are crushed in spirit.",
            },
          ],
        };
      } else if (lower.includes("forgive") || lower.includes("guilt") || lower.includes("shame")) {
        response = {
          content:
            "God's forgiveness is complete and available right now. Let go of the weight and receive His grace. You are not defined by your past.",
          scriptures: [
            {
              reference: "1 John 1:9",
              text: "If we confess our sins, he is faithful and just and will forgive us our sins and purify us from all unrighteousness.",
            },
          ],
        };
      } else if (lower.includes("thank") || lower.includes("grateful") || lower.includes("praise")) {
        response = {
          content:
            "What a beautiful heart of gratitude! Giving thanks opens our eyes to see even more of God's goodness. His love truly endures forever.",
          scriptures: [
            {
              reference: "Psalm 107:1",
              text: "Give thanks to the Lord, for he is good; his love endures forever.",
            },
          ],
        };
      } else if (lower.includes("heal") || lower.includes("sick") || lower.includes("pain")) {
        response = {
          content:
            "God is the Great Healer, and He hears your prayer. Whether physical, emotional, or spiritual, He has the power to restore. Hold onto faith.",
          scriptures: [
            {
              reference: "Jeremiah 17:14",
              text: "Heal me, Lord, and I will be healed; save me and I will be saved, for you are the one I praise.",
            },
          ],
        };
      } else if (lower.includes("peace") || lower.includes("calm") || lower.includes("rest")) {
        response = {
          content:
            "Jesus offers a peace the world cannot manufacture. Receive His peace right now. You are held securely in His hands.",
          scriptures: [
            {
              reference: "John 14:27",
              text: "Peace I leave with you; my peace I give you. Do not let your hearts be troubled and do not be afraid.",
            },
          ],
        };
      }

      const assistantMsg: PrayerChatMessage = {
        id: `asst-${Date.now()}`,
        role: "assistant",
        content: response.content,
        scriptures: response.scriptures,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } finally {
      setSending(false);
    }
  }, [input, sending]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 300px)",
        minHeight: 360,
      }}
    >
      {/* Messages */}
      <Paper
        variant="outlined"
        sx={{
          flex: 1,
          overflow: "auto",
          p: 2,
          display: "flex",
          flexDirection: "column",
          gap: 1.5,
          bgcolor: "#faf9f7",
          borderRadius: 3,
        }}
      >
        {messages.map((msg) => (
          <Box
            key={msg.id}
            sx={{
              display: "flex",
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <Box
              sx={{
                maxWidth: "80%",
                bgcolor:
                  msg.role === "user" ? "primary.main" : "background.paper",
                color:
                  msg.role === "user" ? "primary.contrastText" : "text.primary",
                borderRadius: msg.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                px: 2,
                py: 1.5,
                boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
              }}
            >
              <Typography
                variant="body2"
                sx={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}
              >
                {msg.content}
              </Typography>

              {msg.scriptures && msg.scriptures.length > 0 && (
                <Box sx={{ mt: 1.5 }}>
                  {msg.scriptures.map((s, i) => (
                    <Box
                      key={i}
                      sx={{
                        mt: 0.5,
                        p: 1.5,
                        bgcolor:
                          msg.role === "user"
                            ? "rgba(255,255,255,0.15)"
                            : "rgba(103,58,183,0.06)",
                        borderRadius: 2,
                        // The tinted panel and the accented reference already
                        // set the quotation apart.
                        border: "1px solid",
                        borderColor:
                          msg.role === "user"
                            ? "rgba(255,255,255,0.25)"
                            : "rgba(103,58,183,0.18)",
                      }}
                    >
                      <Typography
                        variant="caption"
                        color={
                          msg.role === "user" ? "inherit" : "primary.main"
                        }
                        sx={{ fontWeight: 700 }}
                      >
                        {s.reference}
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{
                          fontStyle: "italic",
                          fontSize: "0.8125rem",
                          mt: 0.25,
                          opacity: 0.9,
                        }}
                      >
                        {s.text}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              )}

              <Typography
                variant="caption"
                sx={{
                  display: "block",
                  mt: 0.75,
                  opacity: 0.6,
                  fontSize: "0.6875rem",
                  textAlign: msg.role === "user" ? "right" : "left",
                }}
              >
                {new Date(msg.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Typography>
            </Box>
          </Box>
        ))}

        {sending && (
          <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
            <Box
              sx={{
                bgcolor: "background.paper",
                borderRadius: "18px 18px 18px 4px",
                px: 2,
                py: 1.5,
                boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                display: "flex",
                alignItems: "center",
                gap: 1,
              }}
            >
              <CircularProgress size={14} />
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.8125rem" }}>
                Reflecting on Scripture...
              </Typography>
            </Box>
          </Box>
        )}

        <div ref={messagesEndRef} />
      </Paper>

      {/* Input */}
      <Box
        sx={{
          display: "flex",
          gap: 1,
          mt: 1.5,
          alignItems: "flex-end",
        }}
      >
        <TextField
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Share what's on your heart..."
          multiline
          maxRows={3}
          fullWidth
          size="small"
          disabled={sending}
          sx={{
            "& .MuiOutlinedInput-root": {
              borderRadius: 3,
            },
          }}
        />
        <IconButton
          color="primary"
          onClick={handleSend}
          disabled={!input.trim() || sending}
          sx={{
            bgcolor: "primary.main",
            color: "white",
            width: 40,
            height: 40,
            "&:hover": { bgcolor: "primary.dark" },
            "&.Mui-disabled": { bgcolor: "grey.300", color: "grey.500" },
          }}
        >
          <SendIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
}
