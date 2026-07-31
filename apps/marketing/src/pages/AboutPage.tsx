import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Button,
  Grid,
  Card,
  CardContent,
  Avatar,
} from "@mui/material";
import SEO from "@/components/ui/SEO";
import ChurchIcon from "@mui/icons-material/Church";
import GroupsIcon from "@mui/icons-material/Groups";
import PublicIcon from "@mui/icons-material/Public";
import VisibilityIcon from "@mui/icons-material/Visibility";

const team = [
  {
    name: "Stanley Hayford",
    role: "Founder & CEO",
    bio: "Software engineer passionate about using technology to serve the African church.",
    initials: "SH",
  },
  {
    name: "Ama Mensah",
    role: "Head of Product",
    bio: "Product leader with 8+ years of experience building tools for faith communities.",
    initials: "AM",
  },
  {
    name: "Kofi Boateng",
    role: "Lead Engineer",
    bio: "Full-stack developer specializing in scalable platforms for emerging markets.",
    initials: "KB",
  },
  {
    name: "Efua Owusu",
    role: "Head of Design",
    bio: "UX designer dedicated to creating intuitive digital experiences for diverse users.",
    initials: "EO",
  },
];

const values = [
  {
    icon: <ChurchIcon sx={{ fontSize: 32 }} />,
    title: "Faith-Driven",
    description:
      "We build with purpose, guided by a deep respect for the mission of the church and the communities it serves.",
    color: "#3F51B5",
    bgColor: "rgba(63,81,181,0.1)",
  },
  {
    icon: <GroupsIcon sx={{ fontSize: 32 }} />,
    title: "Community-First",
    description:
      "Every feature we design puts people at the center — because technology should bring congregations closer, not apart.",
    color: "#4CAF50",
    bgColor: "rgba(76,175,80,0.1)",
  },
  {
    icon: <PublicIcon sx={{ fontSize: 32 }} />,
    title: "African-Built",
    description:
      "We are proudly African, solving African challenges with homegrown innovation and deep local understanding.",
    color: "#FFB300",
    bgColor: "rgba(255,179,0,0.1)",
  },
  {
    icon: <VisibilityIcon sx={{ fontSize: 32 }} />,
    title: "Transparent",
    description:
      "Open pricing, honest communication, and clear data practices — because trust is the foundation of everything we do.",
    color: "#FF6B6B",
    bgColor: "rgba(255,107,107,0.1)",
  },
];

