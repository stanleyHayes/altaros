import { useState } from "react";
import { useNavigate, Link as RouterLink } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import {
  Box,
  TextField,
  Button,
  Alert,
  CircularProgress,
  Link,
  IconButton,
  InputAdornment,
} from "@mui/material";
import { Visibility, VisibilityOff } from "@mui/icons-material";
import AuthLayout from "@/components/auth/AuthLayout";
import authService from "@/services/auth.service";

/* Matches LoginPage so the two screens do not look like different products. */
const fieldSx = {
  "& .MuiOutlinedInput-root": {
    backgroundColor: "#FFFFFF",
    borderRadius: "12px",
    "& fieldset": { borderColor: "#C9D8D3" },
    "&:hover fieldset": { borderColor: "#197665" },
    "&.Mui-focused fieldset": {
      borderColor: "#197665",
      boxShadow: "0 0 0 3px rgba(25,118,101,0.12)",
    },
  },
  "& .MuiInputLabel-root.Mui-focused": { color: "#197665" },
} as const;

/*
 * The code goes to the PHONE, not the email.
 *
 * OTP is already how most of this market signs in — a Ghanaian congregation is
 * reachable by phone far more reliably than by email, and many members have no
 * email at all. A reset that depended on email would be unusable by exactly the
 * people most likely to need it.
 */
const requestSchema = z.object({
  phone: z
    .string()
    .trim()
    .min(9, "Enter the phone number on your account")
    .max(20, "That does not look like a phone number"),
});

const resetSchema = z
  .object({
    code: z
      .string()
      .trim()
      .length(6, "The code is 6 digits"),
    password: z
      .string()
      .min(8, "Use 8 characters or more")
      .max(72, "That is too long"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Those two passwords are different",
    path: ["confirm"],
  });

type RequestValues = z.infer<typeof requestSchema>;
type ResetValues = z.infer<typeof resetSchema>;

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<"request" | "reset">("request");
  const [phone, setPhone] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const requestForm = useForm<RequestValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: { phone: "" },
  });
  const resetForm = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { code: "", password: "", confirm: "" },
  });

  const onRequest = async (values: RequestValues) => {
    setError(null);
    try {
      const res = await authService.forgotPassword({ phone: values.phone });
      setPhone(values.phone);
      // The same message regardless of whether the number is registered. The
      // server deliberately cannot tell us, and showing a difference would
      // turn this form into a way of discovering who attends the church.
      setNotice(res.message);
      setStage("reset");
    } catch {
      setError("We could not send a code just now. Try again in a moment.");
    }
  };

  const onReset = async (values: ResetValues) => {
    setError(null);
    try {
      await authService.resetPassword({
        phone,
        code: values.code,
        password: values.password,
      });
      navigate("/login", {
        replace: true,
        state: {
          notice:
            "Your password has been changed and you have been signed out everywhere. Sign in with your new password.",
        },
      });
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "That code is not valid or has expired.";
      setError(message);
    }
  };

  return (
    <AuthLayout
      title={stage === "request" ? "Reset your password" : "Enter your code"}
      subtitle={
        stage === "request"
          ? "We will text a 6-digit code to the phone number on your account."
          : `We sent a code to ${phone}. It expires in 5 minutes.`
      }
    >

      {notice && stage === "reset" && (
        <Alert severity="info" sx={{ mb: 2, borderRadius: "12px" }}>
          {notice}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2, borderRadius: "12px" }}>
          {error}
        </Alert>
      )}

      {stage === "request" ? (
        <Box component="form" onSubmit={requestForm.handleSubmit(onRequest)} noValidate>
          <Controller
            name="phone"
            control={requestForm.control}
            render={({ field, fieldState }) => (
              <TextField
                {...field}
                fullWidth
                label="Phone number"
                placeholder="+233 …"
                autoComplete="tel"
                error={!!fieldState.error}
                helperText={fieldState.error?.message}
                sx={{ ...fieldSx, mb: 2 }}
              />
            )}
          />
          <Button
            type="submit"
            variant="contained"
            fullWidth
            size="large"
            disabled={requestForm.formState.isSubmitting}
            sx={{ borderRadius: "12px", py: 1.4, fontWeight: 700 }}
          >
            {requestForm.formState.isSubmitting ? (
              <CircularProgress size={22} sx={{ color: "#FFFFFF" }} />
            ) : (
              "Send code"
            )}
          </Button>
        </Box>
      ) : (
        <Box component="form" onSubmit={resetForm.handleSubmit(onReset)} noValidate>
          <Controller
            name="code"
            control={resetForm.control}
            render={({ field, fieldState }) => (
              <TextField
                {...field}
                fullWidth
                label="6-digit code"
                slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 6 } }}
                autoComplete="one-time-code"
                error={!!fieldState.error}
                helperText={fieldState.error?.message}
                sx={{ ...fieldSx, mb: 2 }}
              />
            )}
          />
          <Controller
            name="password"
            control={resetForm.control}
            render={({ field, fieldState }) => (
              <TextField
                {...field}
                fullWidth
                label="New password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                error={!!fieldState.error}
                helperText={fieldState.error?.message}
                sx={{ ...fieldSx, mb: 2 }}
                slotProps={{
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          onClick={() => setShowPassword((v) => !v)}
                          edge="end"
                          size="small"
                          aria-label={showPassword ? "Hide password" : "Show password"}
                          sx={{ color: "#9E9E9E" }}
                        >
                          {showPassword ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
              />
            )}
          />
          <Controller
            name="confirm"
            control={resetForm.control}
            render={({ field, fieldState }) => (
              <TextField
                {...field}
                fullWidth
                label="Confirm new password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                error={!!fieldState.error}
                helperText={fieldState.error?.message}
                sx={{ ...fieldSx, mb: 2 }}
              />
            )}
          />
          <Button
            type="submit"
            variant="contained"
            fullWidth
            size="large"
            disabled={resetForm.formState.isSubmitting}
            sx={{ borderRadius: "12px", py: 1.4, fontWeight: 700 }}
          >
            {resetForm.formState.isSubmitting ? (
              <CircularProgress size={22} sx={{ color: "#FFFFFF" }} />
            ) : (
              "Change password"
            )}
          </Button>
          <Button
            fullWidth
            onClick={() => {
              setStage("request");
              setError(null);
            }}
            sx={{ mt: 1, textTransform: "none", color: "#757575" }}
          >
            Use a different number
          </Button>
        </Box>
      )}

      <Box sx={{ mt: 3, textAlign: "center" }}>
        <Link
          component={RouterLink}
          to="/login"
          variant="body2"
          underline="hover"
          sx={{ color: "#197665", fontWeight: 650 }}
        >
          Back to sign in
        </Link>
      </Box>
    </AuthLayout>
  );
}
