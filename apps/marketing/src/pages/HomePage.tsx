import { Link as RouterLink } from "react-router-dom";
import { Box, Button, Container, Divider, Stack, Typography } from "@mui/material";
import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded";
import CheckRounded from "@mui/icons-material/CheckRounded";
import GroupsRounded from "@mui/icons-material/GroupsRounded";
import VolunteerActivismRounded from "@mui/icons-material/VolunteerActivismRounded";
import EventAvailableRounded from "@mui/icons-material/EventAvailableRounded";
import ForumRounded from "@mui/icons-material/ForumRounded";
import AccountBalanceWalletRounded from "@mui/icons-material/AccountBalanceWalletRounded";
import WifiOffRounded from "@mui/icons-material/WifiOffRounded";
import TranslateRounded from "@mui/icons-material/TranslateRounded";
import AccountTreeRounded from "@mui/icons-material/AccountTreeRounded";
import SEO from "@/components/ui/SEO";
import PricingSection from "@/components/sections/PricingSection";

const eyebrow = { display: "inline-flex", alignItems: "center", gap: 1, color: "primary.main", fontSize: ".72rem", fontWeight: 750, letterSpacing: ".14em", textTransform: "uppercase" } as const;
const section = { py: { xs: 10, md: 17 } } as const;

function MiniDashboard() {
  return <Box sx={{ position: "relative", minHeight: { xs: 440, md: 620 }, display: "grid", alignItems: "center" }}>
    <Box sx={{ position: "absolute", inset: "7% 5% 0 8%", bgcolor: "#123F39", borderRadius: "48% 48% 8px 8px", transform: "rotate(2deg)" }} />
    <Box sx={{ position: "relative", ml: { xs: 0, md: 4 }, bgcolor: "#FFFFFF", border: "1px solid rgba(16,42,39,.14)", borderRadius: 2, boxShadow: "0 36px 90px rgba(16,72,65,.18)", overflow: "hidden", transform: { md: "rotate(-2.5deg)" } }}>
      <Stack direction="row" spacing={1} sx={{ px: 2.5, py: 1.75, borderBottom: "1px solid", borderColor: "divider" }}><Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "primary.main" }} /><Typography variant="body2"sx={{ fontWeight: 700 }}>Sunday overview</Typography><Typography variant="caption" sx={{ ml: "auto!important", color: "text.secondary" }}>Aug 03</Typography></Stack>
      <Box sx={{ p: { xs: 2, md: 3 } }}>
        <Typography variant="overline" color="text.secondary">Worship attendance</Typography><Typography sx={{ mt: 1, fontFamily: "'Outfit',sans-serif", fontSize: { xs: "3.4rem", md: "5rem" }, lineHeight: 1, letterSpacing: "-.05em" }}>1,284</Typography><Typography variant="body2" sx={{ color: "#157F73", mt: .5 }}>↑ 8.4% from last Sunday</Typography>
        <Box sx={{ height: 145, mt: 4, display: "flex", gap: 1.2, alignItems: "end", borderBottom: "1px solid", borderColor: "divider" }}>{[31,45,38,63,52,76,68,88,72,94,82,100].map((h, i) => <Box key={i} sx={{ flex: 1, height: `${h}%`, bgcolor: i === 11 ? "primary.main" : "#CDEAE4", borderRadius: "3px 3px 0 0" }} />)}</Box>
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5, mt: 3 }}><Box sx={{ bgcolor: "#FFF0E5", p: 2, borderRadius: 1 }}><Typography variant="caption" color="text.secondary">First-time guests</Typography><Typography variant="h4" sx={{ mt: .5 }}>37</Typography></Box><Box sx={{ bgcolor: "#DFF6F0", p: 2, borderRadius: 1 }}><Typography variant="caption" color="text.secondary">Care follow-ups</Typography><Typography variant="h4" sx={{ mt: .5 }}>12</Typography></Box></Box>
      </Box>
    </Box>
    <Box sx={{ position: "absolute", right: { xs: -5, md: -22 }, bottom: { xs: 8, md: 45 }, bgcolor: "#157F73", color: "#fff", p: 2.2, width: 190, borderRadius: 1, boxShadow: "0 18px 50px rgba(16,72,65,.22)", transform: "rotate(4deg)" }}><Typography variant="caption" sx={{ opacity: .74 }}>Care alert</Typography><Typography sx={{ mt: .6, lineHeight: 1.35, fontWeight: 650 }}>3 members need a pastoral check-in</Typography></Box>
  </Box>;
}

