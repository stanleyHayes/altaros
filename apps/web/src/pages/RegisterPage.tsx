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

const registerSchema = z.object({
  firstName: z.string().min(2, "First name is required"),
  lastName: z.string().min(2, "Last name is required"),
  email: z.string().email("Enter a valid email address"),
  phone: z.string().min(10, "Enter a valid phone number"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  churchCode: z.string().min(3, "Enter your church code"),
});

type RegisterFormData = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const navigate = useNavigate();
  const { register: registerUser } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (data: RegisterFormData) => {
    try {
      setError(null);
      // The form collects a first and last name because that is how people
      // expect to be asked; the API stores one `name`. Mapping here keeps the
      // form natural without inventing fields the API does not have.
      //
      // The church identifier is passed as `churchId`. A church admin shares
      // it when inviting members. A friendlier short code would need a lookup
      // endpoint that does not exist yet — see §10 Q-8.
      await registerUser({
        name: `${data.firstName} ${data.lastName}`.trim(),
        email: data.email,
        phone: data.phone,
        password: data.password,
        churchId: data.churchCode,
      });
      navigate("/");
    } catch {
      setError("Registration failed. Please check your details and try again.");
    }
  };

  return (
    <AuthLayout
      title="Join Your Church"
      subtitle="Create your member account"
    >
      {error && (
        <Alert severity="error" sx={{ mb: 3, borderRadius: "12px" }}>
          {error}
        </Alert>
      )}

      <Box
        component="form"
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}
      >
        <Box sx={{ display: "flex", gap: 2 }}>
          <TextField
            label="First Name"
            fullWidth
            autoFocus
            error={!!errors.firstName}
            helperText={errors.firstName?.message}
            sx={fieldSx}
            {...register("firstName")}
          />
          <TextField
            label="Last Name"
            fullWidth
            error={!!errors.lastName}
            helperText={errors.lastName?.message}
            sx={fieldSx}
            {...register("lastName")}
          />
        </Box>
        <TextField
          label="Email Address"
          fullWidth
          autoComplete="email"
          error={!!errors.email}
          helperText={errors.email?.message}
          sx={fieldSx}
          {...register("email")}
        />
        <TextField
          label="Phone Number"
          fullWidth
          autoComplete="tel"
          error={!!errors.phone}
          helperText={errors.phone?.message}
          sx={fieldSx}
          {...register("phone")}
        />
        <TextField
          label="Password"
          type={showPassword ? "text" : "password"}
          fullWidth
          autoComplete="new-password"
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
          sx={fieldSx}
          {...register("password")}
        />
        <TextField
          label="Church Code"
          fullWidth
          placeholder="e.g. GRACE-001"
          error={!!errors.churchCode}
          helperText={
            errors.churchCode?.message ||
            "Ask your church admin for the code"
          }
          sx={fieldSx}
          {...register("churchCode")}
        />
        <Button
          type="submit"
          variant="contained"
          size="large"
          fullWidth
          disabled={isSubmitting}
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
      </Box>

      <Box sx={{ textAlign: "center", mt: 3 }}>
        <Typography variant="body2" sx={{ color: "#757575" }}>
          Already have an account?{" "}
          <Link
            component={RouterLink}
            to="/login"
            underline="hover"
            sx={{ fontWeight: 600, color: "#6B4C9A" }}
          >
            Sign in
          </Link>
        </Typography>
      </Box>
    </AuthLayout>
  );
}
