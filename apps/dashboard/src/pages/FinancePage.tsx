import { useState } from "react";
import {
  Box,
  Typography,
  Button,
  Chip,
  Grid,
  Tab,
  Tabs,
  MenuItem,
  TextField,
  IconButton,
  Tooltip,
} from "@mui/material";
import {
  Add as AddIcon,
  AccountBalance as TotalIcon,
  VolunteerActivism as TitheIcon,
  CardGiftcard as OfferingIcon,
  Favorite as DonationIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
} from "@mui/icons-material";
import StatCard from "@/components/ui/StatCard";
import DataTable, { type Column } from "@/components/ui/DataTable";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import TransactionFormDialog, {
  type TransactionFormData,
} from "@/components/finance/TransactionFormDialog";
import CampaignCard from "@/components/finance/CampaignCard";
import CampaignFormDialog, {
  type CampaignFormData,
} from "@/components/finance/CampaignFormDialog";

interface TransactionRow {
  id: string;
  type: string;
  amount: string;
  memberName: string;
  date: string;
  method: string;
  status: string;
  description: string;
  [key: string]: unknown;
}

interface CampaignItem {
  id: string;
  name: string;
  description: string;
  goalAmount: number;
  currentAmount: number;
  startDate: string;
  endDate?: string;
  status: "active" | "completed" | "paused";
}

// TODO: Replace with real API data from FinanceService
const sampleTransactions: TransactionRow[] = [
  {
    id: "1",
    type: "tithe",
    amount: "$500.00",
    memberName: "John Smith",
    date: "2026-03-28",
    method: "online",
    status: "completed",
    description: "Monthly tithe",
  },
  {
    id: "2",
    type: "offering",
    amount: "$150.00",
    memberName: "Sarah Johnson",
    date: "2026-03-27",
    method: "cash",
    status: "completed",
    description: "Sunday offering",
  },
  {
    id: "3",
    type: "donation",
    amount: "$1,000.00",
    memberName: "Grace Adekunle",
    date: "2026-03-26",
    method: "bank_transfer",
    status: "completed",
    description: "Building fund donation",
  },
  {
    id: "4",
    type: "tithe",
    amount: "$350.00",
    memberName: "David Okafor",
    date: "2026-03-25",
    method: "card",
    status: "completed",
    description: "Monthly tithe",
  },
  {
    id: "5",
    type: "offering",
    amount: "$75.00",
    memberName: "Emily Brown",
    date: "2026-03-24",
    method: "cash",
    status: "completed",
    description: "Mid-week offering",
  },
  {
    id: "6",
    type: "expense",
    amount: "$2,500.00",
    memberName: "--",
    date: "2026-03-23",
    method: "bank_transfer",
    status: "completed",
    description: "Utility payment",
  },
  {
    id: "7",
    type: "donation",
    amount: "$250.00",
    memberName: "James Taylor",
    date: "2026-03-22",
    method: "online",
    status: "pending",
    description: "Youth camp sponsorship",
  },
];

const sampleCampaigns: CampaignItem[] = [
  {
    id: "1",
    name: "Building Fund",
    description: "New worship center construction project",
    goalAmount: 500000,
    currentAmount: 287500,
    startDate: "2025-01-01",
    endDate: "2026-12-31",
    status: "active",
  },
  {
    id: "2",
    name: "Mission Trip 2026",
    description: "Annual mission trip to support communities in need",
    goalAmount: 25000,
    currentAmount: 18200,
    startDate: "2026-01-15",
    endDate: "2026-06-30",
    status: "active",
  },
  {
    id: "3",
    name: "Youth Scholarship Fund",
    description: "Supporting youth education and development",
    goalAmount: 15000,
    currentAmount: 15000,
    startDate: "2025-06-01",
    endDate: "2025-12-31",
    status: "completed",
  },
  {
    id: "4",
    name: "Community Food Bank",
    description: "Monthly food distribution program for local families",
    goalAmount: 10000,
    currentAmount: 3400,
    startDate: "2026-02-01",
    status: "active",
  },
];

const typeColorMap: Record<string, "primary" | "success" | "warning" | "error" | "info"> = {
  tithe: "primary",
  offering: "success",
  donation: "info",
  expense: "error",
  other: "warning",
};

