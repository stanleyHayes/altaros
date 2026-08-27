import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";

interface GivingRecord {
  id: string;
  amount: number;
  type: string;
  date: string;
  status: string;
  reference: string;
}

interface GivingHistoryListProps {
  records: GivingRecord[];
}

const typeColors: Record<string, "primary" | "secondary" | "default"> = {
  tithe: "primary",
  offering: "secondary",
  donation: "default",
};

export default function GivingHistoryList({ records }: GivingHistoryListProps) {
  if (records.length === 0) {
    return (
      <Box sx={{ textAlign: "center", py: 4 }}>
        <Typography variant="body2" color="text.secondary">
          No giving history yet. Your first gift will appear here.
        </Typography>
      </Box>
    );
  }

  // Format amount in pesewas (minor units) to GHS currency
  const formatGHS = (amountInMinorUnits: number) => {
    return new Intl.NumberFormat("en-GH", {
      style: "currency",
      currency: "GHS",
      maximumFractionDigits: 0,
    }).format(amountInMinorUnits / 100);
  };

  return (
    <Card>
      <CardContent sx={{ p: 0 }}>
        {records.map((record, index) => (
          <Box key={record.id}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                px: 2.5,
                py: 2,
              }}
            >
              <Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                    {record.type.charAt(0).toUpperCase() + record.type.slice(1)}
                  </Typography>
                  <Chip
                    label={record.status}
                    size="small"
                    color={record.status === "success" ? "success" : "default"}
                    variant="outlined"
                    sx={{ fontSize: "0.65rem", height: 20 }}
                  />
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {record.date} &middot; Ref: {record.reference}
                </Typography>
              </Box>
              <Typography variant="subtitle1" color="primary.main" sx={{ fontWeight: 700 }}>
                {formatGHS(record.amount)}
              </Typography>
            </Box>
            {index < records.length - 1 && <Divider />}
          </Box>
        ))}
      </CardContent>
    </Card>
  );
}
