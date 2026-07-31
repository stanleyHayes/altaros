import { useState } from "react";
import { useNavigate, Link as RouterLink } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Link from "@mui/material/Link";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import { useAuth } from "@/hooks/useAuth";
import AuthService from "@/services/auth.service";
import AuthLayout from "@/components/auth/AuthLayout";

/* ---------- Clean field styling for light background ---------- */
const fieldSx = {
  "& .MuiOutlinedInput-root": {
    backgroundColor: "#fff",
    borderRadius: "12px",
    "& fieldset": { borderColor: "#E0E0E0" },
    "&:hover fieldset": { borderColor: "#BDBDBD" },
    "&.Mui-focused fieldset": {
      borderColor: "#6B4C9A",
      boxShadow: "0 0 0 3px rgba(107,76,154,0.1)",
    },
  },
  "& .MuiInputLabel-root.Mui-focused": { color: "#6B4C9A" },
} as const;

const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const phoneSchema = z.object({
  phone: z
    .string()
    .min(10, "Enter a valid phone number")
    .regex(/^\+?[\d\s()-]+$/, "Enter a valid phone number"),
});

type LoginFormData = z.infer<typeof loginSchema>;
type PhoneFormData = z.infer<typeof phoneSchema>;

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"email" | "phone">("email");
  const [showPassword, setShowPassword] = useState(false);

  const {
    register: registerEmail,
    handleSubmit: handleEmailSubmit,
    formState: { errors: emailErrors, isSubmitting: isEmailSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const {
    register: registerPhone,
    handleSubmit: handlePhoneSubmit,
    formState: { errors: phoneErrors, isSubmitting: isPhoneSubmitting },
  } = useForm<PhoneFormData>({
    resolver: zodResolver(phoneSchema),
  });

  const onEmailSubmit = async (data: LoginFormData) => {
    try {
      setError(null);
      await login(data);
      navigate("/");
    } catch {
      setError("Invalid email or password. Please try again.");
    }
  };

  const onPhoneSubmit = async (data: PhoneFormData) => {
    try {
      setError(null);
      await AuthService.requestOtp(data.phone);
      navigate("/otp", { state: { phone: data.phone } });
    } catch {
      setError("Failed to send verification code. Please try again.");
    }
  };

  const toggleMode = () => {
    setError(null);
    setMode((prev) => (prev === "email" ? "phone" : "email"));
  };

  return (
    <AuthLayout title="Welcome Back" subtitle="Your church community awaits">
      {error && (
        <Alert severity="error" sx={{ mb: 3, borderRadius: "12px" }}>
          {error}
        </Alert>
      )}

      {mode === "email" ? (
        <Box
          component="form"
          onSubmit={handleEmailSubmit(onEmailSubmit)}
          noValidate
          sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}
        >
          <TextField
            label="Email"
            fullWidth
            autoComplete="email"
            autoFocus
            error={!!emailErrors.email}
            helperText={emailErrors.email?.message}
            sx={fieldSx}
            {...registerEmail("email")}
          />
          <TextField
            label="Password"
            type={showPassword ? "text" : "password"}
            fullWidth
            autoComplete="current-password"
            error={!!emailErrors.password}
            helperText={emailErrors.password?.message}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowPassword((s) => !s)}
                      edge="end"
                      size="small"
                      sx={{ color: "#9E9E9E" }}
                    >
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
            sx={fieldSx}
            {...registerEmail("password")}
          />
          <Button
            type="submit"
            variant="contained"
            size="large"
            fullWidth
            disabled={isEmailSubmitting}
            sx={{
              py: 1.5,
              fontWeight: 700,
              fontSize: "1rem",
              borderRadius: "12px",
              background: "linear-gradient(135deg, #FFB300 0%, #FF8F00 100%)",
              color: "#1A1A2E",
              boxShadow: "0 4px 16px rgba(255,179,0,0.25)",
              textTransform: "none",
              "&:hover": {
                background:
                  "linear-gradient(135deg, #FFC107 0%, #FFB300 100%)",
                boxShadow: "0 6px 20px rgba(255,179,0,0.35)",
              },
              "&:disabled": {
                background: "#E0E0E0",
                color: "#9E9E9E",
              },
            }}
          >
            {isEmailSubmitting ? (
              <CircularProgress size={24} sx={{ color: "#1A1A2E" }} />
            ) : (
              "Sign In"
            )}
          </Button>
        </Box>
      ) : (
        <Box
          component="form"
          onSubmit={handlePhoneSubmit(onPhoneSubmit)}
          noValidate
          sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}
        >
          <TextField
            label="Phone Number"
            fullWidth
            autoComplete="tel"
            autoFocus
            placeholder="+233 24 123 4567"
            error={!!phoneErrors.phone}
            helperText={phoneErrors.phone?.message}
            sx={fieldSx}
            {...registerPhone("phone")}
          />
          <Button
            type="submit"
            variant="contained"
            size="large"
            fullWidth
            disabled={isPhoneSubmitting}
            sx={{
              py: 1.5,
              fontWeight: 700,
              fontSize: "1rem",
              borderRadius: "12px",
              background: "linear-gradient(135deg, #FFB300 0%, #FF8F00 100%)",
              color: "#1A1A2E",
              boxShadow: "0 4px 16px rgba(255,179,0,0.25)",
              textTransform: "none",
              "&:hover": {
                background:
                  "linear-gradient(135deg, #FFC107 0%, #FFB300 100%)",
                boxShadow: "0 6px 20px rgba(255,179,0,0.35)",
              },
              "&:disabled": {
                background: "#E0E0E0",
                color: "#9E9E9E",
              },
            }}
          >
            {isPhoneSubmitting ? (
              <CircularProgress size={24} sx={{ color: "#1A1A2E" }} />
            ) : (
              "Send Verification Code"
            )}
          </Button>
        </Box>
      )}

      <Box sx={{ textAlign: "center", mt: 2.5 }}>
        <Button
          variant="text"
          size="small"
          onClick={toggleMode}
          sx={{
            fontWeight: 600,
            color: "#6B4C9A",
            textTransform: "none",
          }}
        >
          {mode === "email"
            ? "Sign in with phone number instead"
            : "Sign in with email instead"}
        </Button>
      </Box>

      <Box sx={{ textAlign: "center", mt: 2 }}>
        <Typography variant="body2" sx={{ color: "#757575" }}>
          Don&apos;t have an account?{" "}
          <Link
            component={RouterLink}
            to="/register"
            underline="hover"
            sx={{ fontWeight: 600, color: "#6B4C9A" }}
          >
            Join your church
          </Link>
        </Typography>
      </Box>
    </AuthLayout>
  );
}
