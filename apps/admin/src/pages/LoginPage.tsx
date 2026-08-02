import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import { Alert, Box, Button, CircularProgress, IconButton, InputAdornment, TextField, Typography } from "@mui/material";
import { AdminPanelSettingsOutlined, ChurchRounded, LockOutlined, Visibility, VisibilityOff } from "@mui/icons-material";
import { useAuth } from "@/hooks/useAuth";

const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});
type LoginFormData = z.infer<typeof loginSchema>;

const fieldSx = {
  "& .MuiOutlinedInput-root": {
    color: "#ECF5F1",
    bgcolor: "#142D2A",
    borderRadius: "12px",
    "& fieldset": { borderColor: "#31504B" },
    "&:hover fieldset": { borderColor: "#79CDBA" },
    "&.Mui-focused fieldset": { borderColor: "#79CDBA", boxShadow: "0 0 0 3px rgba(121,205,186,.12)" },
  },
  "& .MuiInputLabel-root": { color: "#9EB7B1" },
  "& .MuiInputLabel-root.Mui-focused": { color: "#9DE3D2" },
} as const;

export default function LoginPage() {
  const { login, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginFormData>({ resolver: zodResolver(loginSchema) });

  if (isLoading) return null;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  const onSubmit = async (data: LoginFormData) => {
    setServerError("");
    try { await login(data); navigate("/dashboard"); }
    catch (err: unknown) { setServerError(err instanceof Error ? err.message : "Login failed."); }
  };

  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "#0B1C1A", color: "#ECF5F1", display: "grid", gridTemplateColumns: { xs: "1fr", md: "minmax(360px,.78fr) minmax(520px,1.22fr)" } }}>
      <Box sx={{ borderRight: { md: "1px solid #223C38" }, p: { xs: 3, sm: 5, md: 6 }, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.3 }}>
          <Box sx={{ width: 40, height: 40, borderRadius: "13px", bgcolor: "#9DE3D2", color: "#0B1C1A", display: "grid", placeItems: "center" }}><ChurchRounded /></Box>
          <Box><Typography sx={{ fontWeight: 800, letterSpacing: "-.025em" }}>ALTAR OS</Typography><Typography sx={{ color: "#78938D", fontSize: ".72rem" }}>Platform administration</Typography></Box>
        </Box>

        <Box sx={{ display: { xs: "none", md: "block" }, my: 8 }}>
          <AdminPanelSettingsOutlined sx={{ color: "#79CDBA", fontSize: 46, mb: 3 }} />
          <Typography component="h1" sx={{ fontSize: "2.7rem", lineHeight: 1.03, letterSpacing: "-.045em", fontWeight: 750, maxWidth: 380 }}>Control access. Protect every church.</Typography>
          <Typography sx={{ color: "#91AAA4", lineHeight: 1.65, mt: 2.5, maxWidth: 350 }}>Restricted tools for Altar OS platform operators.</Typography>
        </Box>

        <Box sx={{ display: { xs: "none", md: "flex" }, alignItems: "center", gap: 1.2, color: "#78938D" }}><LockOutlined sx={{ fontSize: 17 }} /><Typography sx={{ fontSize: ".78rem" }}>Access is logged and role restricted.</Typography></Box>
      </Box>

      <Box component="main" sx={{ minHeight: { xs: "auto", md: "100dvh" }, display: "flex", alignItems: "center", p: { xs: 3, sm: 6, lg: 10 } }}>
        <Box sx={{ width: "100%", maxWidth: 480 }}>
          <Typography sx={{ color: "#79CDBA", fontSize: ".72rem", fontWeight: 800, letterSpacing: ".14em", mb: 1.5 }}>AUTHORIZED PERSONNEL</Typography>
          <Typography variant="h3" component="h2" sx={{ color: "#ECF5F1", fontWeight: 750, fontSize: { xs: "2rem", sm: "2.45rem" }, letterSpacing: "-.04em" }}>Platform sign in</Typography>
          <Typography sx={{ color: "#91AAA4", mt: 1, mb: 4 }}>Use your operator credentials to continue.</Typography>

          {serverError ? <Alert severity="error" sx={{ mb: 3, borderRadius: "12px" }}>{serverError}</Alert> : null}
          <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate sx={{ display: "grid", gap: 2.4 }}>
            <TextField label="Email" fullWidth autoComplete="email" autoFocus error={!!errors.email} helperText={errors.email?.message} sx={fieldSx} {...register("email")} />
            <TextField
              label="Password" type={showPassword ? "text" : "password"} fullWidth autoComplete="current-password" error={!!errors.password} helperText={errors.password?.message} sx={fieldSx} {...register("password")}
              slotProps={{ input: { endAdornment: <InputAdornment position="end"><IconButton aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)} edge="end" sx={{ color: "#91AAA4" }}>{showPassword ? <VisibilityOff /> : <Visibility />}</IconButton></InputAdornment> } }}
            />
            <Button type="submit" variant="contained" size="large" disabled={isSubmitting} sx={{ minHeight: 52, mt: 1, bgcolor: "#9DE3D2", color: "#0B1C1A", fontWeight: 800, borderRadius: "12px", "&:hover": { bgcolor: "#B8ECDF" } }}>
              {isSubmitting ? <CircularProgress size={23} sx={{ color: "#0B1C1A" }} /> : "Enter admin"}
            </Button>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
