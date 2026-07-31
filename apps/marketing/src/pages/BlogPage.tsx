import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Button,
  Grid,
  Card,
  CardContent,
  Chip,
} from "@mui/material";
import SEO from "@/components/ui/SEO";
import AccessTimeIcon from "@mui/icons-material/AccessTime";

const posts = [
  {
    title: "How Digital Giving Increased Tithes by 40%",
    excerpt:
      "Discover how churches that adopted mobile money and online giving saw a dramatic increase in consistent tithing from their congregations.",
    category: "Finance",
    date: "Mar 28, 2026",
    readTime: "5 min read",
    color: "#FFB300",
  },
  {
    title: "5 Ways AI Can Help Your Church Grow",
    excerpt:
      "From sermon preparation to member engagement predictions, AI is transforming how churches operate and connect with their congregations.",
    category: "Technology",
    date: "Mar 15, 2026",
    readTime: "7 min read",
    color: "#7C4DFF",
  },
  {
    title: "The Future of Church Management in Africa",
    excerpt:
      "A look at the trends shaping digital church operations across the continent, and why now is the time to invest in modern tools.",
    category: "Insights",
    date: "Feb 28, 2026",
    readTime: "6 min read",
    color: "#3F51B5",
  },
  {
    title: "Building Community Through Mobile Apps",
    excerpt:
      "How a church mobile app can strengthen connections between members, foster small groups, and keep everyone informed and engaged.",
    category: "Community",
    date: "Feb 12, 2026",
    readTime: "4 min read",
    color: "#4CAF50",
  },
  {
    title: "QR Code Attendance: A Game Changer",
    excerpt:
      "Learn how QR code check-in is replacing paper sign-in sheets and giving churches real-time attendance data they can act on.",
    category: "Features",
    date: "Jan 30, 2026",
    readTime: "3 min read",
    color: "#FF6B6B",
  },
  {
    title: "Why Every Church Needs a CRM",
    excerpt:
      "Member management goes beyond a contact list. Explore how a purpose-built church CRM helps you care for every individual in your congregation.",
    category: "Best Practices",
    date: "Jan 15, 2026",
    readTime: "6 min read",
    color: "#9C27B0",
  },
];

export default function BlogPage() {
  return (
    <>
      <SEO
        title="Blog"
        description="Insights, tips, and stories on church management, digital giving, AI tools, and growing your ministry — from the ALTAR OS team."
      />

      {/* Hero */}
      <Box
        sx={{
          pt: { xs: 16, md: 20 },
          pb: { xs: 8, md: 12 },
          background:
            "linear-gradient(135deg, #1A1A2E 0%, #3F51B5 40%, #7C4DFF 100%)",
          textAlign: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse at 30% 50%, rgba(124,77,255,0.3) 0%, transparent 60%)",
            pointerEvents: "none",
          }}
        />
        <Container maxWidth="md" sx={{ position: "relative", zIndex: 1 }}>
          <Typography
            variant="overline"
            sx={{
              color: "#FFB300",
              fontWeight: 700,
              letterSpacing: "0.15em",
              mb: 1,
              display: "block",
            }}
          >
            Blog
          </Typography>
          <Typography variant="h1" sx={{ color: "#fff", mb: 3 }}>
            ALTAR OS Blog
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{
              color: "rgba(255,255,255,0.85)",
              maxWidth: 600,
              mx: "auto",
            }}
          >
            Insights for modern church leadership — strategies, features, and
            stories to help your ministry thrive.
          </Typography>
        </Container>
      </Box>

      {/* Blog Grid */}
      <Box sx={{ py: { xs: 8, md: 12 }, backgroundColor: "#FFFFFF" }}>
        <Container maxWidth="lg">
          <Grid container spacing={4}>
            {posts.map((post) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={post.title}>
                <Card
                  sx={{
                    height: "100%",
                    border: "1px solid rgba(0,0,0,0.06)",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  {/* Image placeholder */}
                  <Box
                    sx={{
                      height: 180,
                      background: `linear-gradient(135deg, ${post.color}22 0%, ${post.color}44 100%)`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Typography
                      variant="body2"
                      sx={{
                        color: post.color,
                        fontWeight: 600,
                        opacity: 0.6,
                      }}
                    >
                      Featured Image
                    </Typography>
                  </Box>
                  <CardContent
                    sx={{
                      p: 3,
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <Chip
                      label={post.category}
                      size="small"
                      sx={{
                        alignSelf: "flex-start",
                        mb: 2,
                        backgroundColor: `${post.color}18`,
                        color: post.color,
                        fontWeight: 600,
                        fontSize: "0.75rem",
                      }}
                    />
                    <Typography
                      variant="h5"
                      sx={{ mb: 1.5, fontWeight: 700, lineHeight: 1.3 }}
                    >
                      {post.title}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        color: "text.secondary",
                        lineHeight: 1.7,
                        mb: 2,
                        flex: 1,
                      }}
                    >
                      {post.excerpt}
                    </Typography>
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        mt: "auto",
                      }}
                    >
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 0.5,
                          color: "text.secondary",
                        }}
                      >
                        <Typography variant="caption">{post.date}</Typography>
                        <Typography variant="caption" sx={{ mx: 0.5 }}>
                          &middot;
                        </Typography>
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 0.5,
                          }}
                        >
                          <AccessTimeIcon sx={{ fontSize: 14 }} />
                          <Typography variant="caption">
                            {post.readTime}
                          </Typography>
                        </Box>
                      </Box>
                      <Typography
                        variant="body2"
                        sx={{
                          color: "primary.main",
                          fontWeight: 600,
                          cursor: "pointer",
                          "&:hover": { textDecoration: "underline" },
                        }}
                      >
                        Read More
                      </Typography>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>

      {/* CTA */}
      <Box
        sx={{
          py: { xs: 10, md: 14 },
          background:
            "linear-gradient(135deg, #1A1A2E 0%, #3F51B5 40%, #7C4DFF 100%)",
          textAlign: "center",
        }}
      >
        <Container maxWidth="md">
          <Typography
            variant="h2"
            sx={{ color: "#fff", mb: 2, fontWeight: 800 }}
          >
            Ready to Transform Your Church?
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{ color: "rgba(255,255,255,0.8)", mb: 5 }}
          >
            Start your free trial today and see why churches love ALTAR OS.
          </Typography>
          <Button
            component={RouterLink}
            to="/register"
            variant="contained"
            color="secondary"
            size="large"
            sx={{
              px: 6,
              py: 2,
              fontSize: "1.15rem",
              color: "#1A1A2E",
              boxShadow: "0 4px 24px rgba(255,179,0,0.4)",
              "&:hover": {
                boxShadow: "0 6px 32px rgba(255,179,0,0.5)",
                transform: "translateY(-2px)",
              },
              transition: "all 0.3s ease",
            }}
          >
            Start Free Trial
          </Button>
        </Container>
      </Box>
    </>
  );
}