export default function FinancePage() {
  const [tabIndex, setTabIndex] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [transactions, setTransactions] =
    useState<TransactionRow[]>(sampleTransactions);
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Campaign state
  const [campaigns, setCampaigns] = useState<CampaignItem[]>(sampleCampaigns);
  const [campaignFormOpen, setCampaignFormOpen] = useState(false);
  const [editCampaign, setEditCampaign] = useState<CampaignItem | null>(null);
  const [deleteCampaign, setDeleteCampaign] = useState<CampaignItem | null>(null);

  const filteredTransactions = transactions.filter((t) => {
    if (typeFilter !== "all" && t.type !== typeFilter) return false;
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    return true;
  });

  const handleAddTransaction = async (data: TransactionFormData) => {
    // TODO: Call FinanceService.createTransaction
    const newRow: TransactionRow = {
      id: String(Date.now()),
      type: data.type,
      amount: `$${Number(data.amount).toFixed(2)}`,
      memberName: data.memberName || "--",
      date: data.date,
      method: data.method,
      status: "completed",
      description: data.description || "",
    };
    setTransactions((prev) => [newRow, ...prev]);
  };

  const handleCampaignCreate = () => {
    setEditCampaign(null);
    setCampaignFormOpen(true);
  };

  const handleCampaignEdit = (campaign: CampaignItem) => {
    setEditCampaign(campaign);
    setCampaignFormOpen(true);
  };

  const handleCampaignFormSubmit = async (data: CampaignFormData) => {
    if (editCampaign) {
      setCampaigns((prev) =>
        prev.map((c) =>
          c.id === editCampaign.id
            ? {
                ...c,
                name: data.name,
                description: data.description || "",
                goalAmount: Number(data.goalAmount),
                startDate: data.startDate,
                endDate: data.endDate,
              }
            : c,
        ),
      );
    } else {
      const newCampaign: CampaignItem = {
        id: String(Date.now()),
        name: data.name,
        description: data.description || "",
        goalAmount: Number(data.goalAmount),
        currentAmount: 0,
        startDate: data.startDate,
        endDate: data.endDate,
        status: "active",
      };
      setCampaigns((prev) => [...prev, newCampaign]);
    }
  };

  const handleCampaignDelete = () => {
    if (!deleteCampaign) return;
    setCampaigns((prev) => prev.filter((c) => c.id !== deleteCampaign.id));
    setDeleteCampaign(null);
  };

  const transactionColumns: Column<TransactionRow>[] = [
    {
      id: "type",
      label: "Type",
      minWidth: 100,
      render: (row) => (
        <Chip
          label={row.type}
          size="small"
          color={typeColorMap[row.type] || "default"}
          variant="outlined"
        />
      ),
    },
    {
      id: "amount",
      label: "Amount",
      minWidth: 120,
      render: (row) => (
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {row.amount}
        </Typography>
      ),
    },
    { id: "memberName", label: "Member", minWidth: 150 },
    { id: "date", label: "Date", minWidth: 120 },
    {
      id: "method",
      label: "Method",
      minWidth: 120,
      render: (row) => (
        <Typography variant="body2" sx={{ textTransform: "capitalize" }}>
          {row.method.replace("_", " ")}
        </Typography>
      ),
    },
    {
      id: "status",
      label: "Status",
      minWidth: 100,
      render: (row) => (
        <Chip
          label={row.status}
          size="small"
          color={
            row.status === "completed"
              ? "success"
              : row.status === "pending"
                ? "warning"
                : "error"
          }
        />
      ),
    },
    { id: "description", label: "Description", minWidth: 180 },
  ];

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3,
        }}
      >
        <Typography variant="h4" sx={{ fontWeight: 700 }}>
          Finance
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setFormOpen(true)}
        >
          Add Transaction
        </Button>
      </Box>

      {/* Stat Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Total Income"
            value="$24,580"
            icon={<TotalIcon />}
            change={8.5}
            changeLabel="vs last month"
            iconBgColor="primary.light"
            iconColor="primary.main"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Tithes"
            value="$14,200"
            icon={<TitheIcon />}
            change={12}
            changeLabel="vs last month"
            iconBgColor="success.light"
            iconColor="success.main"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Offerings"
            value="$6,380"
            icon={<OfferingIcon />}
            change={-3.2}
            changeLabel="vs last month"
            iconBgColor="warning.light"
            iconColor="warning.main"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Donations"
            value="$4,000"
            icon={<DonationIcon />}
            change={22}
            changeLabel="vs last month"
            iconBgColor="info.light"
            iconColor="info.main"
          />
        </Grid>
      </Grid>

      {/* Tabs */}
      <Tabs
        value={tabIndex}
        onChange={(_, v) => setTabIndex(v)}
        sx={{ mb: 3, borderBottom: 1, borderColor: "divider" }}
      >
        <Tab label="Transactions" />
        <Tab label="Campaigns" />
      </Tabs>

      {/* Transactions Tab */}
      {tabIndex === 0 && (
        <DataTable
          columns={transactionColumns}
          rows={filteredTransactions}
          getRowId={(row) => row.id}
          searchPlaceholder="Search transactions..."
          toolbar={
            <Box sx={{ display: "flex", gap: 1 }}>
              <TextField
                select
                size="small"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                sx={{ minWidth: 130 }}
                label="Type"
              >
                <MenuItem value="all">All Types</MenuItem>
                <MenuItem value="tithe">Tithe</MenuItem>
                <MenuItem value="offering">Offering</MenuItem>
                <MenuItem value="donation">Donation</MenuItem>
                <MenuItem value="expense">Expense</MenuItem>
                <MenuItem value="other">Other</MenuItem>
              </TextField>
              <TextField
                select
                size="small"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                sx={{ minWidth: 130 }}
                label="Status"
              >
                <MenuItem value="all">All Statuses</MenuItem>
                <MenuItem value="completed">Completed</MenuItem>
                <MenuItem value="pending">Pending</MenuItem>
                <MenuItem value="failed">Failed</MenuItem>
              </TextField>
            </Box>
          }
        />
      )}

      {/* Campaigns Tab */}
      {tabIndex === 1 && (
        <Box>
          <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleCampaignCreate}
            >
              Add Campaign
            </Button>
          </Box>
          <Grid container spacing={3}>
            {campaigns.map((campaign) => (
              <Grid key={campaign.id} size={{ xs: 12, sm: 6, md: 4 }}>
                <Box sx={{ position: "relative" }}>
                  <CampaignCard
                    name={campaign.name}
                    description={campaign.description}
                    goalAmount={campaign.goalAmount}
                    currentAmount={campaign.currentAmount}
                    startDate={campaign.startDate}
                    endDate={campaign.endDate}
                    status={campaign.status}
                  />
                  <Box
                    sx={{
                      position: "absolute",
                      top: 8,
                      right: 8,
                      display: "flex",
                      gap: 0.5,
                    }}
                  >
                    <Tooltip title="Edit">
                      <IconButton
                        size="small"
                        sx={{ bgcolor: "background.paper", boxShadow: 1 }}
                        onClick={() => handleCampaignEdit(campaign)}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton
                        size="small"
                        color="error"
                        sx={{ bgcolor: "background.paper", boxShadow: 1 }}
                        onClick={() => setDeleteCampaign(campaign)}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
              </Grid>
            ))}
          </Grid>
        </Box>
      )}

      {/* Add Transaction Dialog */}
      <TransactionFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleAddTransaction}
      />

      {/* Campaign Form Dialog */}
      <CampaignFormDialog
        open={campaignFormOpen}
        onClose={() => setCampaignFormOpen(false)}
        onSubmit={handleCampaignFormSubmit}
        isEdit={!!editCampaign}
        initialData={
          editCampaign
            ? {
                name: editCampaign.name,
                description: editCampaign.description,
                goalAmount: String(editCampaign.goalAmount),
                startDate: editCampaign.startDate,
                endDate: editCampaign.endDate,
              }
            : undefined
        }
      />

      {/* Delete Campaign Confirmation */}
      <ConfirmDialog
        open={!!deleteCampaign}
        title="Delete Campaign"
        message={`Are you sure you want to delete "${deleteCampaign?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        confirmColor="error"
        onConfirm={handleCampaignDelete}
        onCancel={() => setDeleteCampaign(null)}
      />
    </Box>
  );
}
