import { useEffect, useMemo } from "react";
import { Box, Button, Container, Stack, Typography } from "@mui/material";
import OpenInNewRounded from "@mui/icons-material/OpenInNewRounded";
import ReceiptLongRounded from "@mui/icons-material/ReceiptLongRounded";
import VerifiedUserRounded from "@mui/icons-material/VerifiedUserRounded";
import { Helmet } from "react-helmet-async";

const SAFE_PAYMENT_REFERENCE = /^alt_[a-z2-7]{32}$/i;

export function paymentReturnReference(search: string): string | null {
  const params = new URLSearchParams(search);
  const entries = Array.from(params.entries());
  if (entries.length < 1 || entries.length > 2) return null;
  const keys = new Set<string>();
  for (const [key, value] of entries) {
    if ((key !== "reference" && key !== "trxref") || keys.has(key)
      || !SAFE_PAYMENT_REFERENCE.test(value)) return null;
    keys.add(key);
  }
  const reference = params.get("reference");
  const transactionReference = params.get("trxref");
  if (reference && transactionReference
    && reference.toLowerCase() !== transactionReference.toLowerCase()) return null;
  return (reference ?? transactionReference)?.toLowerCase() ?? null;
}

export function paymentReturnDeepLink(search: string): string | null {
  const reference = paymentReturnReference(search);
  return reference
    ? `altaros://giving/complete?reference=${encodeURIComponent(reference)}`
    : null;
}

export default function GivingReturnPage() {
  const deepLink = useMemo(() => paymentReturnDeepLink(window.location.search), []);

  useEffect(() => {
    if (!deepLink) return;
    const timer = window.setTimeout(() => window.location.assign(deepLink), 150);
    return () => window.clearTimeout(timer);
  }, [deepLink]);

  return (
    <>
      <Helmet>
        <title>Return to your gift | ALTAR OS</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>
      <Box sx={{ bgcolor: "#102A27", minHeight: "70vh", py: { xs: 8, md: 14 }, display: "grid", alignItems: "center" }}>
        <Container maxWidth="sm">
          <Box sx={{ bgcolor: "#F8FCFA", borderRadius: { xs: 4, md: 6 }, p: { xs: 3, sm: 5 }, boxShadow: "0 32px 90px rgba(0,0,0,.24)" }}>
            <Stack spacing={3} sx={{ alignItems: "flex-start" }}>
              <Box sx={{ width: 58, height: 58, borderRadius: 3, bgcolor: deepLink ? "#DFF6F0" : "#FCE8E5", display: "grid", placeItems: "center" }}>
                {deepLink
                  ? <ReceiptLongRounded sx={{ color: "#126E63", fontSize: 29 }} />
                  : <VerifiedUserRounded sx={{ color: "#9E3E32", fontSize: 29 }} />}
              </Box>
              <Box>
                <Typography variant="overline" sx={{ color: "primary.main", fontWeight: 800, letterSpacing: ".16em" }}>PAYMENT RETURN</Typography>
                <Typography variant="h2" sx={{ mt: 1, fontSize: { xs: "2.2rem", sm: "3rem" }, lineHeight: 1.04 }}>
                  {deepLink ? "Let’s confirm your gift." : "This payment link is incomplete."}
                </Typography>
              </Box>
              <Typography color="text.secondary" sx={{ fontSize: "1.05rem", lineHeight: 1.7 }}>
                {deepLink
                  ? "ALTAR OS will verify the provider’s final status before your gift appears as confirmed. Do not start another payment while this one is pending."
                  : "For your safety, ALTAR OS did not open an unrecognised payment reference. Check your giving history in the app instead."}
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ width: "100%" }}>
                <Button
                  component="a"
                  href={deepLink ?? "altaros://giving/history"}
                  variant="contained"
                  size="large"
                  endIcon={<OpenInNewRounded />}
                  sx={{ flex: 1, minHeight: 52 }}
                >
                  {deepLink ? "Open ALTAR OS" : "Open giving history"}
                </Button>
                <Button component="a" href="/help" variant="outlined" size="large" sx={{ minHeight: 52 }}>
                  Get help
                </Button>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Only a provider-verified success is recorded as confirmed giving.
              </Typography>
            </Stack>
          </Box>
        </Container>
      </Box>
    </>
  );
}
