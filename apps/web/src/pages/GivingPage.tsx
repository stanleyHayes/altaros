import { useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import GivingForm from "@/components/giving/GivingForm";
import GivingHistoryList from "@/components/giving/GivingHistoryList";
import CampaignCard from "@/components/giving/CampaignCard";

// TODO: Replace with actual API data
const mockHistory = [
  {
    id: "1",
    amount: 200,
    type: "tithe",
    date: "Mar 23, 2026",
    status: "success",
    reference: "TXN-001",
  },
  {
    id: "2",
    amount: 50,
    type: "offering",
    date: "Mar 23, 2026",
    status: "success",
    reference: "TXN-002",
  },
  {
    id: "3",
    amount: 100,
    type: "donation",
    date: "Mar 16, 2026",
    status: "success",
    reference: "TXN-003",
  },
];

const mockCampaigns = [
  {
    id: "1",
    title: "Building Fund",
    description:
      "Help us expand our worship center to accommodate our growing church family.",
    targetAmount: 50000,
    raisedAmount: 32500,
    endDate: "Jun 30, 2026",
  },
  {
    id: "2",
    title: "Mission Trip - Kenya",
    description:
      "Support our mission team traveling to Kenya this summer to serve communities in need.",
    targetAmount: 15000,
    raisedAmount: 8750,
    endDate: "May 15, 2026",
  },
];

export default function GivingPage() {
  const [tab, setTab] = useState(0);

  const handleGive = async (data: {
    amount: number;
    type: string;
    paymentMethod: string;
    note?: string;
  }) => {
    // TODO: Call GivingService.initiatePayment(data)
    console.log("Payment initiated:", data);
  };

  return (
    <Box sx={{ py: 2 }}>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 2 }}>
        Giving
      </Typography>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ mb: 3 }}
      >
        <Tab label="Give" />
        <Tab label="History" />
        <Tab label="Campaigns" />
      </Tabs>

      {/* Give Tab */}
      {tab === 0 && <GivingForm onSubmit={handleGive} />}

      {/* History Tab */}
      {tab === 1 && <GivingHistoryList records={mockHistory} />}

      {/* Campaigns Tab */}
      {tab === 2 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {mockCampaigns.map((c) => (
            <CampaignCard
              key={c.id}
              title={c.title}
              description={c.description}
              targetAmount={c.targetAmount}
              raisedAmount={c.raisedAmount}
              endDate={c.endDate}
              onDonate={() => {
                setTab(0);
                // TODO: Pre-select campaign in giving form
              }}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}
