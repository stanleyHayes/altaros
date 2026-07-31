import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Grid,
  MenuItem,
  CircularProgress,
  InputAdornment,
} from "@mui/material";

const transactionSchema = z.object({
  type: z.enum(["tithe", "offering", "donation", "expense", "other"]),
  amount: z
    .string()
    .min(1, "Amount is required")
    .refine((val) => !isNaN(Number(val)) && Number(val) > 0, "Must be a positive number"),
  description: z.string().optional(),
  category: z.string().optional(),
  memberName: z.string().optional(),
  date: z.string().min(1, "Date is required"),
  method: z.enum(["cash", "card", "bank_transfer", "online", "check"]),
});

export type TransactionFormData = z.infer<typeof transactionSchema>;

interface TransactionFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: TransactionFormData) => Promise<void> | void;
}

export default function TransactionFormDialog({
  open,
  onClose,
  onSubmit,
}: TransactionFormDialogProps) {
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TransactionFormData>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      type: "tithe",
      amount: "",
      description: "",
      category: "",
      memberName: "",
      date: new Date().toISOString().split("T")[0],
      method: "cash",
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        type: "tithe",
        amount: "",
        description: "",
        category: "",
        memberName: "",
        date: new Date().toISOString().split("T")[0],
        method: "cash",
      });
    }
  }, [open, reset]);

  const handleFormSubmit = async (data: TransactionFormData) => {
    await onSubmit(data);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle fontWeight={600}>Add Transaction</DialogTitle>
      <form onSubmit={handleSubmit(handleFormSubmit)}>
        <DialogContent dividers>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Controller
                name="type"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    select
                    label="Type"
                    error={!!errors.type}
                    helperText={errors.type?.message}
                  >
                    <MenuItem value="tithe">Tithe</MenuItem>
                    <MenuItem value="offering">Offering</MenuItem>
                    <MenuItem value="donation">Donation</MenuItem>
                    <MenuItem value="expense">Expense</MenuItem>
                    <MenuItem value="other">Other</MenuItem>
                  </TextField>
                )}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Controller
                name="amount"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    label="Amount"
                    error={!!errors.amount}
                    helperText={errors.amount?.message}
                    slotProps={{
                      input: {
                        startAdornment: (
                          <InputAdornment position="start">$</InputAdornment>
                        ),
                      },
                    }}
                  />
                )}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Controller
                name="method"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    select
                    label="Payment Method"
                    error={!!errors.method}
                    helperText={errors.method?.message}
                  >
                    <MenuItem value="cash">Cash</MenuItem>
                    <MenuItem value="card">Card</MenuItem>
                    <MenuItem value="bank_transfer">Bank Transfer</MenuItem>
                    <MenuItem value="online">Online</MenuItem>
                    <MenuItem value="check">Check</MenuItem>
                  </TextField>
                )}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Controller
                name="date"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    label="Date"
                    type="date"
                    slotProps={{ inputLabel: { shrink: true } }}
                    error={!!errors.date}
                    helperText={errors.date?.message}
                  />
                )}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <Controller
                name="memberName"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    label="Member Name (optional)"
                    error={!!errors.memberName}
                    helperText={errors.memberName?.message}
                  />
                )}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <Controller
                name="description"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    label="Description (optional)"
                    multiline
                    rows={2}
                    error={!!errors.description}
                    helperText={errors.description?.message}
                  />
                )}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={isSubmitting}
            startIcon={
              isSubmitting ? <CircularProgress size={16} /> : undefined
            }
          >
            Add Transaction
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
