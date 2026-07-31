import { useState, useRef, useEffect, useCallback } from "react";
import {
  Box,
  Typography,
  Tabs,
  Tab,
  Card,
  CardContent,
  TextField,
  Button,
  MenuItem,
  Chip,
  IconButton,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  CircularProgress,
  Alert,
  Paper,
  Divider,
  FormControl,
  InputLabel,
  Select,
  type SelectChangeEvent,
} from "@mui/material";
import {
  AutoAwesome as GenerateIcon,
  ExpandMore as ExpandMoreIcon,
  Send as SendIcon,
  Close as DismissIcon,
  FilterList as FilterIcon,
  MenuBook as ScriptureIcon,
  Psychology as AiIcon,
} from "@mui/icons-material";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import type {
  SermonOutline,
  MemberInsight,
  PrayerChatMessage,
} from "@altar-os/shared-types";

/* ------------------------------------------------------------------ */
/*  Zod schema for sermon form                                         */
/* ------------------------------------------------------------------ */

const sermonFormSchema = z.object({
  topic: z.string().min(1, "Topic is required"),
  style: z.enum(["expository", "topical", "narrative", "textual"]).optional(),
  duration: z.enum(["15min", "30min", "45min", "1hr"]).optional(),
  targetAudience: z.string().optional(),
});

type SermonFormValues = z.infer<typeof sermonFormSchema>;

/* ------------------------------------------------------------------ */
/*  Severity color map                                                 */
/* ------------------------------------------------------------------ */

const severityColor: Record<string, "error" | "warning" | "success"> = {
  high: "error",
  medium: "warning",
  low: "success",
};

const insightTypeLabel: Record<string, string> = {
  inactive_warning: "Inactive",
  engagement_drop: "Engagement Drop",
  milestone: "Milestone",
  follow_up: "Follow-up Needed",
};

/* ------------------------------------------------------------------ */
/*  Mock data (used until API is connected)                            */
/* ------------------------------------------------------------------ */

const MOCK_INSIGHTS: MemberInsight[] = [
  {
    id: "ins-1",
    memberId: "member-001",
    memberName: "John Mensah",
    type: "inactive_warning",
    severity: "high",
    message:
      "John has not attended any services in the past 4 weeks. His last recorded attendance was on March 14, 2026.",
    suggestedAction:
      "Assign a care team member to reach out with a personal phone call. Consider a home visit if no response within a week.",
    data: { lastAttendance: "2026-03-14", weeksAbsent: 4 },
    createdAt: new Date().toISOString(),
    isRead: false,
  },
  {
    id: "ins-2",
    memberId: "member-002",
    memberName: "Youth Department",
    type: "engagement_drop",
    severity: "medium",
    message:
      "Giving from the Youth department has dropped 30% compared to the previous quarter.",
    suggestedAction:
      "Schedule a meeting with youth leadership to discuss fundraising initiatives and engagement strategies.",
    data: { previousAmount: 2400, currentAmount: 1680, percentDrop: 30 },
    createdAt: new Date().toISOString(),
    isRead: false,
  },
  {
    id: "ins-3",
    memberId: "member-003",
    memberName: "Mary Owusu",
    type: "milestone",
    severity: "low",
    message:
      "Mary will reach her 1-year membership anniversary on April 20, 2026.",
    suggestedAction:
      "Prepare a membership anniversary recognition during Sunday service.",
    data: { joinDate: "2025-04-20", attendanceRate: 92 },
    createdAt: new Date().toISOString(),
    isRead: false,
  },
  {
    id: "ins-4",
    memberId: "member-004",
    memberName: "Kwame Asante",
    type: "follow_up",
    severity: "medium",
    message:
      "Kwame submitted a prayer request about family challenges 2 weeks ago but has not been followed up with.",
    suggestedAction:
      "Assign a pastoral care team member to schedule a one-on-one meeting within 48 hours.",
    data: { prayerRequestDate: "2026-03-28", daysSinceRequest: 14 },
    createdAt: new Date().toISOString(),
    isRead: false,
  },
  {
    id: "ins-5",
    memberId: "member-005",
    memberName: "Ama Darko",
    type: "engagement_drop",
    severity: "high",
    message:
      "Ama's attendance has dropped from weekly to bi-monthly over the past 3 months.",
    suggestedAction:
      "Have the Ushering department head reach out personally.",
    data: { department: "Ushering", monthsOfDecline: 3 },
    createdAt: new Date().toISOString(),
    isRead: false,
  },
];

