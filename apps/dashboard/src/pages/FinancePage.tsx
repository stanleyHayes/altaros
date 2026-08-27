import { useState, useCallback, useEffect } from "react";
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
  Alert,
  CircularProgress,
  Snackbar,
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
import FinanceService, {
  type Transaction,
  type Campaign,
  type Summary,
} from "@/services/finance.service";

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

/**
 * Format amount from minor units (pesewas) to GHS currency string.
 * The API returns all monetary values in minor units (100 pesewas = 1 GHS).
 */
function formatGHS(amountInPesewas: number): string {
  const amountInGHS = amountInPesewas / 100;
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    maximumFractionDigits: 0,
  }).format(amountInGHS);
}

/**
 * Map a Transaction from the API to what the table renders.
 * The table needs flat non-optional strings; the wire type has optionals.
 */
function toTransactionRow(t: Transaction): TransactionRow {
  return {
    id: t.id,
    type: t.type,
    amount: formatGHS(t.amount),
    memberName: t.memberName ?? "--",
    date: (t.date ?? t.createdAt ?? "").slice(0, 10),
    method: t.method,
    status: t.status,
    description: t.description ?? "",
  };
}

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
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const [campaignFormOpen, setCampaignFormOpen] = useState(false);
  const [editCampaign, setEditCampaign] = useState<Campaign | null>(null);
  const [deleteCampaign, setDeleteCampaign] = useState<Campaign | null>(null);

  /**
   * Load all finance data. The page shows money, so if load fails, we show
   * an error and a retry button, not mock data that would mislead a church
   * about its finances.
   */
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [summaryData, transactionsData, campaignsData] = await Promise.all([
        FinanceService.getSummary(),
        FinanceService.getTransactions(),
        FinanceService.getCampaigns(),
      ]);

      setSummary(summaryData);
      setTransactions(transactionsData.map(toTransactionRow));
      setCampaigns(campaignsData);
    } catch {
      setLoadError(
        "We could not load your finance data. Check your connection and try again."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredTransactions = transactions.filter((t) => {
    if (typeFilter !== "all" && t.type !== typeFilter) return false;
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    return true;
  });

  const handleAddTransaction = useCallback(
    async (data: TransactionFormData) => {
      try {
        const created = await FinanceService.createTransaction({
          type: data.type as Transaction["type"],
          amount: Math.round(Number(data.amount) * 100), // Convert GHS to pesewas
          method: data.method as Transaction["method"],
          description: data.description,
          date: data.date,
        });
        setTransactions((prev) => [toTransactionRow(created), ...prev]);
        setFormOpen(false);
        setNotice("Transaction recorded.");
      } catch {
        setNotice(
          "We could not save that transaction. Please check the details and try again."
        );
      }
    },
    []
  );

  const handleCampaignCreate = useCallback(() => {
    setEditCampaign(null);
    setCampaignFormOpen(true);
  }, []);

  const handleCampaignEdit = useCallback((campaign: Campaign) => {
    setEditCampaign(campaign);
    setCampaignFormOpen(true);
  }, []);

  const handleCampaignFormSubmit = useCallback(
    async (data: CampaignFormData) => {
      try {
        if (editCampaign) {
          const updated = await FinanceService.updateCampaign(editCampaign.id, {
            name: data.name,
            description: data.description,
            goalAmount: Math.round(Number(data.goalAmount) * 100), // Convert to pesewas
            startDate: data.startDate,
            endDate: data.endDate,
          });
          setCampaigns((prev) =>
            prev.map((c) => (c.id === updated.id ? updated : c))
          );
          setNotice(`${data.name} updated.`);
        } else {
          const created = await FinanceService.createCampaign({
            name: data.name,
            description: data.description,
            goalAmount: Math.round(Number(data.goalAmount) * 100), // Convert to pesewas
            startDate: data.startDate,
            endDate: data.endDate,
          });
          setCampaigns((prev) => [created, ...prev]);
          setNotice(`${data.name} created.`);
        }
        setCampaignFormOpen(false);
      } catch {
        setNotice(
          "We could not save that campaign. Please check the details and try again."
        );
      }
    },
    [editCampaign]
  );

  /**
   * Close a campaign rather than delete it.
   *
   * There is no delete endpoint, deliberately: giving is recorded against a
   * campaign, so removing one would leave the ledger showing income for a
   * fund that no longer exists. Closing stops new gifts and keeps the
   * history answerable. The campaign stays in the list, marked closed.
   */
  const handleCampaignClose = useCallback(async () => {
    if (!deleteCampaign) return;
    const target = deleteCampaign;
    setDeleteCampaign(null);
    try {
      await FinanceService.closeCampaign(target.id);
      setCampaigns((prev) =>
        prev.map((c) => (c.id === target.id ? { ...c, isActive: false } : c)),
      );
      setNotice(`${target.name} is now closed to new giving.`);
    } catch {
      setNotice("We could not close that campaign. Please try again.");
    }
  }, [deleteCampaign]);

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

      {loadError && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => void load()}>
              Retry
            </Button>
          }
        >
          {loadError}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          {/* Stat Cards */}
          <Grid container spacing={3} sx={{ mb: 4 }}>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <StatCard
                title="Total Income"
                value={summary ? formatGHS(summary.income) : "No data"}
                icon={<TotalIcon />}
                iconBgColor="primary.light"
                iconColor="primary.main"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <StatCard
                title="Tithes"
                value={
                  summary && summary.byType.TITHE
                    ? formatGHS(summary.byType.TITHE)
                    : "No data"
                }
                icon={<TitheIcon />}
                iconBgColor="success.light"
                iconColor="success.main"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <StatCard
                title="Offerings"
                value={
                  summary && summary.byType.OFFERING
                    ? formatGHS(summary.byType.OFFERING)
                    : "No data"
                }
                icon={<OfferingIcon />}
                iconBgColor="warning.light"
                iconColor="warning.main"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <StatCard
                title="Donations"
                value={
                  summary && summary.byType.DONATION
                    ? formatGHS(summary.byType.DONATION)
                    : "No data"
                }
                icon={<DonationIcon />}
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
            <>
              {transactions.length === 0 ? (
                <Box sx={{ py: 4, textAlign: "center" }}>
                  <Typography color="textSecondary">
                    No transactions recorded yet.
                  </Typography>
                </Box>
              ) : (
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
            </>
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
              {campaigns.length === 0 ? (
                <Box sx={{ py: 4, textAlign: "center" }}>
                  <Typography color="textSecondary">
                    No campaigns created yet.
                  </Typography>
                </Box>
              ) : (
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
              )}
            </Box>
          )}
        </>
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
                goalAmount: String(editCampaign.goalAmount / 100), // Convert back to GHS for display
                startDate: editCampaign.startDate,
                endDate: editCampaign.endDate,
              }
            : undefined
        }
      />

      {/* Delete Campaign Confirmation */}
      <ConfirmDialog
        open={!!deleteCampaign}
        title="Close campaign"
        message={
          `"${deleteCampaign?.name}" will stop accepting new gifts. Everything ` +
          `already given to it is kept — a campaign cannot be deleted, because ` +
          `the giving recorded against it has to stay answerable.`
        }
        confirmLabel="Close campaign"
        confirmColor="error"
        onConfirm={() => void handleCampaignClose()}
        onCancel={() => setDeleteCampaign(null)}
      />

      <Snackbar
        open={!!notice}
        autoHideDuration={5000}
        onClose={() => setNotice(null)}
        message={notice ?? ""}
      />
    </Box>
  );
}
