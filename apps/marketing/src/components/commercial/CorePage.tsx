import type { ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import { Box, Button, Container, Stack, Typography } from "@mui/material";
import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded";
import CheckRounded from "@mui/icons-material/CheckRounded";
import SEO from "@/components/ui/SEO";

export type CoreFeature = { number: string; title: string; copy: string; note?: string };
export type CoreProof = { value: string; label: string };

type Props = {
  eyebrow: string;
  title: ReactNode;
  intro: string;
  primary: { label: string; href?: string; to?: string };
  secondary?: { label: string; href?: string; to?: string };
  preview: ReactNode;
  features: CoreFeature[];
  statement: string;
  statementCopy: string;
  proofs?: CoreProof[];
  seoTitle: string;
  seoDescription: string;
};

function Action({ action, primary = false }: { action: Props["primary"]; primary?: boolean }) {
  const shared = { size: "large" as const, variant: primary ? "contained" as const : "text" as const, endIcon: <ArrowForwardRounded /> };
  return action.href
    ? <Button {...shared} href={action.href}>{action.label}</Button>
    : <Button {...shared} component={RouterLink} to={action.to || "/"}>{action.label}</Button>;
}

export default function CorePage(props: Props) {
  return <>
    <SEO title={props.seoTitle} description={props.seoDescription} />
    <Box component="section" sx={{ pt: { xs: 8, md: 13 }, pb: { xs: 9, md: 14 }, overflow: "hidden", background: "radial-gradient(circle at 76% 28%, rgba(109,213,196,.20), transparent 30%)" }}>
      <Container maxWidth={false} sx={{ maxWidth: 1360 }}>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1fr .92fr" }, gap: { xs: 7, lg: 12 }, alignItems: "center" }}>
          <Box><Typography variant="overline" color="primary.main">{props.eyebrow}</Typography><Typography variant="h1" sx={{ mt: 2.5, fontSize: "clamp(3.5rem,6.2vw,6.6rem)", maxWidth: 780 }}>{props.title}</Typography><Typography variant="subtitle1" color="text.secondary" sx={{ mt: 3.5, maxWidth: 620 }}>{props.intro}</Typography><Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mt: 5, alignItems: { sm: "center" } }}><Action action={props.primary} primary />{props.secondary && <Action action={props.secondary} />}</Stack></Box>
          <Box sx={{ minWidth: 0 }}>{props.preview}</Box>
        </Box>
      </Container>
    </Box>

    <Box component="section" sx={{ py: { xs: 10, md: 16 }, bgcolor: "#102A27", color: "white" }}><Container maxWidth={false} sx={{ maxWidth: 1360 }}><Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: ".72fr 1.28fr" }, gap: { xs: 6, md: 12 } }}><Box><Typography variant="overline" sx={{ color: "#6DD5C4" }}>What changes</Typography><Typography variant="h2" sx={{ color: "white", mt: 2.5, maxWidth: 540 }}>{props.statement}</Typography><Typography sx={{ color: "rgba(255,255,255,.62)", mt: 3, maxWidth: 480 }}>{props.statementCopy}</Typography></Box><Box>{props.features.map(feature => <Box key={feature.number} sx={{ display: "grid", gridTemplateColumns: { xs: "44px 1fr", sm: "70px .8fr 1.2fr" }, gap: 2, py: 4, borderTop: "1px solid rgba(255,255,255,.14)" }}><Typography variant="overline" sx={{ color: "#6DD5C4" }}>{feature.number}</Typography><Typography variant="h4" sx={{ color: "white" }}>{feature.title}</Typography><Box sx={{ gridColumn: { xs: "2", sm: "auto" } }}><Typography sx={{ color: "rgba(255,255,255,.62)" }}>{feature.copy}</Typography>{feature.note && <Stack direction="row" spacing={1} sx={{ mt: 1.5, color: "#9CE5D9", alignItems: "center" }}><CheckRounded sx={{ fontSize: 17 }} /><Typography variant="caption">{feature.note}</Typography></Stack>}</Box></Box>)}</Box></Box></Container></Box>

    {props.proofs && <Box component="section" sx={{ py: { xs: 8, md: 11 }, bgcolor: "#DFF6F0" }}><Container maxWidth={false} sx={{ maxWidth: 1360 }}><Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", md: `repeat(${props.proofs.length},1fr)` }, gap: 2 }}>{props.proofs.map(proof => <Box key={proof.label} sx={{ py: 3, borderTop: "1px solid rgba(16,42,39,.16)" }}><Typography variant="h3" color="primary.main">{proof.value}</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{proof.label}</Typography></Box>)}</Box></Container></Box>}
  </>;
}