const MOCK_SERMON: SermonOutline = {
  id: "sermon-mock-1",
  topic: "Faith",
  title: "Unwavering Faith in Uncertain Times",
  scripture: "Hebrews 11:1-6",
  introduction:
    "Today we gather to explore the profound biblical theme of faith. In a world that often feels uncertain, God's Word provides clarity, comfort, and direction. As we open the Scriptures together, let us approach with hearts ready to receive and be transformed.",
  points: [
    {
      title: "Understanding Faith in Scripture",
      content:
        "The Bible provides a rich foundation for understanding faith. Throughout both the Old and New Testaments, we see God's heart revealed on this subject. As we examine the original context and meaning, we discover timeless principles that speak directly to our lives today.",
      scripture: "Hebrews 11:1-6",
    },
    {
      title: "Faith in the Life of Jesus",
      content:
        "Jesus perfectly modeled faith throughout His earthly ministry. From His interactions with the marginalized to His teachings to the disciples, we see a living example of what it means to embody this truth.",
      scripture: "John 13:34-35",
    },
    {
      title: "Living Out Faith Today",
      content:
        "Applying these biblical truths to our modern context requires intentionality and dependence on the Holy Spirit. We are called not merely to know the truth but to be transformed by it.",
      scripture: "James 1:22-25",
    },
  ],
  conclusion:
    "As we close, let us carry these truths with us beyond these walls. Faith is not merely a concept to be studied but a reality to be lived.",
  applicationPoints: [
    "Spend 10 minutes each day this week meditating on Hebrews 11:1-6",
    "Share what you've learned about faith with someone in your small group",
    "Identify one area in your life where faith needs to grow",
    "Look for an opportunity this week to put faith into practice",
  ],
  createdAt: new Date().toISOString(),
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function AiPage() {
  const [tab, setTab] = useState(0);

  return (
    <Box sx={{ py: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2 }}>
        <AiIcon sx={{ color: "primary.main", fontSize: 32 }} />
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          AI Assistant
        </Typography>
      </Box>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 3 }}
      >
        <Tab label="Sermon Assistant" />
        <Tab label="Member Insights" />
        <Tab label="Prayer Assistant" />
      </Tabs>

      {tab === 0 && <SermonTab />}
      {tab === 1 && <InsightsTab />}
      {tab === 2 && <PrayerTab />}
    </Box>
  );
}

/* ================================================================== */
/*  SERMON TAB                                                         */
/* ================================================================== */

