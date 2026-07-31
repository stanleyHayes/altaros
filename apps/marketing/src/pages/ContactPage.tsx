import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Button,
  Grid,
  TextField,
  Card,
  CardContent,
  IconButton,
} from "@mui/material";
import SEO from "@/components/ui/SEO";
import EmailIcon from "@mui/icons-material/Email";
import PhoneIcon from "@mui/icons-material/Phone";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import XIcon from "@mui/icons-material/X";
import FacebookIcon from "@mui/icons-material/Facebook";
import LinkedInIcon from "@mui/icons-material/LinkedIn";
import InstagramIcon from "@mui/icons-material/Instagram";

export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    churchName: "",
    message: "",
  });
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <>
      <SEO
        title="Contact"
        description="Get in touch with the ALTAR OS team. We'd love to hear from you — reach out for support, demos, partnerships, and more."
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
            Contact
          </Typography>
          <Typography variant="h1" sx={{ color: "#fff", mb: 3 }}>
            We'd Love to Hear From You
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{
              color: "rgba(255,255,255,0.85)",
              maxWidth: 600,
              mx: "auto",
            }}
          >
            Have a question, need a demo, or want to partner with us? Reach
            out and we will get back to you promptly.
          </Typography>
        </Container>
      </Box>

      {/* Contact Form + Info */}
      <Box sx={{ py: { xs: 8, md: 12 }, backgroundColor: "#FFFFFF" }}>
        <Container maxWidth="lg">
          <Grid container spacing={6}>
            {/* Form */}
            <Grid size={{ xs: 12, md: 7 }}>
              <Card sx={{ border: "1px solid rgba(0,0,0,0.06)", p: 1 }}>
                <CardContent sx={{ p: { xs: 3, md: 4 } }}>
                  {submitted ? (
                    <Box sx={{ textAlign: "center", py: 6 }}>
                      <Typography
                        variant="h4"
                        sx={{ mb: 2, fontWeight: 700, color: "primary.main" }}
                      >
                        Thank You!
                      </Typography>
                      <Typography
                        variant="body1"
                        sx={{ color: "text.secondary" }}
                      >
                        We have received your message and will get back to you
                        within 24 hours.
                      </Typography>
                    </Box>
                  ) : (
                    <Box component="form" onSubmit={handleSubmit}>
                      <Typography
                        variant="h5"
                        sx={{ mb: 3, fontWeight: 700 }}
                      >
                        Send Us a Message
                      </Typography>
                      <Grid container spacing={3}>
                        <Grid size={{ xs: 12, sm: 6 }}>
                          <TextField
                            fullWidth
                            label="Your Name"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            required
                          />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                          <TextField
                            fullWidth
                            label="Email Address"
                            name="email"
                            type="email"
                            value={formData.email}
                            onChange={handleChange}
                            required
                          />
                        </Grid>
                        <Grid size={{ xs: 12 }}>
                          <TextField
                            fullWidth
                            label="Church Name"
                            name="churchName"
                            value={formData.churchName}
                            onChange={handleChange}
                          />
                        </Grid>
                        <Grid size={{ xs: 12 }}>
                          <TextField
                            fullWidth
                            label="Message"
                            name="message"
                            value={formData.message}
                            onChange={handleChange}
                            required
                            multiline
                            rows={5}
                          />
                        </Grid>
                        <Grid size={{ xs: 12 }}>
                          <Button
                            type="submit"
                            variant="contained"
                            color="secondary"
                            size="large"
                            fullWidth
                            sx={{
                              py: 1.5,
                              color: "#1A1A2E",
                              fontWeight: 700,
                            }}
                          >
                            Send Message
                          </Button>
                        </Grid>
                      </Grid>
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Grid>

            {/* Contact Info */}
            <Grid size={{ xs: 12, md: 5 }}>
              <Box sx={{ mb: 4 }}>
                <Typography variant="h5" sx={{ mb: 3, fontWeight: 700 }}>
                  Contact Information
                </Typography>

                <Box
                  sx={{ display: "flex", gap: 2, mb: 3, alignItems: "center" }}
                >
                  <Box
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: "12px",
                      backgroundColor: "rgba(63,81,181,0.1)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "primary.main",
                      flexShrink: 0,
                    }}
                  >
                    <EmailIcon />
                  </Box>
                  <Box>
                    <Typography
                      variant="body2"
                      sx={{ color: "text.secondary", fontWeight: 600 }}
                    >
                      Email
                    </Typography>
                    <Typography variant="body1">hello@altaros.io</Typography>
                  </Box>
                </Box>

                <Box
                  sx={{ display: "flex", gap: 2, mb: 3, alignItems: "center" }}
                >
                  <Box
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: "12px",
                      backgroundColor: "rgba(76,175,80,0.1)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#4CAF50",
                      flexShrink: 0,
                    }}
                  >
                    <PhoneIcon />
                  </Box>
                  <Box>
                    <Typography
                      variant="body2"
                      sx={{ color: "text.secondary", fontWeight: 600 }}
                    >
                      Phone
                    </Typography>
                    <Typography variant="body1">+233 (0) 30 123 4567</Typography>
                  </Box>
                </Box>

                <Box
                  sx={{ display: "flex", gap: 2, mb: 3, alignItems: "center" }}
                >
                  <Box
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: "12px",
                      backgroundColor: "rgba(255,179,0,0.1)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#FFB300",
                      flexShrink: 0,
                    }}
                  >
                    <LocationOnIcon />
                  </Box>
                  <Box>
                    <Typography
                      variant="body2"
                      sx={{ color: "text.secondary", fontWeight: 600 }}
                    >
                      Location
                    </Typography>
                    <Typography variant="body1">Accra, Ghana</Typography>
                  </Box>
                </Box>
              </Box>

              {/* Social links */}
              <Box sx={{ mb: 4 }}>
                <Typography
                  variant="body2"
                  sx={{ color: "text.secondary", fontWeight: 600, mb: 1.5 }}
                >
                  Follow Us
                </Typography>
                <Box sx={{ display: "flex", gap: 1 }}>
                  {[
                    { icon: <XIcon />, label: "X" },
                    { icon: <FacebookIcon />, label: "Facebook" },
                    { icon: <LinkedInIcon />, label: "LinkedIn" },
                    { icon: <InstagramIcon />, label: "Instagram" },
                  ].map((social) => (
                    <IconButton
                      key={social.label}
                      aria-label={social.label}
                      sx={{
                        backgroundColor: "rgba(63,81,181,0.08)",
                        color: "primary.main",
                        "&:hover": {
                          backgroundColor: "rgba(63,81,181,0.15)",
                        },
                      }}
                    >
                      {social.icon}
                    </IconButton>
                  ))}
                </Box>
              </Box>

              {/* Map placeholder */}
              <Box
                sx={{
                  width: "100%",
                  height: 200,
                  borderRadius: 3,
                  backgroundColor: "#F0F2F5",
                  border: "2px dashed rgba(0,0,0,0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Typography
                  variant="body2"
                  sx={{ color: "text.secondary", fontWeight: 600 }}
                >
                  Map Placeholder
                </Typography>
              </Box>
            </Grid>
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
            Ready to Get Started?
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{ color: "rgba(255,255,255,0.8)", mb: 5 }}
          >
            Start your free trial and transform your church today.
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
