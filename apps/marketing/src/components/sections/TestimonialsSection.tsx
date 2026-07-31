import { Box, Container, Typography, Card, CardContent, Grid, Avatar } from "@mui/material";
import FormatQuoteIcon from "@mui/icons-material/FormatQuote";

const testimonials = [
  {
    quote:
      "ALTAR OS transformed how we manage our congregation. The giving system alone increased our tithes by 40%.",
    name: "Pastor Kwame Asante",
    title: "Senior Pastor",
    church: "Grace Chapel, Accra",
    initials: "KA",
    color: "#3F51B5",
  },
  {
    quote:
      "Finally a church management platform built for African churches. The mobile money integration is a game changer.",
    name: "Rev. Abena Mensah",
    title: "Lead Pastor",
    church: "New Life Assembly, Kumasi",
    initials: "AM",
    color: "#FFB300",
  },
  {
    quote:
      "Our members love the app. Attendance tracking and communication have never been easier.",
    name: "Bishop Samuel Osei",
    title: "General Overseer",
    church: "Kingdom Life Church, Takoradi",
    initials: "SO",
    color: "#4CAF50",
  },
];

export default function TestimonialsSection() {
  return (
    <Box
      id="testimonials"
      sx={{
        py: { xs: 10, md: 14 },
        position: "relative",
        overflow: "hidden",
        backgroundColor: "#F8F9FF",
      }}
    >
      {/* Subtle African textile-inspired background pattern */}
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          opacity: 0.03,
          backgroundImage: `
            repeating-linear-gradient(
              45deg,
              #3F51B5 0px,
              #3F51B5 2px,
              transparent 2px,
              transparent 20px
            ),
            repeating-linear-gradient(
              -45deg,
              #FFB300 0px,
              #FFB300 2px,
              transparent 2px,
              transparent 20px
            )
          `,
          pointerEvents: "none",
        }}
      />

      <Container maxWidth="lg" sx={{ position: "relative", zIndex: 1 }}>
        {/* Section Header */}
        <Box sx={{ textAlign: "center", mb: { xs: 6, md: 8 } }}>
          <Typography
            variant="overline"
            sx={{
              color: "secondary.main",
              fontWeight: 700,
              letterSpacing: "0.15em",
              mb: 1,
              display: "block",
            }}
          >
            Testimonials
          </Typography>
          <Typography variant="h2" sx={{ mb: 2 }}>
            Trusted by Churches Across Africa
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{
              color: "text.secondary",
              maxWidth: 550,
              mx: "auto",
            }}
          >
            See how churches are thriving with ALTAR OS.
          </Typography>
        </Box>

        {/* Testimonial Cards */}
        <Grid container spacing={4}>
          {testimonials.map((testimonial) => (
            <Grid size={{ xs: 12, md: 4 }} key={testimonial.name}>
              <Card
                sx={{
                  height: "100%",
                  border: "1px solid rgba(0,0,0,0.06)",
                  position: "relative",
                  overflow: "visible",
                }}
              >
                {/* Quote icon */}
                <Box
                  sx={{
                    position: "absolute",
                    top: -20,
                    left: 24,
                    width: 44,
                    height: 44,
                    borderRadius: "12px",
                    backgroundColor: testimonial.color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: `0 4px 12px ${testimonial.color}40`,
                  }}
                >
                  <FormatQuoteIcon sx={{ color: "#fff", fontSize: 24 }} />
                </Box>

                <CardContent sx={{ p: 4, pt: 5 }}>
                  <Typography
                    variant="body1"
                    sx={{
                      fontStyle: "italic",
                      color: "text.secondary",
                      lineHeight: 1.8,
                      mb: 3,
                      minHeight: { md: 120 },
                    }}
                  >
                    &ldquo;{testimonial.quote}&rdquo;
                  </Typography>

                  <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <Avatar
                      sx={{
                        width: 48,
                        height: 48,
                        backgroundColor: testimonial.color,
                        fontWeight: 700,
                        fontSize: "1rem",
                      }}
                    >
                      {testimonial.initials}
                    </Avatar>
                    <Box>
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: 700, color: "text.primary" }}
                      >
                        {testimonial.name}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{ color: "text.secondary", display: "block" }}
                      >
                        {testimonial.title}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{ color: testimonial.color, fontWeight: 600 }}
                      >
                        {testimonial.church}
                      </Typography>
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Container>
    </Box>
  );
}
