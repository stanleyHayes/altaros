import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import { useAuth } from "@/hooks/useAuth";
import AuthService from "@/services/auth.service";
import AuthLayout from "@/components/auth/AuthLayout";

const OTP_LENGTH = 6;

interface OtpLocationState {
  phone?: string;
  email?: string;
}

export default function OtpPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { verifyOtp } = useAuth();

  const state = (location.state as OtpLocationState) || {};
  const contact = state.phone || state.email || "";

  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState(60);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Redirect if no contact info was provided
  useEffect(() => {
    if (!contact) {
      navigate("/login", { replace: true });
    }
  }, [contact, navigate]);

  // Auto-focus first input
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  // Countdown timer
  useEffect(() => {
    if (resendTimer > 0) {
      const timer = setTimeout(() => setResendTimer((t) => t - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendTimer]);

  const handleOtpChange = useCallback(
    (value: string, index: number) => {
      // Handle paste (multi-character input)
      if (value.length > 1) {
        const digits = value.replace(/\D/g, "").split("").slice(0, OTP_LENGTH);
        const newOtp = [...otp];
        digits.forEach((d, i) => {
          if (index + i < OTP_LENGTH) newOtp[index + i] = d;
        });
        setOtp(newOtp);
        const nextIndex = Math.min(index + digits.length, OTP_LENGTH - 1);
        inputRefs.current[nextIndex]?.focus();
        return;
      }

      // Only allow digits
      if (value && !/^\d$/.test(value)) return;

      const newOtp = [...otp];
      newOtp[index] = value;
      setOtp(newOtp);

      if (value && index < OTP_LENGTH - 1) {
        inputRefs.current[index + 1]?.focus();
      }
    },
    [otp],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
      if (e.key === "Backspace" && !otp[index] && index > 0) {
        inputRefs.current[index - 1]?.focus();
        const newOtp = [...otp];
        newOtp[index - 1] = "";
        setOtp(newOtp);
      }
    },
    [otp],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const pasted = e.clipboardData.getData("text").replace(/\D/g, "");
      if (!pasted) return;
      const digits = pasted.split("").slice(0, OTP_LENGTH);
      const newOtp = [...otp];
      digits.forEach((d, i) => {
        if (i < OTP_LENGTH) newOtp[i] = d;
      });
      setOtp(newOtp);
      const focusIndex = Math.min(digits.length, OTP_LENGTH - 1);
      inputRefs.current[focusIndex]?.focus();
    },
    [otp],
  );

  const handleVerify = async () => {
    const code = otp.join("");
    if (code.length !== OTP_LENGTH) {
      setError("Please enter the full 6-digit code.");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      await verifyOtp({ email: contact, code });
      navigate("/", { replace: true });
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Verification failed. Please try again.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      setError(null);
      if (state.phone) {
        await AuthService.requestOtp(state.phone);
      }
      setResendTimer(60);
    } catch {
      setError("Failed to resend code. Please try again.");
    }
  };

  const isComplete = otp.every((d) => d !== "");

  return (
    <AuthLayout
      title="Verify Your Phone"
      subtitle="Enter the 6-digit code we sent"
    >
      <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
        <IconButton
          onClick={() => navigate("/login")}
          size="small"
          sx={{ mr: 1, color: "#757575" }}
        >
          <ArrowBackRoundedIcon />
        </IconButton>
        <Typography variant="body2" sx={{ color: "#757575" }}>
          Back to login
        </Typography>
      </Box>

      <Typography
        variant="body2"
        sx={{ mb: 3, textAlign: "center", color: "#757575" }}
      >
        We sent a 6-digit code to{" "}
        <Typography
          component="span"
          variant="body2"
          fontWeight={600}
          sx={{ color: "#6B4C9A" }}
        >
          {contact}
        </Typography>
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2, borderRadius: "12px" }}>
          {error}
        </Alert>
      )}

      {/* OTP Input Boxes */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          gap: 1.5,
          mb: 3,
        }}
        onPaste={handlePaste}
      >
        {otp.map((digit, index) => (
          <Box
            key={index}
            component="input"
            ref={(el: HTMLInputElement | null) => {
              inputRefs.current[index] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={index === 0 ? OTP_LENGTH : 1}
            value={digit}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              handleOtpChange(e.target.value, index)
            }
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) =>
              handleKeyDown(e, index)
            }
            onFocus={(e: React.FocusEvent<HTMLInputElement>) =>
              e.target.select()
            }
            sx={{
              width: 48,
              height: 56,
              border: 2,
              borderStyle: "solid",
              borderColor: digit ? "#6B4C9A" : "#E0E0E0",
              borderRadius: "12px",
              textAlign: "center",
              fontSize: "1.25rem",
              fontWeight: 700,
              color: "#1A1A2E",
              bgcolor: "#fff",
              outline: "none",
              caretColor: "#6B4C9A",
              transition: "border-color 0.2s ease, box-shadow 0.2s ease",
              "&:focus": {
                borderColor: "#6B4C9A",
                boxShadow: "0 0 0 3px rgba(107,76,154,0.15)",
              },
            }}
          />
        ))}
      </Box>

      <Button
        variant="contained"
        size="large"
        fullWidth
        onClick={handleVerify}
        disabled={!isComplete || isLoading}
        sx={{
          py: 1.5,
          mb: 2,
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
        {isLoading ? (
          <CircularProgress size={24} sx={{ color: "#1A1A2E" }} />
        ) : (
          "Verify"
        )}
      </Button>

      <Box sx={{ textAlign: "center" }}>
        {resendTimer > 0 ? (
          <Typography variant="body2" sx={{ color: "#9E9E9E" }}>
            Resend code in {resendTimer}s
          </Typography>
        ) : (
          <Button
            variant="text"
            size="small"
            onClick={handleResend}
            sx={{ fontWeight: 600, color: "#6B4C9A", textTransform: "none" }}
          >
            Resend Code
          </Button>
        )}
      </Box>
    </AuthLayout>
  );
}
