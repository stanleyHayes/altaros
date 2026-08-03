import { useState } from "react";
import { useNavigate, Link as RouterLink } from "react-router-dom";
import { useForm, Controller, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  IconButton,
  InputAdornment,
  Link,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import {
  ArrowBackRounded,
  ArrowForwardRounded,
  CheckRounded,
  Groups2Rounded,
  Visibility,
  VisibilityOff,
} from "@mui/icons-material";
import { useAuth } from "@/hooks/useAuth";
import AuthLayout from "@/components/auth/AuthLayout";

const registerSchema = z
  .object({
    churchName: z.string().min(2, "Enter your church name"),
    churchCity: z.string().min(2, "Enter the city or town"),
    churchDenomination: z.string().min(2, "Choose a tradition or enter your own"),
    averageWeeklyAttendance: z.string().regex(/^\d+$/, "Enter an approximate number"),
    ministryPriorities: z.array(z.string()).min(1, "Choose at least one priority").max(4),
    requestedPlan: z.enum(["free", "basic", "pro"]),
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    email: z.string().min(1, "Email is required").email("Enter a valid email address"),
    phone: z.string().min(1, "Phone number is required").regex(/^\+?[\d\s()-]{7,}$/, "Enter a valid phone number"),
    password: z.string().min(8, "Use at least 8 characters").regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, "Include uppercase, lowercase and a number"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] });

type RegisterFormData = z.infer<typeof registerSchema>;

const steps: Array<{ label: string; title: string; copy: string; fields: FieldPath<RegisterFormData>[] }> = [
  { label: "Church", title: "Tell us about your church", copy: "A few details help us prepare the right workspace and local defaults.", fields: ["churchName", "churchCity", "churchDenomination", "averageWeeklyAttendance"] },
  { label: "Focus", title: "What needs attention first?", copy: "Choose up to four. We’ll use these to shape your getting-started checklist.", fields: ["ministryPriorities"] },
  { label: "Package", title: "Choose where to begin", copy: "Start free or select the package you want us to activate after billing setup.", fields: ["requestedPlan"] },
  { label: "Account", title: "Create your administrator account", copy: "This becomes the first church administrator and workspace owner.", fields: ["firstName", "lastName", "email", "phone", "password", "confirmPassword"] },
];

const priorities = ["Member care", "Giving records", "Events & attendance", "Church communication", "Departments & volunteers", "Multi-branch reporting", "Pastoral insights", "Member mobile access"];

const plans = [
  { value: "free" as const, name: "Starter", price: "GHS 0", cadence: "forever", note: "Up to 100 members", features: ["People and households", "Giving and events", "Member web and mobile"] },
  { value: "basic" as const, name: "Growth", price: "GHS 249", cadence: "/ month", note: "Up to 500 members", features: ["Everything in Starter", "WhatsApp and SMS", "Attendance analytics"] },
  { value: "pro" as const, name: "Ministry", price: "GHS 749", cadence: "/ month", note: "Unlimited members", features: ["Everything in Growth", "Multi-branch reporting", "Finance controls and AI tools"], recommended: true },
];

const fieldSx = { "& .MuiOutlinedInput-root": { minHeight: 54, bgcolor: "#fff", borderRadius: 1, "&.Mui-focused": { boxShadow: "0 0 0 4px rgba(21,127,115,.09)" } } } as const;

