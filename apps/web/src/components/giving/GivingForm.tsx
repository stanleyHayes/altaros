import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import InputAdornment from "@mui/material/InputAdornment";

const givingSchema = z.object({
  amount: z.number({ coerce: true }).positive("Enter a valid amount"),
  type: z.enum(["tithe", "offering", "donation", "pledge", "building_fund"]),
  paymentMethod: z.enum(["card", "bank_transfer", "mobile_money", "ussd", "crypto"]),
  note: z.string().optional(),
});

type GivingFormData = z.infer<typeof givingSchema>;

interface GivingFormProps {
  onSubmit: (data: GivingFormData) => Promise<void>;
}

const quickAmounts = [10, 20, 50, 100, 200, 500];

export default function GivingForm({ onSubmit }: GivingFormProps) {
  const {
    register,
    handleSubmit,
    control,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<GivingFormData>({
    resolver: zodResolver(givingSchema),
    defaultValues: {
      type: "tithe",
      paymentMethod: "card",
    },
  });

  const currentAmount = watch("amount");

  return (
    <Card>
      <CardContent sx={{ p: 2.5 }}>
        <Typography variant="h6" gutterBottom>
          Make a Gift
        </Typography>

        <Box
          component="form"
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}
        >
          {/* Quick Amount Buttons */}
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Quick amounts
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
              {quickAmounts.map((amt) => (
                <Button
                  key={amt}
                  variant={currentAmount === amt ? "contained" : "outlined"}
                  size="small"
                  onClick={() => setValue("amount", amt)}
                  sx={{ minWidth: 72 }}
                >
                  ${amt}
                </Button>
              ))}
            </Box>
          </Box>

          {/* Custom Amount */}
          <TextField
            label="Amount"
            fullWidth
            type="number"
            error={!!errors.amount}
            helperText={errors.amount?.message}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">$</InputAdornment>
              ),
            }}
            {...register("amount")}
          />

          {/* Giving Type */}
          <Controller
            name="type"
            control={control}
            render={({ field }) => (
              <Box>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1 }}
                >
                  Giving type
                </Typography>
                <ToggleButtonGroup
                  value={field.value}
                  exclusive
                  onChange={(_, val) => val && field.onChange(val)}
                  fullWidth
                  size="small"
                >
                  <ToggleButton value="tithe">Tithe</ToggleButton>
                  <ToggleButton value="offering">Offering</ToggleButton>
                  <ToggleButton value="donation">Donation</ToggleButton>
                  <ToggleButton value="pledge">Pledge</ToggleButton>
                  <ToggleButton value="building_fund">Building Fund</ToggleButton>
                </ToggleButtonGroup>
              </Box>
            )}
          />

          {/* Payment Method */}
          <Controller
            name="paymentMethod"
            control={control}
            render={({ field }) => (
              <FormControl fullWidth>
                <InputLabel>Payment Method</InputLabel>
                <Select {...field} label="Payment Method">
                  <MenuItem value="card">Debit/Credit Card</MenuItem>
                  <MenuItem value="bank_transfer">Bank Transfer</MenuItem>
                  <MenuItem value="mobile_money">Mobile Money</MenuItem>
                  <MenuItem value="ussd">USSD</MenuItem>
                  <MenuItem value="crypto">Crypto</MenuItem>
                </Select>
              </FormControl>
            )}
          />

          {/* Note */}
          <TextField
            label="Note (optional)"
            fullWidth
            placeholder="Add a note to your giving..."
            {...register("note")}
          />

          <Button
            type="submit"
            variant="contained"
            size="large"
            fullWidth
            disabled={isSubmitting}
            sx={{
              py: 1.5,
              background:
                "linear-gradient(135deg, #FF6B6B 0%, #FF9E9E 100%)",
            }}
          >
            {isSubmitting ? <CircularProgress size={24} /> : "Give Now"}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