export default function AboutPage() {
  return (
    <>
      <SEO
        title="About"
        description="Learn about ALTAR OS — our mission to empower every African church with world-class digital infrastructure."
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
            About Us
          </Typography>
          <Typography variant="h1" sx={{ color: "#fff", mb: 3 }}>
            Our Mission
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{
              color: "rgba(255,255,255,0.85)",
              maxWidth: 650,
              mx: "auto",
              fontSize: { xs: "1.1rem", md: "1.35rem" },
            }}
          >
            To empower every African church with world-class digital
            infrastructure.
          </Typography>
        </Container>
      </Box>

      {/* Story */}
      <Box sx={{ py: { xs: 8, md: 12 }, backgroundColor: "#FFFFFF" }}>
        <Container maxWidth="md">
          <Typography variant="h3" sx={{ mb: 3, textAlign: "center" }}>
            Our Story
          </Typography>
          <Typography
            variant="body1"
            sx={{
              color: "text.secondary",
              lineHeight: 1.9,
              fontSize: "1.1rem",
              mb: 3,
            }}
          >
            ALTAR OS was founded to solve a growing digital gap in African
            churches. While churches in other parts of the world have access to
            sophisticated management tools, many congregations across Africa
            still rely on spreadsheets, paper records, and manual processes to
            manage their operations.
          </Typography>
          <Typography
            variant="body1"
            sx={{
              color: "text.secondary",
              lineHeight: 1.9,
              fontSize: "1.1rem",
              mb: 3,
            }}
          >
            We believe that every church — regardless of size or location —
            deserves access to powerful, modern tools that simplify
            administration, enhance communication, and foster spiritual growth.
            ALTAR OS was built from the ground up with the unique needs of
            African churches in mind: mobile money integration, SMS-first
            communication, multilingual support, and affordable pricing.
          </Typography>
          <Typography
            variant="body1"
            sx={{
              color: "text.secondary",
              lineHeight: 1.9,
              fontSize: "1.1rem",
            }}
          >
            Today, ALTAR OS serves churches across Ghana and West Africa,
            helping pastors focus on what matters most — shepherding their
            congregations and growing the Kingdom of God.
          </Typography>
        </Container>
      </Box>

      {/* Team */}
      <Box sx={{ py: { xs: 8, md: 12 }, backgroundColor: "#F8F9FC" }}>
        <Container maxWidth="lg">
          <Box sx={{ textAlign: "center", mb: { xs: 6, md: 8 } }}>
            <Typography variant="h2" sx={{ mb: 2 }}>
              Meet the Team
            </Typography>
            <Typography
              variant="subtitle1"
              sx={{ color: "text.secondary", maxWidth: 500, mx: "auto" }}
            >
              A passionate team of builders, designers, and ministry advocates.
            </Typography>
          </Box>

          <Grid container spacing={4} justifyContent="center">
            {team.map((member) => (
              <Grid size={{ xs: 12, sm: 6, md: 3 }} key={member.name}>
                <Card
                  sx={{
                    height: "100%",
                    textAlign: "center",
                    border: "1px solid rgba(0,0,0,0.06)",
                    p: 1,
                  }}
                >
                  <CardContent sx={{ p: 3 }}>
                    <Avatar
                      sx={{
                        width: 80,
                        height: 80,
                        mx: "auto",
                        mb: 2,
                        backgroundColor: "primary.main",
                        fontSize: "1.5rem",
                        fontWeight: 700,
                      }}
                    >
                      {member.initials}
                    </Avatar>
                    <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
                      {member.name}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        color: "secondary.main",
                        fontWeight: 600,
                        mb: 1.5,
                      }}
                    >
                      {member.role}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{ color: "text.secondary", lineHeight: 1.6 }}
                    >
                      {member.bio}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>

      {/* Values */}
      <Box sx={{ py: { xs: 8, md: 12 }, backgroundColor: "#FFFFFF" }}>
        <Container maxWidth="lg">
          <Box sx={{ textAlign: "center", mb: { xs: 6, md: 8 } }}>
            <Typography variant="h2" sx={{ mb: 2 }}>
              Our Values
            </Typography>
            <Typography
              variant="subtitle1"
              sx={{ color: "text.secondary", maxWidth: 500, mx: "auto" }}
            >
              The principles that guide everything we build.
            </Typography>
          </Box>

          <Grid container spacing={4}>
            {values.map((value) => (
              <Grid size={{ xs: 12, sm: 6, md: 3 }} key={value.title}>
                <Box sx={{ textAlign: "center" }}>
                  <Box
                    sx={{
                      width: 64,
                      height: 64,
                      borderRadius: "16px",
                      backgroundColor: value.bgColor,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: value.color,
                      mx: "auto",
                      mb: 2,
                    }}
                  >
                    {value.icon}
                  </Box>
                  <Typography variant="h5" sx={{ mb: 1, fontWeight: 700 }}>
                    {value.title}
                  </Typography>
                  <Typography
                    variant="body1"
                    sx={{ color: "text.secondary", lineHeight: 1.7 }}
                  >
                    {value.description}
                  </Typography>
                </Box>
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
            Join Our Mission
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{ color: "rgba(255,255,255,0.8)", mb: 5 }}
          >
            Help us empower African churches with the tools they deserve.
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
            Get Started Free
          </Button>
        </Container>
      </Box>
    </>
  );
}
