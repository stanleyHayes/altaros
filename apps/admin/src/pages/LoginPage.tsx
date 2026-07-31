import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import {
  Box,
  TextField,
  Button,
  Typography,
  Alert,
  CircularProgress,
  IconButton,
  InputAdornment,
} from "@mui/material";
import {
  AdminPanelSettings as AdminIcon,
  Visibility,
  VisibilityOff,
} from "@mui/icons-material";
import { useAuth } from "@/hooks/useAuth";

const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const { login, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  if (isLoading) return null;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  const onSubmit = async (data: LoginFormData) => {
    setServerError("");
    try {
      await login(data);
      navigate("/dashboard");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Login failed.";
      setServerError(message);
    }
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "#0B1120",
        p: 2,
      }}
    >
      <Box sx={{ width: "100%", maxWidth: 400 }}>
        <Box sx={{ textAlign: "center", mb: 4 }}>
          <Box
            sx={{
              width: 64,
              height: 64,
              borderRadius: 3,
              bgcolor: "rgba(91,141,239,0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              mx: "auto",
              mb: 2,
            }}
          >
            <AdminIcon sx={{ color: "#FFB300", fontSize: 36 }} />
          </Box>
          <Typography variant="h4" color="#E5E7EB" sx={{ fontWeight: 700 }}>
            ALTAR OS
          </Typography>
          <Typography variant="body2" color="#9CA3AF" sx={{ mt: 0.5 }}>
            Platform Administration
          </Typography>
        </Box>

        {serverError && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {serverError}
          </Alert>
        )}

        <Box
          component="form"
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}
        >
          <TextField
            label="Email"
            fullWidth
            autoComplete="email"
            autoFocus
            error={!!errors.email}
            helperText={errors.email?.message}
            sx={{
              "& .MuiOutlinedInput-root": {
                color: "#E5E7EB",
                "& fieldset": { borderColor: "#374151" },
                "&:hover fieldset": { borderColor: "#5B8DEF" },
                "&.Mui-focused fieldset": { borderColor: "#5B8DEF" },
                bgcolor: "rgba(255,255,255,0.03)",
              },
              "& .MuiInputLabel-root": { color: "#9CA3AF" },
              "& .MuiInputLabel-root.Mui-focused": { color: "#5B8DEF" },
            }}
            {...register("email")}
          />
          <TextField
            label="Password"
            type={showPassword ? "text" : "password"}
            fullWidth
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
                      sx={{ color: "#9CA3AF" }}
                    >
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
            sx={{
              "& .MuiOutlinedInput-root": {
                color: "#E5E7EB",
                "& fieldset": { borderColor: "#374151" },
                "&:hover fieldset": { borderColor: "#5B8DEF" },
                "&.Mui-focused fieldset": { borderColor: "#5B8DEF" },
                bgcolor: "rgba(255,255,255,0.03)",
              },
              "& .MuiInputLabel-root": { color: "#9CA3AF" },
              "& .MuiInputLabel-root.Mui-focused": { color: "#5B8DEF" },
            }}
            {...register("password")}
          />
          <Button
            type="submit"
            variant="contained"
            fullWidth
            size="large"
            disabled={isSubmitting}
            sx={{
              py: 1.5,
              fontWeight: 700,
              bgcolor: "#5B8DEF",
              "&:hover": { bgcolor: "#3D6BC7" },
            }}
          >
            {isSubmitting ? (
              <CircularProgress size={24} color="inherit" />
            ) : (
              "Sign In"
            )}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