export default function RegisterPage() {
  const { register: registerUser } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [serverError, setServerError] = useState("");
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { control, handleSubmit, trigger, formState: { errors, isSubmitting } } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    mode: "onTouched",
    defaultValues: { churchName: "", churchCity: "", churchDenomination: "", averageWeeklyAttendance: "", ministryPriorities: [], requestedPlan: "free", firstName: "", lastName: "", email: "", phone: "", password: "", confirmPassword: "" },
  });

  const next = async () => {
    if (await trigger(steps[step].fields)) {
      setStep((current) => Math.min(current + 1, steps.length - 1));
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const onSubmit = async (data: RegisterFormData) => {
    setServerError("");
    try {
      await registerUser({
        email: data.email,
        name: `${data.firstName} ${data.lastName}`.trim(),
        phone: data.phone,
        password: data.password,
        churchName: data.churchName,
        churchCity: data.churchCity,
        churchDenomination: data.churchDenomination,
        averageWeeklyAttendance: Number(data.averageWeeklyAttendance),
        ministryPriorities: data.ministryPriorities,
        requestedPlan: data.requestedPlan,
      });
      setSuccess(true);
      window.setTimeout(() => navigate("/login"), 1800);
    } catch (error: unknown) {
      setServerError(error instanceof Error ? error.message : "We couldn't create the church. Please try again.");
    }
  };

  return (
    <AuthLayout title="Create your church" subtitle="A guided setup, built around how your ministry works." wide>
      <Box component="nav" aria-label="Registration progress" sx={{ display: "grid", gridTemplateColumns: `repeat(${steps.length}, 1fr)`, gap: .75, mb: 4 }}>
        {steps.map((item, index) => <Box key={item.label}><Box sx={{ height: 4, borderRadius: 4, bgcolor: index <= step ? "primary.main" : "#D8E5E0", transition: "background-color 220ms ease" }} /><Typography sx={{ mt: 1, fontSize: ".68rem", fontWeight: index === step ? 700 : 500, color: index <= step ? "text.primary" : "text.secondary" }}>{index + 1}. {item.label}</Typography></Box>)}
      </Box>

      {serverError && <Alert severity="error" sx={{ mb: 2.5 }}>{serverError}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2.5 }}>Your church workspace is ready. Taking you to sign in.</Alert>}

      <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <Box sx={{ mb: 3 }}>
          <Typography component="h3" sx={{ fontSize: { xs: "1.45rem", sm: "1.8rem" }, lineHeight: 1.1, letterSpacing: "-.035em", fontWeight: 720 }}>{steps[step].title}</Typography>
          <Typography color="text.secondary" sx={{ mt: 1, maxWidth: 590 }}>{steps[step].copy}</Typography>
        </Box>

        {step === 0 && <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
          <Controller name="churchName" control={control} render={({ field }) => <TextField {...field} label="Church name" autoFocus error={!!errors.churchName} helperText={errors.churchName?.message} sx={{ ...fieldSx, gridColumn: { sm: "1 / -1" } }} />} />
          <Controller name="churchCity" control={control} render={({ field }) => <TextField {...field} label="City or town" error={!!errors.churchCity} helperText={errors.churchCity?.message} sx={fieldSx} />} />
          <Controller name="churchDenomination" control={control} render={({ field }) => <TextField {...field} select label="Church tradition" error={!!errors.churchDenomination} helperText={errors.churchDenomination?.message} sx={fieldSx}>{["Charismatic / Pentecostal", "Evangelical", "Catholic", "Methodist", "Presbyterian", "Baptist", "Anglican", "Non-denominational", "Other"].map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</TextField>} />
          <Controller name="averageWeeklyAttendance" control={control} render={({ field }) => <TextField {...field} label="Average weekly attendance" inputMode="numeric" error={!!errors.averageWeeklyAttendance} helperText={errors.averageWeeklyAttendance?.message ?? "An estimate is fine"} sx={{ ...fieldSx, gridColumn: { sm: "1 / -1" } }} />} />
        </Box>}

        {step === 1 && <Controller name="ministryPriorities" control={control} render={({ field }) => <Box><Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.2 }}>{priorities.map((item) => { const selected = field.value.includes(item); return <ButtonBase key={item} onClick={() => field.onChange(selected ? field.value.filter((value) => value !== item) : field.value.length < 4 ? [...field.value, item] : field.value)} sx={{ justifyContent: "space-between", textAlign: "left", p: 2, minHeight: 66, borderRadius: 1, border: "1px solid", borderColor: selected ? "primary.main" : "divider", bgcolor: selected ? "rgba(21,127,115,.07)" : "#fff", transition: "all 180ms ease", "&:hover": { borderColor: "primary.main", transform: "translateY(-1px)" } }}><Box sx={{ display: "flex", alignItems: "center", gap: 1.3 }}><Groups2Rounded sx={{ color: selected ? "primary.main" : "text.secondary", fontSize: 20 }} /><Typography sx={{ fontSize: ".84rem", fontWeight: 650 }}>{item}</Typography></Box><Box sx={{ width: 22, height: 22, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: selected ? "primary.main" : "background.default", color: "white" }}>{selected && <CheckRounded sx={{ fontSize: 15 }} />}</Box></ButtonBase>; })}</Box>{errors.ministryPriorities && <Typography color="error.main" sx={{ mt: 1.2, fontSize: ".75rem" }}>{errors.ministryPriorities.message}</Typography>}<Typography sx={{ mt: 2, fontSize: ".72rem", color: "text.secondary" }}>{field.value.length} of 4 selected</Typography></Box>} />}

        {step === 2 && <Controller name="requestedPlan" control={control} render={({ field }) => <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }, gap: 1.3 }}>{plans.map((plan) => { const selected = field.value === plan.value; return <ButtonBase key={plan.value} onClick={() => field.onChange(plan.value)} sx={{ display: "flex", flexDirection: "column", alignItems: "stretch", textAlign: "left", p: 2.2, minHeight: 270, borderRadius: 2.5, border: "1px solid", borderColor: selected ? "primary.main" : "divider", bgcolor: selected ? "#0B2E2A" : "#fff", color: selected ? "white" : "text.primary", transition: "transform 180ms ease, border-color 180ms ease", "&:hover": { transform: "translateY(-3px)", borderColor: "primary.main" } }}><Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}><Typography variant="overline" sx={{ color: selected ? "primary.light" : "primary.main" }}>{plan.name}</Typography>{plan.recommended && <Chip label="Recommended" size="small" sx={{ fontSize: ".58rem", bgcolor: selected ? "primary.light" : "#DFF6F0", color: "primary.dark" }} />}</Box><Typography sx={{ mt: 2, fontSize: "1.65rem", fontWeight: 750, letterSpacing: "-.04em" }}>{plan.price}</Typography><Typography sx={{ fontSize: ".7rem", opacity: .6 }}>{plan.cadence}</Typography><Typography sx={{ mt: 1.5, fontSize: ".74rem", fontWeight: 650 }}>{plan.note}</Typography><Box sx={{ mt: 2, display: "grid", gap: .8 }}>{plan.features.map((feature) => <Box key={feature} sx={{ display: "flex", gap: .7 }}><CheckRounded sx={{ fontSize: 15, color: selected ? "primary.light" : "primary.main" }} /><Typography sx={{ fontSize: ".69rem", opacity: .78 }}>{feature}</Typography></Box>)}</Box><Box sx={{ mt: "auto", pt: 2, display: "flex", alignItems: "center", gap: .7, color: selected ? "primary.light" : "primary.main" }}><Box sx={{ width: 18, height: 18, borderRadius: "50%", border: "1px solid currentColor", display: "grid", placeItems: "center" }}>{selected && <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "currentColor" }} />}</Box><Typography sx={{ fontSize: ".7rem", fontWeight: 700 }}>{selected ? "Selected" : "Choose package"}</Typography></Box></ButtonBase>; })}<Typography sx={{ gridColumn: "1 / -1", mt: 1, fontSize: ".72rem", color: "text.secondary" }}>No card is required now. Starter activates immediately; paid packages remain pending until billing is confirmed.</Typography></Box>} />}

        {step === 3 && <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
          <Controller name="firstName" control={control} render={({ field }) => <TextField {...field} label="First name" autoFocus error={!!errors.firstName} helperText={errors.firstName?.message} sx={fieldSx} />} />
          <Controller name="lastName" control={control} render={({ field }) => <TextField {...field} label="Last name" error={!!errors.lastName} helperText={errors.lastName?.message} sx={fieldSx} />} />
          <Controller name="email" control={control} render={({ field }) => <TextField {...field} type="email" label="Work email" autoComplete="email" error={!!errors.email} helperText={errors.email?.message} sx={fieldSx} />} />
          <Controller name="phone" control={control} render={({ field }) => <TextField {...field} label="Phone number" autoComplete="tel" error={!!errors.phone} helperText={errors.phone?.message} sx={fieldSx} />} />
          <Controller name="password" control={control} render={({ field }) => <TextField {...field} label="Password" type={showPassword ? "text" : "password"} autoComplete="new-password" error={!!errors.password} helperText={errors.password?.message} slotProps={{ input: { endAdornment: <InputAdornment position="end"><IconButton onClick={() => setShowPassword((visible) => !visible)} edge="end" size="small" aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <VisibilityOff /> : <Visibility />}</IconButton></InputAdornment> } }} sx={fieldSx} />} />
          <Controller name="confirmPassword" control={control} render={({ field }) => <TextField {...field} label="Confirm password" type={showPassword ? "text" : "password"} autoComplete="new-password" error={!!errors.confirmPassword} helperText={errors.confirmPassword?.message} sx={fieldSx} />} />
        </Box>}

        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, mt: 4 }}>
          {step > 0 ? <Button type="button" onClick={() => setStep((current) => current - 1)} startIcon={<ArrowBackRounded />} sx={{ color: "text.secondary" }}>Back</Button> : <Typography sx={{ fontSize: ".76rem", color: "text.secondary" }}>Takes about 3 minutes</Typography>}
          {step < steps.length - 1 ? <Button type="button" variant="contained" onClick={() => void next()} endIcon={<ArrowForwardRounded />} sx={{ minWidth: 150, bgcolor: "primary.main", color: "white" }}>Continue</Button> : <Button type="submit" variant="contained" disabled={isSubmitting || success} endIcon={!isSubmitting ? <ArrowForwardRounded /> : undefined} sx={{ minWidth: 190, bgcolor: "primary.main", color: "white" }}>{isSubmitting ? "Creating workspace…" : "Create church"}</Button>}
        </Box>

        <Typography sx={{ textAlign: "center", mt: 4, fontSize: ".8rem", color: "text.secondary" }}>Already have an account? <Link component={RouterLink} to="/login" underline="hover" sx={{ fontWeight: 700 }}>Sign in</Link></Typography>
        <Typography sx={{ textAlign: "center", mt: 1.4, fontSize: ".67rem", color: "text.secondary" }}>By continuing, you agree to the Altar OS terms and privacy policy.</Typography>
      </Box>
    </AuthLayout>
  );
}
