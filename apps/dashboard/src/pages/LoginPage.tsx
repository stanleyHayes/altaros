import { useState } from "react";
import { useNavigate, Navigate, Link as RouterLink } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import {
  Box,
  TextField,
  Button,
  Typography,
  Alert,
  CircularProgress,
  Link,
  IconButton,
  InputAdornment,
  FormControlLabel,
  Checkbox,
} from "@mui/material";
import { Visibility, VisibilityOff } from "@mui/icons-material";
import { useAuth } from "@/hooks/useAuth";
import AuthLayout from "@/components/auth/AuthLayout";

/* ---------- Clean field styling for light background ---------- */
const fieldSx = {
  "& .MuiOutlinedInput-root": {
    backgroundColor: "#fff",
    borderRadius: "12px",
    "& fieldset": { borderColor: "#E0E0E0" },
    "&:hover fieldset": { borderColor: "#BDBDBD" },
    "&.Mui-focused fieldset": {
      borderColor: "primary.main",
      boxShadow: "0 0 0 3px rgba(63,81,181,0.12)",
    },
  },
  "& .MuiInputLabel-root.Mui-focused": { color: "primary.main" },
} as const;

const loginSchema = z.object({
  email: z
    .string()
    .min(1, "Email or phone is required")
    .refine(
      (val) =>
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val) ||
        /^\+?[\d\s()-]{7,}$/.test(val),
      "Enter a valid email address or phone number",
    ),
  password: z
    .string()
    .min(1, "Password is required")
    .min(6, "Password must be at least 6 characters"),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const { login, isAuthenticated, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  if (authLoading) return null;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  const onSubmit = async (data: LoginFormData) => {
    setServerError("");
    try {
      await login({ email: data.email, password: data.password });
      navigate("/dashboard");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Login failed. Please try again.";
      setServerError(message);
    }
  };

  return (
    <AuthLayout title="Welcome Back" subtitle="Sign in to your admin dashboard">
      {serverError && (
        <Alert severity="error" sx={{ mb: 3, borderRadius: "12px" }}>
          {serverError}
        </Alert>
      )}

      <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <Controller
          name="email"
          control={control}
          render={({ field }) => (
            <TextField
              {...field}
              fullWidth
              label="Email or Phone"
              autoComplete="email"
              autoFocus
              error={!!errors.email}
              helperText={errors.email?.message}
              sx={{ mb: 2.5, ...fieldSx }}
            />
          )}
        />

        <Controller
          name="password"
          control={control}
          render={({ field }) => (
            <TextField
              {...field}
              fullWidth
              label="Password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              error={!!errors.password}
              helperText={errors.password?.message}
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
              sx={{ mb: 1.5, ...fieldSx }}
            />
          )}
        />

        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            mb: 3,
          }}
        >
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                sx={{
                  color: "#BDBDBD",
                  "&.Mui-checked": { color: "primary.main" },
                }}
              />
            }
            label={
              <Typography variant="body2" sx={{ color: "#757575" }}>
                Remember me
              </Typography>
            }
          />
          <Link
            component={RouterLink}
            to="/forgot-password"
            variant="body2"
            underline="hover"
            sx={{ color: "primary.main", fontWeight: 500 }}
          >
            Forgot password?
          </Link>
        </Box>

        <Button
          type="submit"
          variant="contained"
          fullWidth
          size="large"
          disabled={isSubmitting}
          sx={{
            py: 1.5,
            mb: 3,
            fontWeight: 700,
            fontSize: "1rem",
            borderRadius: "12px",
            background: "linear-gradient(135deg, #FFB300 0%, #FF8F00 100%)",
            color: "#1A1A2E",
            boxShadow: "0 4px 16px rgba(255,179,0,0.25)",
            textTransform: "none",
            "&:hover": {
              background: "linear-gradient(135deg, #FFC107 0%, #FFB300 100%)",
              boxShadow: "0 6px 20px rgba(255,179,0,0.35)",
            },
            "&:disabled": {
              background: "#E0E0E0",
              color: "#9E9E9E",
            },
          }}
        >
          {isSubmitting ? (
            <CircularProgress size={24} sx={{ color: "#1A1A2E" }} />
          ) : (
            "Sign In"
          )}
        </Button>

        <Box sx={{ textAlign: "center" }}>
          <Typography variant="body2" sx={{ color: "#757575" }}>
            Don&apos;t have an account?{" "}
            <Link
              component={RouterLink}
              to="/register"
              underline="hover"
              sx={{ fontWeight: 600, color: "primary.main" }}
            >
              Register your church
            </Link>
          </Typography>
        </Box>
      </Box>
    </AuthLayout>
  );
}