function SermonTab() {
  const [sermon, setSermon] = useState<SermonOutline | null>(null);
  const [loading, setLoading] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<SermonFormValues>({
    resolver: zodResolver(sermonFormSchema),
    defaultValues: {
      topic: "",
      style: "expository",
      duration: "30min",
      targetAudience: "",
    },
  });

  const onSubmit = useCallback(async (values: SermonFormValues) => {
    setLoading(true);
    try {
      // TODO: Replace with AiService.generateSermon(values)
      await new Promise((r) => setTimeout(r, 1500));
      setSermon({ ...MOCK_SERMON, topic: values.topic });
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {/* Input Form */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
            Generate Sermon Outline
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Enter a topic and preferences to generate a structured sermon
            outline powered by AI.
          </Typography>

          <Box
            component="form"
            onSubmit={handleSubmit(onSubmit)}
            sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}
          >
            <Controller
              name="topic"
              control={control}
              rules={{ required: "Topic is required" }}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Sermon Topic"
                  placeholder="e.g. Faith, Love, Forgiveness, Hope"
                  fullWidth
                  error={!!errors.topic}
                  helperText={errors.topic?.message}
                />
              )}
            />

            <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
              <Controller
                name="style"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    select
                    label="Preaching Style"
                    sx={{ minWidth: 180 }}
                  >
                    <MenuItem value="expository">Expository</MenuItem>
                    <MenuItem value="topical">Topical</MenuItem>
                    <MenuItem value="narrative">Narrative</MenuItem>
                    <MenuItem value="textual">Textual</MenuItem>
                  </TextField>
                )}
              />

              <Controller
                name="duration"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    select
                    label="Duration"
                    sx={{ minWidth: 140 }}
                  >
                    <MenuItem value="15min">15 minutes</MenuItem>
                    <MenuItem value="30min">30 minutes</MenuItem>
                    <MenuItem value="45min">45 minutes</MenuItem>
                    <MenuItem value="1hr">1 hour</MenuItem>
                  </TextField>
                )}
              />

              <Controller
                name="targetAudience"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Target Audience (optional)"
                    placeholder="e.g. Youth, New Believers"
                    sx={{ flex: 1, minWidth: 200 }}
                  />
                )}
              />
            </Box>

            <Button
              type="submit"
              variant="contained"
              size="large"
              startIcon={
                loading ? (
                  <CircularProgress size={20} color="inherit" />
                ) : (
                  <GenerateIcon />
                )
              }
              disabled={loading}
              sx={{ alignSelf: "flex-start" }}
            >
              {loading ? "Generating..." : "Generate Outline"}
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Generated Sermon Display */}
      {sermon && (
        <Card sx={{ border: "1px solid", borderColor: "primary.light" }}>
          <CardContent>
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                mb: 2,
              }}
            >
              <Box>
                <Typography variant="h5" sx={{ fontWeight: 700 }}>
                  {sermon.title}
                </Typography>
                <Chip
                  icon={<ScriptureIcon />}
                  label={sermon.scripture}
                  color="primary"
                  variant="outlined"
                  size="small"
                  sx={{ mt: 1 }}
                />
              </Box>
              <Chip label={sermon.topic} color="primary" size="small" />
            </Box>

            <Divider sx={{ my: 2 }} />

            {/* Introduction */}
            <Typography
              variant="subtitle1"
              color="primary"
              gutterBottom
              sx={{ fontWeight: 600 }}
            >
              Introduction
            </Typography>
            <Typography variant="body2" sx={{ mb: 3 }}>
              {sermon.introduction}
            </Typography>

            {/* Main Points */}
            <Typography
              variant="subtitle1"
              color="primary"
              gutterBottom
              sx={{ fontWeight: 600 }}
            >
              Main Points
            </Typography>
            {sermon.points.map((point, idx) => (
              <Accordion key={idx} defaultExpanded={idx === 0}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Chip
                      label={idx + 1}
                      size="small"
                      color="primary"
                      sx={{ fontWeight: 700, minWidth: 28 }}
                    />
                    <Typography sx={{ fontWeight: 600 }}>{point.title}</Typography>
                  </Box>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    {point.content}
                  </Typography>
                  <Chip
                    icon={<ScriptureIcon />}
                    label={point.scripture}
                    size="small"
                    variant="outlined"
                    color="secondary"
                  />
                </AccordionDetails>
              </Accordion>
            ))}

            <Divider sx={{ my: 2 }} />

            {/* Conclusion */}
            <Typography
              variant="subtitle1"
              color="primary"
              gutterBottom
              sx={{ fontWeight: 600 }}
            >
              Conclusion
            </Typography>
            <Typography variant="body2" sx={{ mb: 3 }}>
              {sermon.conclusion}
            </Typography>

            {/* Application Points */}
            <Typography
              variant="subtitle1"
              color="primary"
              gutterBottom
              sx={{ fontWeight: 600 }}
            >
              Application Points
            </Typography>
            <Box component="ul" sx={{ pl: 2, m: 0 }}>
              {sermon.applicationPoints.map((ap, idx) => (
                <Typography component="li" variant="body2" key={idx} sx={{ mb: 0.5 }}>
                  {ap}
                </Typography>
              ))}
            </Box>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}

/* ================================================================== */
/*  INSIGHTS TAB                                                       */
/* ================================================================== */