const workflows = [
  { Icon: GroupsRounded, n: "01", title: "Know your people", copy: "One living record for every member, household, department and pastoral note—accessible to the right leaders." },
  { Icon: VolunteerActivismRounded, n: "02", title: "Steward every cedi", copy: "Track giving, funds, pledges and expenses with a clean audit trail built for local church finance teams." },
  { Icon: EventAvailableRounded, n: "03", title: "Plan the gathering", copy: "Run services, conferences and small groups without juggling forms, chats and scattered spreadsheets." },
  { Icon: ForumRounded, n: "04", title: "Keep everyone close", copy: "Send the right message to the right people, and give members one place for church life throughout the week." },
];

const localAdvantages = [
  { Icon: AccountBalanceWalletRounded, label: "Giving", title: "MoMo and cash, reconciled together", copy: "Digital gifts settle directly to the church. Counting teams can record cash with dual control, attribution and a complete audit trail.", color: "#DFF6F0" },
  { Icon: WifiOffRounded, label: "Connectivity", title: "Sunday still works when the network does not", copy: "Check in members, look up records and keep essential ministry moving offline. Changes reconcile safely when connectivity returns.", color: "#FFF0E5" },
  { Icon: TranslateRounded, label: "Belonging", title: "Church life in the language people speak", copy: "Designed for English, Twi, Ga, Ewe, Hausa, Yoruba, Swahili and French—with WhatsApp alongside SMS, email and push.", color: "#EEF3FF" },
  { Icon: AccountTreeRounded, label: "Structure", title: "One view from congregation to denomination", copy: "Model branches, districts and national structures without flattening every church into the same shape or exposing private member data.", color: "#EAF2E8" },
];

