import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";

/**
 * Tiers mirror ChurchPlan in @altar-os/shared-types: free | basic | pro | enterprise.
 * Pricing is GHS-denominated deliberately — US-benchmarked SaaS pricing does not
 * translate to Ghanaian church budgets. The free tier is intentionally generous
 * to win branch networks; transaction fees carry the revenue.
 */
type Tier = {
  plan: string;
  name: string;
  price: string;
  cadence: string;
  blurb: string;
  features: string[];
  cta: string;
  highlighted?: boolean;
};

const TIERS: Tier[] = [
  {
    plan: "free",
    name: "Starter",
    price: "GHS 0",
    cadence: "forever",
    blurb: "For small assemblies getting online for the first time.",
    features: [
      "Up to 100 members",
      "Mobile Money & card giving",
      "Events and QR check-in",
      "Member mobile app",
      "Community support",
    ],
    cta: "Start free",
  },
  {
    plan: "basic",
    name: "Growth",
    price: "GHS 249",
    cadence: "per month",
    blurb: "For growing churches running weekly programmes.",
    features: [
      "Up to 500 members",
      "SMS & WhatsApp broadcasts",
      "Giving statements & pledges",
      "Attendance analytics",
      "Email support",
    ],
    cta: "Start free trial",
  },
  {
    plan: "pro",
    name: "Ministry",
    price: "GHS 749",
    cadence: "per month",
    blurb: "For established churches with departments and teams.",
    features: [
      "Unlimited members",
      "Multi-branch reporting",
      "Volunteer scheduling & rotas",
      "AI sermon & member insights",
      "Finance controls & audit trail",
      "Priority support",
    ],
    cta: "Start free trial",
    highlighted: true,
  },
  {
    plan: "enterprise",
    name: "Denomination",
    price: "Custom",
    cadence: "talk to us",
    blurb: "For denominations and multi-campus networks.",
    features: [
      "Unlimited branches",
      "Consolidated HQ analytics",
      "Data residency options",
      "Dedicated onboarding",
      "SLA & account manager",
    ],
    cta: "Contact sales",
  },
];

function TierCard({ tier }: { tier: Tier }) {
  return (
    <Card
      elevation={tier.highlighted ? 5 : 2}
      sx={{
        flex: "1 1 260px",
        maxWidth: { xs: "100%", md: 320 },
        display: "flex",
        flexDirection: "column",
        position: "relative",
        border: tier.highlighted
          ? "2px solid rgba(63,81,181,0.5)"
          : "1px solid rgba(26,26,46,0.08)",
        ...(tier.highlighted && {
          transform: { md: "scale(1.04)" },
          "&:hover": { transform: { md: "scale(1.04) translateY(-4px)" } },
        }),
      }}
    >
      {tier.highlighted && (
        <Chip
          label="Most popular"
          color="secondary"
          size="small"
          sx={{
            position: "absolute",
            top: 16,
            right: 16,
            fontWeight: 700,
            color: "#1A1A2E",
          }}
        />
      )}

      <CardContent sx={{ p: 3.5, display: "flex", flexDirection: "column", flexGrow: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
          {tier.name}
        </Typography>
        <Typography
          variant="body2"
          sx={{ color: "text.secondary", mb: 2.5, minHeight: 44 }}
        >
          {tier.blurb}
        </Typography>

        <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", mb: 0.5 }}>
          <Typography
            variant="h3"
            sx={{ fontWeight: 800, color: tier.highlighted ? "primary.main" : "text.primary" }}
          >
            {tier.price}
          </Typography>
        </Stack>
        <Typography variant="body2" sx={{ color: "text.secondary", mb: 2.5 }}>
          {tier.cadence}
        </Typography>

        <Divider sx={{ mb: 2.5 }} />

        <Stack spacing={1.4} sx={{ mb: 3 }}>
          {tier.features.map((feature) => (
            <Stack
              key={feature}
              direction="row"
              spacing={1.25}
              sx={{ alignItems: "flex-start" }}
            >
              <CheckIcon
                sx={{
                  fontSize: 20,
                  mt: "1px",
                  color: tier.highlighted ? "primary.main" : "secondary.dark",
                  flexShrink: 0,
                }}
              />
              <Typography variant="body2" sx={{ color: "text.primary" }}>
                {feature}
              </Typography>
            </Stack>
          ))}
        </Stack>

        <Box sx={{ mt: "auto" }}>
          <Button
            fullWidth
            size="large"
            variant={tier.highlighted ? "contained" : "outlined"}
            color="primary"
            sx={{
              ...(!tier.highlighted && {
                borderWidth: 2,
                "&:hover": { borderWidth: 2 },
              }),
            }}
          >
            {tier.cta}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}

export default function PricingSection() {
  return (
    <Box
      component="section"
      id="pricing"
      sx={{
        py: { xs: 10, md: 14 },
        backgroundColor: "#FAFBFF",
        borderTop: "1px solid rgba(26,26,46,0.06)",
        borderBottom: "1px solid rgba(26,26,46,0.06)",
      }}
    >
      <Container maxWidth="lg">
        <Box sx={{ textAlign: "center", mb: { xs: 5, md: 7 } }}>
          <Typography variant="h2" sx={{ mb: 2 }}>
            Pricing that fits your church
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{ color: "text.secondary", maxWidth: 620, mx: "auto" }}
          >
            Start free and stay free for as long as you need. Upgrade when your
            congregation grows — no setup fees, cancel anytime.
          </Typography>
        </Box>

        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={3}
          useFlexGap
          sx={{
            alignItems: { xs: "stretch", md: "stretch" },
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          {TIERS.map((tier) => (
            <TierCard key={tier.plan} tier={tier} />
          ))}
        </Stack>

        <Typography
          variant="body2"
          sx={{ textAlign: "center", color: "text.secondary", mt: 5 }}
        >
          Giving is settled directly to your church&rsquo;s own account. Standard
          Mobile Money and card processing fees apply.
        </Typography>
      </Container>
    </Box>
  );
}
