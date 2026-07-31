import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { Button } from '../../components/common/Button';
import { useAuth } from '../../hooks/useAuth';
import { colors, typography, spacing, borderRadius } from '../../theme';
import type { AuthStackParamList } from '../../components/navigation/AppNavigator';
import authService from '../../services/auth.service';

const OTP_LENGTH = 6;

type OtpRoute = RouteProp<AuthStackParamList, 'Otp'>;

export function OtpScreen() {
  const route = useRoute<OtpRoute>();
  const { verifyOtp } = useAuth();
  const { phone } = route.params;

  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [isLoading, setIsLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(60);
  const inputRefs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    // Auto-focus first input
    inputRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (resendTimer > 0) {
      const timer = setTimeout(() => setResendTimer((t) => t - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendTimer]);

  const handleOtpChange = (value: string, index: number) => {
    if (value.length > 1) {
      // Handle paste
      const digits = value.replace(/\D/g, '').split('').slice(0, OTP_LENGTH);
      const newOtp = [...otp];
      digits.forEach((d, i) => {
        if (index + i < OTP_LENGTH) newOtp[index + i] = d;
      });
      setOtp(newOtp);
      const nextIndex = Math.min(index + digits.length, OTP_LENGTH - 1);
      inputRefs.current[nextIndex]?.focus();
      return;
    }

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    if (value && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (key: string, index: number) => {
    if (key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
      const newOtp = [...otp];
      newOtp[index - 1] = '';
      setOtp(newOtp);
    }
  };

  const handleVerify = async () => {
    const code = otp.join('');
    if (code.length !== OTP_LENGTH) {
      Alert.alert('Invalid Code', 'Please enter the full 6-digit code.');
      return;
    }

    setIsLoading(true);
    try {
      await verifyOtp({ phone, otp: code });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Verification failed. Please try again.';
      Alert.alert('Verification Failed', message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      await authService.requestOtp(phone);
      setResendTimer(60);
      Alert.alert('Code Sent', 'A new verification code has been sent.');
    } catch {
      Alert.alert('Error', 'Failed to resend code. Please try again.');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Verify Your Phone</Text>
        <Text style={styles.subtitle}>
          We sent a 6-digit code to{'\n'}
          <Text style={styles.phone}>{phone}</Text>
        </Text>
      </View>

      <View style={styles.otpContainer}>
        {otp.map((digit, index) => (
          <TextInput
            key={index}
            ref={(ref) => {
              inputRefs.current[index] = ref;
            }}
            style={[styles.otpInput, digit && styles.otpInputFilled]}
            value={digit}
            onChangeText={(v) => handleOtpChange(v, index)}
            onKeyPress={({ nativeEvent }) =>
              handleKeyPress(nativeEvent.key, index)
            }
            keyboardType="number-pad"
            maxLength={index === 0 ? OTP_LENGTH : 1}
            selectTextOnFocus
          />
        ))}
      </View>

      <Button
        title="Verify"
        onPress={handleVerify}
        loading={isLoading}
        fullWidth
        size="lg"
        disabled={otp.some((d) => !d)}
      />

      <View style={styles.resendContainer}>
        {resendTimer > 0 ? (
          <Text style={styles.resendTimer}>
            Resend code in {resendTimer}s
          </Text>
        ) : (
          <TouchableOpacity onPress={handleResend}>
            <Text style={styles.resendLink}>Resend Code</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.xl,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing['3xl'],
  },
  title: {
    fontSize: typography.sizes['2xl'],
    fontWeight: typography.weights.bold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: typography.sizes.base,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 22,
  },
  phone: {
    fontWeight: typography.weights.semibold,
    color: colors.text,
  },
  otpContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing['2xl'],
  },
  otpInput: {
    width: 48,
    height: 56,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    textAlign: 'center',
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  otpInputFilled: {
    borderColor: colors.primary,
  },
  resendContainer: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  resendTimer: {
    fontSize: typography.sizes.md,
    color: colors.muted,
  },
  resendLink: {
    fontSize: typography.sizes.md,
    color: colors.primary,
    fontWeight: typography.weights.semibold,
  },
});
