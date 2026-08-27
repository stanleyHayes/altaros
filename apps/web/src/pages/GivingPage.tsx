import { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import GivingForm from "@/components/giving/GivingForm";
import GivingHistoryList from "@/components/giving/GivingHistoryList";
import CampaignCard from "@/components/giving/CampaignCard";
import PageIntro from "@/components/ui/PageIntro";
import GivingService, { GivingType, PaymentMethod } from "@/services/giving.service";
import { ApiError } from "@/services/api";

interface GivingRecord {
  id: string;
  amount: number;
  type: string;
  date: string;
  status: string;
  reference: string;
}

interface Campaign {
  id: string;
  title: string;
  description: string;
  targetAmount: number;
  raisedAmount: number;
  endDate: string;
  imageUrl?: string;
}

export default function GivingPage() {
  const [tab, setTab] = useState(0);
  const [history, setHistory] = useState<GivingRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);

  const [paymentError, setPaymentError] = useState<string | null>(null);

  // Load giving history
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        setHistoryLoading(true);
        setHistoryError(null);
        const data = await GivingService.getHistory();
        setHistory(data);
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Failed to load giving history";
        setHistoryError(message);
      } finally {
        setHistoryLoading(false);
      }
    };

    fetchHistory();
  }, []);

  // Load campaigns
  useEffect(() => {
    const fetchCampaigns = async () => {
      try {
        setCampaignsLoading(true);
        setCampaignsError(null);
        const data = await GivingService.getCampaigns();
        setCampaigns(data);
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Failed to load campaigns";
        setCampaignsError(message);
      } finally {
        setCampaignsLoading(false);
      }
    };

    fetchCampaigns();
  }, []);

  const handleGive = async (data: {
    amount: number;
    type: string;
    paymentMethod: string;
    note?: string;
  }) => {
    try {
      setPaymentError(null);
      await GivingService.initiatePayment({
        amount: data.amount,
        type: data.type as GivingType,
        paymentMethod: data.paymentMethod as PaymentMethod,
        note: data.note,
      });
      // On success, show a success message or redirect to payment provider
      // For now, just clear the form and show a success alert
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Payment initiation failed";
      setPaymentError(message);
    }
  };

  const retryLoadHistory = () => {
    const fetchHistory = async () => {
      try {
        setHistoryLoading(true);
        setHistoryError(null);
        const data = await GivingService.getHistory();
        setHistory(data);
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Failed to load giving history";
        setHistoryError(message);
      } finally {
        setHistoryLoading(false);
      }
    };
    fetchHistory();
  };

  const retryLoadCampaigns = () => {
    const fetchCampaigns = async () => {
      try {
        setCampaignsLoading(true);
        setCampaignsError(null);
        const data = await GivingService.getCampaigns();
        setCampaigns(data);
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Failed to load campaigns";
        setCampaignsError(message);
      } finally {
        setCampaignsLoading(false);
      }
    };
    fetchCampaigns();
  };

  return (
    <Box sx={{ py: 2 }}>
      <PageIntro eyebrow="Stewardship" title="Giving" copy="Give securely, follow your history and support the work your church is doing." />

      {paymentError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setPaymentError(null)}>
          {paymentError}
        </Alert>
      )}

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
      {tab === 1 && (
        <>
          {historyLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress />
            </Box>
          ) : historyError ? (
            <Box sx={{ textAlign: "center", py: 4 }}>
              <Alert severity="error" sx={{ mb: 2 }}>
                {historyError}
              </Alert>
              <Button variant="contained" onClick={retryLoadHistory}>
                Retry
              </Button>
            </Box>
          ) : (
            <GivingHistoryList records={history} />
          )}
        </>
      )}

      {/* Campaigns Tab */}
      {tab === 2 && (
        <>
          {campaignsLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress />
            </Box>
          ) : campaignsError ? (
            <Box sx={{ textAlign: "center", py: 4 }}>
              <Alert severity="error" sx={{ mb: 2 }}>
                {campaignsError}
              </Alert>
              <Button variant="contained" onClick={retryLoadCampaigns}>
                Retry
              </Button>
            </Box>
          ) : campaigns.length === 0 ? (
            <Box sx={{ textAlign: "center", py: 4 }}>
              <Typography variant="body2" color="text.secondary">
                No active campaigns at the moment.
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {campaigns.map((c) => (
                <CampaignCard
                  key={c.id}
                  title={c.title}
                  description={c.description}
                  targetAmount={c.targetAmount}
                  raisedAmount={c.raisedAmount}
                  endDate={c.endDate}
                  imageUrl={c.imageUrl}
                  onDonate={() => {
                    setTab(0);
                  }}
                />
              ))}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
