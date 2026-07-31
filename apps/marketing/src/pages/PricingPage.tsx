import { Box, Container, Typography } from "@mui/material";
import SEO from "@/components/ui/SEO";
import PricingSection from "@/components/sections/PricingSection";

const questions=[
  ["Can we really start for free?","Yes. Starter supports up to 100 members with core records, giving, events and member access. No payment card is required to create the church account."],
  ["Does Altar OS hold our church funds?","No. Your church is the merchant. Digital gifts settle through your church’s own payment subaccount; Altar OS does not operate a wallet, float or escrow."],
  ["Can members use a browser?","Yes. Member web supports sign-in, giving, events, spiritual content, community, chat and profile access without installing the mobile app."],
  ["What about a denomination with many branches?","The Denomination plan models branches and hierarchy, provides consolidated reporting and supports dedicated onboarding. Contact us to scope the structure."],
];
export default function PricingPage(){return <><SEO title="Pricing" description="GHS-denominated Altar OS pricing for local churches, growing ministries and denominations."/><PricingSection/><Box component="section" sx={{py:{xs:9,md:14},bgcolor:"#DFF6F0"}}><Container maxWidth={false} sx={{maxWidth:1100}}><Typography variant="overline" color="primary.main">Questions before you choose</Typography><Typography variant="h2" sx={{mt:2,maxWidth:700}}>Clear answers, before the invoice.</Typography><Box sx={{mt:7}}>{questions.map(([q,a])=><Box key={q} sx={{display:"grid",gridTemplateColumns:{xs:"1fr",md:".7fr 1.3fr"},gap:3,py:4,borderTop:"1px solid rgba(16,42,39,.16)"}}><Typography variant="h4">{q}</Typography><Typography color="text.secondary" sx={{maxWidth:620}}>{a}</Typography></Box>)}</Box></Container></Box></>}
