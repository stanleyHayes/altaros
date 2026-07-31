import { useState } from "react";
import { useNavigate, Link as RouterLink } from "react-router-dom";
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
  Grid,
  IconButton,
  InputAdornment,
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
      borderColor: "#6B4C9A",
      boxShadow: "0 0 0 3px rgba(107,76,154,0.1)",
    },
  },
  "& .MuiInputLabel-root.Mui-focused": { color: "#6B4C9A" },
} as const;

const registerSchema = z
  .object({
    churchName: z
      .string()
      .min(1, "Church name is required")
      .min(2, "Church name must be at least 2 characters"),
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    email: z
      .string()
      .min(1, "Email is required")
      .email("Enter a valid email address"),
    phone: z
      .string()
      .optional()
      .refine(
        (val) => !val || /^\+?[\d\s()-]{7,}$/.test(val),
        "Enter a valid phone number",
      ),
    password: z
      .string()
      .min(1, "Password is required")
      .min(8, "Password must be at least 8 characters")
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
        "Password must contain uppercase, lowercase, and a number",
      ),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type RegisterFormData = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const { register: registerUser } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState("");
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      churchName: "",
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      password: "",
      confirmPassword: "",
    },
  });

  const onSubmit = async (data: RegisterFormData) => {
    setServerError("");
    try {
      await registerUser({
        email: data.email,
        password: data.password,
        firstName: data.firstName,
        lastName: data.lastName,
        churchName: data.churchName,
      });
      setSuccess(true);
      setTimeout(() => navigate("/login"), 2000);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Registration failed. Please try again.";
      setServerError(message);
    }
  };

  const passwordAdornment = (
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
  );

  return (
    <AuthLayout
      title="Create Your Church"
      subtitle="Set up your church's digital home"
    >
      {serverError && (
        <Alert severity="error" sx={{ mb: 3, borderRadius: "12px" }}>
          {serverError}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 3, borderRadius: "12px" }}>
          Registration successful! Redirecting to login...
        </Alert>
      )}

      <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <Controller
          name="churchName"
          control={control}
          render={({ field }) => (
            <TextField
              {...field}
              fullWidth
              label="Church Name"
              autoFocus
              error={!!errors.churchName}
              helperText={errors.churchName?.message}
              sx={{ mb: 2.5, ...fieldSx }}
            />
          )}
        />

        <Grid container spacing={2} sx={{ mb: 2.5 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Controller
              name="firstName"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  fullWidth
                  label="First Name"
                  error={!!errors.firstName}
                  helperText={errors.firstName?.message}
                  sx={fieldSx}
                />
              )}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Controller
              name="lastName"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  fullWidth
                  label="Last Name"
                  error={!!errors.lastName}
                  helperText={errors.lastName?.message}
                  sx={fieldSx}
                />
              )}
            />
          </Grid>
        </Grid>

        <Controller
          name="email"
          control={control}
          render={({ field }) => (
            <TextField
              {...field}
              fullWidth
              label="Email Address"
              type="email"
              autoComplete="email"
              error={!!errors.email}
              helperText={errors.email?.message}
              sx={{ mb: 2.5, ...fieldSx }}
            />
          )}
        />

        <Controller
          name="phone"
          control={control}
          render={({ field }) => (
            <TextField
              {...field}
              fullWidth
              label="Phone Number (optional)"
              autoComplete="tel"
              error={!!errors.phone}
              helperText={errors.phone?.message}
              sx={{ mb: 2.5, ...fieldSx }}
            />
          )}
        />

        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Controller
              name="password"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  fullWidth
                  label="Password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  error={!!errors.password}
                  helperText={errors.password?.message}
                  slotProps={{ input: { endAdornment: passwordAdornment } }}
                  sx={fieldSx}
                />
              )}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Controller
              name="confirmPassword"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  fullWidth
                  label="Confirm Password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  error={!!errors.confirmPassword}
                  helperText={errors.confirmPassword?.message}
                  sx={fieldSx}
                />
              )}
            />
          </Grid>
        </Grid>

        <Button
          type="submit"
          variant="contained"
          fullWidth
          size="large"
          disabled={isSubmitting || success}
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
            "Create Account"
          )}
        </Button>

        <Box sx={{ textAlign: "center" }}>
          <Typography variant="body2" sx={{ color: "#757575" }}>
            Already have an account?{" "}
            <Link
              component={RouterLink}
              to="/login"
              fontWeight={600}
              underline="hover"
              sx={{ color: "#6B4C9A" }}
            >
              Sign in
            </Link>
          </Typography>
        </Box>
      </Box>
    </AuthLayout>
  );
}