function InsightsTab() {
  const [insights, setInsights] = useState<MemberInsight[]>(MOCK_INSIGHTS);
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const handleDismiss = useCallback((id: string) => {
    // TODO: Replace with AiService.dismissInsight(id)
    setInsights((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const handleFilterChange = useCallback((e: SelectChangeEvent) => {
    setTypeFilter(e.target.value);
  }, []);

  const filtered =
    typeFilter === "all"
      ? insights
      : insights.filter((i) => i.type === typeFilter);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          Member Insights
        </Typography>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>
            <FilterIcon sx={{ fontSize: 16, mr: 0.5, verticalAlign: "text-bottom" }} />
            Filter by Type
          </InputLabel>
          <Select
            value={typeFilter}
            onChange={handleFilterChange}
            label="Filter by Type..."
          >
            <MenuItem value="all">All Types</MenuItem>
            <MenuItem value="inactive_warning">Inactive Warning</MenuItem>
            <MenuItem value="engagement_drop">Engagement Drop</MenuItem>
            <MenuItem value="milestone">Milestone</MenuItem>
            <MenuItem value="follow_up">Follow-up Needed</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {filtered.length === 0 && (
        <Alert severity="info">
          No insights to display. All members are well engaged!
        </Alert>
      )}

      {filtered.map((insight) => (
        <Card
          key={insight.id}
          sx={{
            border: "1px solid",
            borderColor:
              insight.severity === "high"
                ? "error.light"
                : insight.severity === "medium"
                  ? "warning.light"
                  : "success.light",
            borderLeftWidth: 4,
          }}
        >
          <CardContent>
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
              }}
            >
              <Box sx={{ flex: 1 }}>
                <Box
                  sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    {insight.memberName}
                  </Typography>
                  <Chip
                    label={insightTypeLabel[insight.type] || insight.type}
                    size="small"
                    color={severityColor[insight.severity]}
                    variant="outlined"
                  />
                  <Chip
                    label={insight.severity.toUpperCase()}
                    size="small"
                    color={severityColor[insight.severity]}
                  />
                </Box>
                <Typography variant="body2" sx={{ mb: 1.5 }}>
                  {insight.message}
                </Typography>
                <Alert severity="info" variant="outlined" sx={{ py: 0.5 }}>
                  <Typography variant="body2">
                    <strong>Suggested Action:</strong> {insight.suggestedAction}
                  </Typography>
                </Alert>
              </Box>
              <IconButton
                size="small"
                onClick={() => handleDismiss(insight.id)}
                title="Dismiss insight"
                sx={{ ml: 1 }}
              >
                <DismissIcon fontSize="small" />
              </IconButton>
            </Box>
          </CardContent>
        </Card>
      ))}
    </Box>
  );
}

/* ================================================================== */
/*  PRAYER TAB                                                         */
/* ================================================================== */

function PrayerTab() {
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
      await new Promise((r) => setTimeout(r, 1200));

      // Simple keyword matching for mock
      const lower = text.toLowerCase();
      let response = {
        content:
          "Thank you for sharing that. God invites us to be still in His presence and trust that He is in control. Whatever you are facing, bring it to Him in prayer.",
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
            "I hear your concern, and I want you to know that God cares deeply about what troubles you. His Word invites us to bring every worry to Him in prayer. When we do, He promises a peace that goes beyond human understanding.",
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
            "When we feel depleted, God reminds us that our strength is renewed in Him. You don't have to carry everything alone. Rest in His presence and trust that He will lift you up.",
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
            "In your moments of deep sadness, please know that God draws especially near to you. He is not distant in your pain - He is right beside you.",
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
            "God's forgiveness is complete and available right now. When we come to Him honestly, He doesn't hold back. Let go of the weight of guilt and receive His grace.",
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
            "What a beautiful heart of gratitude! Giving thanks opens our eyes to see even more of God's goodness around us. His love truly endures forever.",
          scriptures: [
            {
              reference: "Psalm 107:1",
              text: "Give thanks to the Lord, for he is good; his love endures forever.",
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
        height: "calc(100vh - 280px)",
        minHeight: 400,
      }}
    >
      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
        Prayer Chat
      </Typography>

      {/* Messages area */}
      <Paper
        variant="outlined"
        sx={{
          flex: 1,
          overflow: "auto",
          p: 2,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          bgcolor: "grey.50",
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
                maxWidth: "75%",
                bgcolor: msg.role === "user" ? "primary.main" : "background.paper",
                color: msg.role === "user" ? "primary.contrastText" : "text.primary",
                borderRadius: 2,
                px: 2,
                py: 1.5,
                boxShadow: 1,
              }}
            >
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                {msg.content}
              </Typography>

              {msg.scriptures && msg.scriptures.length > 0 && (
                <Box sx={{ mt: 1.5 }}>
                  {msg.scriptures.map((s, i) => (
                    <Box
                      key={i}
                      sx={{
                        mt: 1,
                        p: 1.5,
                        bgcolor:
                          msg.role === "user"
                            ? "rgba(255,255,255,0.15)"
                            : "primary.50",
                        borderRadius: 1,
                        borderLeft: "3px solid",
                        borderColor:
                          msg.role === "user" ? "rgba(255,255,255,0.5)" : "primary.main",
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
                          mt: 0.5,
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
                  mt: 1,
                  opacity: 0.7,
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
                borderRadius: 2,
                px: 2,
                py: 1.5,
                boxShadow: 1,
                display: "flex",
                alignItems: "center",
                gap: 1,
              }}
            >
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">
                Praying and reflecting...
              </Typography>
            </Box>
          </Box>
        )}

        <div ref={messagesEndRef} />
      </Paper>

      {/* Input area */}
      <Box
        sx={{
          display: "flex",
          gap: 1,
          mt: 2,
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
        />
        <Button
          variant="contained"
          onClick={handleSend}
          disabled={!input.trim() || sending}
          sx={{ minWidth: 48, height: 40 }}
        >
          <SendIcon />
        </Button>
      </Box>
    </Box>
  );
}