export default function HomePage() {
  return <>
    <SEO title="Altar OS — Ministry, in one place" description="A complete operating system for churches across Africa. Bring members, giving, events, care and communication into one dependable home." canonical="https://altaros.io" ogUrl="https://altaros.io" />
    <Box component="section" sx={{ overflow: "hidden", borderBottom: "1px solid", borderColor: "divider", backgroundImage: "radial-gradient(circle at 8% 30%, rgba(109,213,196,.16), transparent 28%), linear-gradient(rgba(21,127,115,.045) 1px, transparent 1px)", backgroundSize: "auto, 100% 48px" }}>
      <Container maxWidth={false} sx={{ maxWidth: 1440 }}><Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1.02fr .98fr" }, gap: { xs: 2, lg: 8 }, alignItems: "center", minHeight: { lg: "calc(100dvh - 78px)" }, py: { xs: 8, md: 10 } }}>
        <Box><Box sx={eyebrow}><Box sx={{ width: 28, height: 1, bgcolor: "primary.main" }} /> Built in Africa, for the church</Box><Typography variant="h1" sx={{ mt: 3.5, maxWidth: 820, textWrap: "balance" }}>Ministry, <Box component="span" sx={{ color: "primary.main", fontWeight: 600 }}>held together.</Box></Typography><Typography variant="subtitle1" color="text.secondary" sx={{ mt: 4, maxWidth: 590, textWrap: "pretty" }}>Altar OS gives your church one dependable home for people, giving, events, communication and care—so your team can spend less time managing tools and more time serving people.</Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mt: 5 }}><Button component={RouterLink} to="/get-started" variant="contained" size="large" endIcon={<ArrowForwardRounded />}>Start free</Button><Button component={RouterLink} to="/features" size="large" sx={{ color: "text.primary" }}>Explore the platform</Button></Stack>
          <Stack direction="row" spacing={{ xs: 2, sm: 4 }} useFlexGap sx={{ mt: 6 }}>{["No credit card", "Ghanaian support", "Mobile-first"].map(x => <Stack key={x} direction="row" spacing={.7}><CheckRounded sx={{ fontSize: 16, color: "primary.main" }} /><Typography variant="caption" sx={{ fontWeight: 650 }}>{x}</Typography></Stack>)}</Stack>
        </Box><MiniDashboard />
      </Box></Container>
    </Box>

    <Box sx={{ py: 2.2, bgcolor: "#102A27", color: "#F7FBF8", overflow: "hidden" }}><Typography sx={{ whiteSpace: "nowrap", fontFamily: "'Outfit',sans-serif", fontSize: { xs: "1.35rem", md: "1.65rem" }, textAlign: "center", opacity: .92 }}>Members · Giving · Pastoral care · Events · Communication · Insights · Member mobile app</Typography></Box>

    <Box component="section" sx={section}><Container maxWidth={false} sx={{ maxWidth: 1440 }}><Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: ".7fr 1.3fr" }, gap: { xs: 5, md: 10 } }}><Box><Box sx={eyebrow}>The daily work</Box><Typography variant="h2" sx={{ mt: 2.5, maxWidth: 520 }}>One church. Too many loose ends.</Typography></Box><Box sx={{ pt: { md: 8 } }}><Typography variant="h4" sx={{ maxWidth: 680, fontWeight: 500, lineHeight: 1.5 }}>A member list in Excel. Giving in another system. Events in WhatsApp. Follow-ups in somebody’s notebook.</Typography><Typography color="text.secondary" sx={{ mt: 3, maxWidth: 650 }}>Altar OS connects the work your church already does. Every update makes the next conversation clearer, the next decision better, and the next act of care easier to follow through.</Typography><Divider sx={{ my: 5 }} /><Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 2 }}>{[["1", "shared record"], ["24/7", "member access"], ["360°", "ministry view"]].map(([a,b]) => <Box key={b}><Typography variant="h3" color="primary.main">{a}</Typography><Typography variant="caption" color="text.secondary">{b}</Typography></Box>)}</Box></Box></Box></Container></Box>

    <Box component="section" sx={{ ...section, bgcolor: "#EDF8F4", borderTop: "1px solid", borderBottom: "1px solid", borderColor: "divider" }}><Container maxWidth={false} sx={{ maxWidth: 1440 }}><Stack direction={{ xs: "column", md: "row" }} sx={{ gap: 3, mb: { xs: 6, md: 10 }, justifyContent: "space-between", alignItems: { md: "end" } }}><Box><Box sx={eyebrow}>One connected rhythm</Box><Typography variant="h2" sx={{ mt: 2.5, maxWidth: 720 }}>From first visit to faithful belonging.</Typography></Box><Typography color="text.secondary" sx={{ maxWidth: 440 }}>Each part of the platform shares context with the rest. No double entry. No lost handoffs.</Typography></Stack>
      <Box>{workflows.map(({ Icon, n, title, copy }) => <Box key={n} sx={{ display: "grid", gridTemplateColumns: { xs: "45px 1fr", md: "80px 90px .8fr 1fr" }, gap: { xs: 2, md: 4 }, alignItems: "center", py: { xs: 4, md: 5 }, borderTop: "1px solid", borderColor: "divider", "&:last-child": { borderBottom: "1px solid", borderColor: "divider" }, "&:hover .workflow-icon": { bgcolor: "primary.main", color: "#fff", transform: "rotate(-5deg)" } }}><Typography variant="overline" color="text.secondary">{n}</Typography><Box className="workflow-icon" sx={{ display: { xs: "none", md: "grid" }, width: 58, height: 58, border: "1px solid", borderColor: "divider", placeItems: "center", borderRadius: "50%", transition: "all 220ms ease" }}><Icon /></Box><Typography variant="h3">{title}</Typography><Typography color="text.secondary" sx={{ gridColumn: { xs: "2", md: "auto" }, maxWidth: 510 }}>{copy}</Typography></Box>)}</Box>
    </Container></Box>

    <Box component="section" sx={{ ...section, overflow: "hidden" }}><Container maxWidth={false} sx={{ maxWidth: 1440 }}><Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" }, gap: { xs: 7, lg: 12 }, alignItems: "center" }}><Box sx={{ position: "relative", bgcolor: "#123F39", color: "#fff", p: { xs: 3, md: 6 }, minHeight: 520, borderRadius: "52% 52% 8px 8px" }}><Box sx={{ bgcolor: "#FFFFFF", color: "text.primary", p: 3, mt: { xs: 9, md: 12 }, borderRadius: 1, transform: "rotate(-3deg)", boxShadow: "0 30px 70px rgba(0,0,0,.28)" }}><Typography variant="overline" color="primary.main">Member care</Typography><Typography variant="h4" sx={{ mt: 1.5 }}>Ama Mensah</Typography><Typography variant="body2" color="text.secondary">New member · East Legon community</Typography><Divider sx={{ my: 2.5 }} />{["Welcome call completed", "Joined young adults", "Prayer request assigned"].map((x,i) => <Stack key={x} direction="row" spacing={1.5} sx={{ py: 1.2 }}><CheckRounded sx={{ fontSize: 19, color: i === 2 ? "primary.main" : "secondary.main" }} /><Typography variant="body2">{x}</Typography></Stack>)}</Box></Box><Box><Box sx={eyebrow}>Care with context</Box><Typography variant="h2" sx={{ mt: 2.5 }}>People are more than rows in a database.</Typography><Typography color="text.secondary" sx={{ mt: 3, maxWidth: 570 }}>See the whole story—household, attendance, groups, serving, giving and care—in one respectful profile. Your pastors know who needs attention without turning ministry into surveillance.</Typography><Stack spacing={2.2} sx={{ mt: 5 }}>{["Role-based access protects sensitive notes", "Care workflows make every follow-up visible", "Household records reflect how church life really works"].map(x => <Stack key={x} direction="row" spacing={1.5}><CheckRounded sx={{ color: "primary.main" }} /><Typography>{x}</Typography></Stack>)}</Stack><Button component={RouterLink} to="/solutions/pastors" endIcon={<ArrowForwardRounded />} sx={{ mt: 5, px: 0, color: "text.primary" }}>See the pastoral view</Button></Box></Box></Container></Box>

    <Box component="section" sx={{ ...section, bgcolor: "#102A27", color: "#FFFFFF" }}>
      <Container maxWidth={false} sx={{ maxWidth: 1440 }}>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: ".7fr 1.3fr" }, gap: { xs: 6, lg: 12 }, alignItems: "start" }}>
          <Box sx={{ position: { lg: "sticky" }, top: { lg: 120 } }}>
            <Typography variant="overline" sx={{ color: "#6DD5C4" }}>Designed from here</Typography>
            <Typography variant="h2" sx={{ mt: 2.5, color: "#FFFFFF", maxWidth: 560 }}>Built around African church life.</Typography>
            <Typography sx={{ mt: 3, color: "rgba(255,255,255,.65)", maxWidth: 500 }}>Not a foreign church product with local payment buttons added later. The operating model starts with how churches across Ghana and the continent already gather, give, communicate and grow.</Typography>
          </Box>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
            {localAdvantages.map(({ Icon, label, title, copy, color }, index) => <Box key={title} sx={{ bgcolor: color, color: "#102A27", p: { xs: 3, md: 4 }, borderRadius: 3, minHeight: { sm: index % 2 === 0 ? 330 : 380 }, mt: { sm: index % 2 === 0 ? 0 : 5 }, display: "flex", flexDirection: "column", transition: "transform 220ms ease", "&:hover": { transform: "translateY(-5px)" } }}>
              <Box sx={{ width: 48, height: 48, borderRadius: "14px", bgcolor: "rgba(16,42,39,.08)", display: "grid", placeItems: "center" }}><Icon /></Box>
              <Typography variant="overline" sx={{ mt: 5, color: "#157F73" }}>{label}</Typography>
              <Typography variant="h4" sx={{ mt: 1.5, maxWidth: 340 }}>{title}</Typography>
              <Typography variant="body2" sx={{ mt: 2, color: "rgba(16,42,39,.68)", maxWidth: 360 }}>{copy}</Typography>
            </Box>)}
          </Box>
        </Box>
      </Container>
    </Box>

    <PricingSection />

    <Box component="section" sx={{ ...section, bgcolor: "#157F73", color: "#FFFFFF" }}><Container maxWidth={false} sx={{ maxWidth: 1440 }}><Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1.3fr .7fr" }, gap: 6, alignItems: "end" }}><Box><Typography variant="overline" sx={{ color: "#BFEDE5" }}>A better first step</Typography><Typography variant="h2" sx={{ mt: 2.5, color: "#FFFFFF", maxWidth: 850 }}>Start with the work that slows your ministry down most.</Typography></Box><Box><Typography sx={{ color: "rgba(255,255,255,.75)", mb: 4 }}>Create your church workspace free, or talk with us about branches, migration and onboarding.</Typography><Button component={RouterLink} to="/get-started" size="large" sx={{ bgcolor: "#FFFFFF", color: "#0E5B53", "&:hover": { bgcolor: "#DFF6F0" } }} endIcon={<ArrowForwardRounded />}>Choose your way in</Button></Box></Box></Container></Box>
  </>;
}
