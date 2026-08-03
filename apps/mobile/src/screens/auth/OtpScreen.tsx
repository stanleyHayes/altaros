import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Alert,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Button } from '../../components/common/Button';
import { useAuth } from '../../hooks/useAuth';
import { colors, typography, spacing, borderRadius } from '../../theme';
import type { AuthStackParamList } from '../../components/navigation/AppNavigator';
import authService, { canonicalPhone, canonicalWorkspace } from '../../services/auth.service';
import { otpDigitLayout } from './otp-layout';
import {
  OTP_RESEND_DELAY_MS,
  otpCodeInputState,
  otpJourneyKey,
  otpResendSeconds,
  otpResendFailure,
  otpResendActionState,
  otpVerificationFailure,
  otpVerifyActionState,
  ownsOtpJourney,
} from './otp-state';
import { createSubmissionLock } from '../../services/submission-lock';
import { formKeyboardProps } from '../../components/common/form-keyboard';
import { useKnownOffline } from '../../hooks/useKnownOffline';
import { useAnimatedRouteTop } from '../../hooks/useAnimatedRouteTop';

const OTP_LENGTH = 6;

type OtpRoute = RouteProp<AuthStackParamList, 'Otp'>;
type OtpNavigation = NativeStackNavigationProp<AuthStackParamList, 'Otp'>;

export function OtpScreen() {
  const route = useRoute<OtpRoute>();
  const navigation = useNavigation<OtpNavigation>();
  const { width: viewportWidth } = useWindowDimensions();
  const { verifyOtp } = useAuth();
  const offline = useKnownOffline();
  const scrollRef = useRef<ScrollView>(null);
  useAnimatedRouteTop(scrollRef);
  const { codeRequested = true, deliveryUnconfirmed = false } = route.params;
  const phone = typeof route.params.phone === 'string' ? canonicalPhone(route.params.phone) : null;
  const workspace = canonicalWorkspace(route.params.workspace);
  const validRoute = phone !== null && workspace !== null;
  const initialCodeRequested = codeRequested && validRoute;
  const journeyKey = otpJourneyKey(phone, workspace, codeRequested, deliveryUnconfirmed);

  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [error, setError] = useState(validRoute ? '' : 'This verification request has an invalid mobile number. Return to sign in and request a new code.');
  const [resendAvailableAt, setResendAvailableAt] = useState(
    initialCodeRequested ? Date.now() + OTP_RESEND_DELAY_MS : 0,
  );
  const [timerNow, setTimerNow] = useState(Date.now);
  const [hasRequestedCode, setHasRequestedCode] = useState(initialCodeRequested);
  const [verificationOutcomeUnknown, setVerificationOutcomeUnknown] = useState(false);
  const inputRefs = useRef<(TextInput | null)[]>([]);
  const otpMutationLock = useRef(createSubmissionLock());
  const mountedRef = useRef(true);
  const activeJourneyRef = useRef(journeyKey);
  activeJourneyRef.current = journeyKey;
  const digitLayout = otpDigitLayout(viewportWidth);
  const codeInputState = otpCodeInputState(hasRequestedCode, isLoading, isResending);
  const resendAction = otpResendActionState(validRoute, offline, isResending, isLoading);
  const verifyAction = otpVerifyActionState(
    validRoute,
    offline,
    hasRequestedCode,
    verificationOutcomeUnknown,
    otp.every(Boolean),
    isResending,
    isLoading,
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    otpMutationLock.current = createSubmissionLock();
    setOtp(Array(OTP_LENGTH).fill(''));
    setIsLoading(false);
    setIsResending(false);
    setError(validRoute ? '' : 'This verification request has an invalid mobile number. Return to sign in and request a new code.');
    setHasRequestedCode(initialCodeRequested);
    setVerificationOutcomeUnknown(false);
    const now = Date.now();
    setTimerNow(now);
    setResendAvailableAt(initialCodeRequested ? now + OTP_RESEND_DELAY_MS : 0);
  }, [initialCodeRequested, journeyKey, validRoute]);

  useEffect(() => {
    // Auto-focus first input
    if (hasRequestedCode) inputRefs.current[0]?.focus();
  }, [hasRequestedCode]);

  const resendTimer = otpResendSeconds(resendAvailableAt, timerNow);

  useEffect(() => {
    if (resendTimer <= 0) return undefined;
    const timer = setTimeout(() => setTimerNow(Date.now()), 1_000);
    return () => clearTimeout(timer);
  }, [resendTimer]);

  const handleOtpChange = (value: string, index: number) => {
    setError('');
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
    newOtp[index] = value.replace(/\D/g, '').slice(-1);
    setOtp(newOtp);

    if (newOtp[index] && index < OTP_LENGTH - 1) {
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
    if (!phone || !workspace) {
      setError('This verification request has an invalid mobile number. Return to sign in and request a new code.');
      return;
    }
    const code = otp.join('');
    if (code.length !== OTP_LENGTH) {
      setError('Enter the full 6-digit code.');
      return;
    }
    const mutationLock = otpMutationLock.current;
    if (!mutationLock.acquire()) return;
    const startedJourney = journeyKey;

    setIsLoading(true);
    try {
      await verifyOtp({ phone, otp: code, workspace }, () => mountedRef.current
        && ownsOtpJourney(activeJourneyRef.current, startedJourney));
    } catch (error: unknown) {
      if (mountedRef.current && ownsOtpJourney(activeJourneyRef.current, startedJourney)) {
        const failure = otpVerificationFailure(error);
        if (failure.outcomeUnknown) {
          setVerificationOutcomeUnknown(true);
          setHasRequestedCode(false);
          setOtp(Array(OTP_LENGTH).fill(''));
          setResendAvailableAt(0);
          setTimerNow(Date.now());
        }
        setError(failure.message);
      }
    } finally {
      if (mountedRef.current && ownsOtpJourney(activeJourneyRef.current, startedJourney)) {
        setIsLoading(false);
      }
      mutationLock.release();
    }
  };

  const handleResend = async () => {
    if (!phone || !workspace) {
      setError('This verification request has an invalid mobile number. Return to sign in and request a new code.');
      return;
    }
    const mutationLock = otpMutationLock.current;
    if (!mutationLock.acquire()) return;
    const startedJourney = journeyKey;
    setIsResending(true);
    setError('');
    try {
      await authService.requestOtp(phone, workspace);
      if (!mountedRef.current || !ownsOtpJourney(activeJourneyRef.current, startedJourney)) return;
      setHasRequestedCode(true);
      setVerificationOutcomeUnknown(false);
      const now = Date.now();
      setTimerNow(now);
      setResendAvailableAt(now + OTP_RESEND_DELAY_MS);
      setOtp(Array(OTP_LENGTH).fill(''));
      inputRefs.current[0]?.focus();
      Alert.alert(
        'Code requested',
        deliveryUnconfirmed
          ? 'If this number belongs to a member account, a new verification code has been sent.'
          : 'A new verification code has been sent.',
      );
    } catch (resendError) {
      if (mountedRef.current && ownsOtpJourney(activeJourneyRef.current, startedJourney)) {
        const failure = otpResendFailure(resendError);
        if (failure.deliveryUnknown) {
          setHasRequestedCode(true);
          setVerificationOutcomeUnknown(false);
          const now = Date.now();
          setTimerNow(now);
          setResendAvailableAt(now + OTP_RESEND_DELAY_MS);
          setOtp(Array(OTP_LENGTH).fill(''));
        }
        setError(failure.message);
      }
    } finally {
      if (mountedRef.current && ownsOtpJourney(activeJourneyRef.current, startedJourney)) {
        setIsResending(false);
      }
      mutationLock.release();
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />
      <ScrollView ref={scrollRef} contentContainerStyle={styles.container} {...formKeyboardProps(Platform.OS)} bounces={false}>
        <View style={styles.ambientTop} importantForAccessibility="no-hide-descendants" />
        <View style={styles.ambientBottom} importantForAccessibility="no-hide-descendants" />
        <View style={styles.journey}>
          <View style={styles.brandRow} accessibilityRole="header">
            <View style={styles.brandMark} importantForAccessibility="no-hide-descendants">
              <Ionicons name="leaf-outline" size={23} color={colors.text} />
            </View>
            <Text style={styles.brand}>ALTAR <Text style={styles.brandAccent}>OS</Text></Text>
          </View>
          <View style={styles.stageCard}>
            <View style={styles.verificationMark} importantForAccessibility="no-hide-descendants">
              <Ionicons name="finger-print-outline" size={29} color={colors.primaryDark} />
            </View>
            <View style={styles.header}>
              <Text style={styles.eyebrow}>ONE LAST STEP</Text>
              <Text style={styles.title} accessibilityRole="header">Check your phone</Text>
              <Text style={styles.subtitle}>
                {hasRequestedCode
                  ? deliveryUnconfirmed
                    ? 'If this number belongs to a member account, we sent a 6-digit code to'
                    : 'Enter the 6-digit code we sent to'
                  : deliveryUnconfirmed
                    ? 'We could not confirm account creation. Request a code to check this number'
                    : 'Request a code to continue verification'}{'\n'}
                <Text style={styles.phone}>{phone ?? 'Invalid mobile number'}</Text>
              </Text>
            </View>
            <View style={[styles.otpContainer, { gap: digitLayout.gap }]}>
              {otp.map((digit, index) => (
                <TextInput
                  key={index}
                  ref={(ref) => { inputRefs.current[index] = ref; }}
                  style={[styles.otpInput, { width: digitLayout.width, height: digitLayout.height }, digit && styles.otpInputFilled]}
                  value={digit}
                  onChangeText={(v) => handleOtpChange(v, index)}
                  onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, index)}
                  keyboardType="number-pad"
                  maxLength={index === 0 ? OTP_LENGTH : 1}
                  selectTextOnFocus
                  editable={codeInputState.editable}
                  textContentType={index === 0 ? 'oneTimeCode' : 'none'}
                  autoComplete={index === 0 ? 'sms-otp' : 'off'}
                  accessibilityLabel={`Code digit ${index + 1} of ${OTP_LENGTH}`}
                  accessibilityHint={index === 0 ? 'You can paste the complete code here' : undefined}
                  accessibilityState={codeInputState.accessibilityState}
                />
              ))}
            </View>
            {error ? (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.error} importantForAccessibility="no" />
                <Text style={styles.error} accessibilityRole="alert">{error}</Text>
              </View>
            ) : null}
            <Button
              title={verifyAction.label}
              onPress={handleVerify}
              loading={isLoading}
              fullWidth
              size="lg"
              disabled={verifyAction.disabled}
              accessibilityHint={verifyAction.hint}
            />
            <View style={styles.resendContainer}>
              {resendTimer > 0 ? (
                <View style={styles.timerRow}>
                  <Ionicons name="time-outline" size={16} color={colors.muted} importantForAccessibility="no" />
                  <Text style={styles.resendTimer}>Request another code in {resendTimer}s</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.resendButton, resendAction.disabled && styles.actionDisabled]}
                  onPress={() => void handleResend()}
                  disabled={resendAction.disabled}
                  accessibilityRole="button"
                  accessibilityLabel={resendAction.label}
                  accessibilityHint={resendAction.hint}
                  accessibilityState={{ busy: resendAction.busy, disabled: resendAction.disabled }}
                >
                  <Text style={styles.resendPrompt}>Didn&apos;t receive it? </Text>
                  <Text style={styles.resendLink}>{resendAction.label}</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.securityRow}>
              <Ionicons name="shield-checkmark-outline" size={17} color={colors.primary} importantForAccessibility="no" />
              <Text style={styles.securityText}>Codes expire quickly and can only be used once.</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.changeNumber}
            onPress={() => navigation.popTo('Login')}
            disabled={isLoading || isResending}
            accessibilityRole="link"
            accessibilityState={{ disabled: isLoading || isResending }}
            accessibilityHint="Returns to sign in so you can enter another mobile number"
          >
            <Ionicons name="arrow-back" size={17} color={colors.primaryLight} importantForAccessibility="no" />
            <Text style={styles.changeNumberText}>Use another number</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.text },
  container: { flexGrow: 1, width: '100%', minHeight: '100%', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', backgroundColor: colors.text, paddingHorizontal: spacing.lg, paddingVertical: spacing['2xl'] },
  ambientTop: { position: 'absolute', width: 260, height: 260, borderRadius: 130, backgroundColor: '#17423D', top: -130, right: -90 },
  ambientBottom: { position: 'absolute', width: 220, height: 220, borderRadius: 110, borderWidth: 1, borderColor: '#28504A', bottom: -120, left: -80 },
  journey: { width: '100%', maxWidth: 560 },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  brandMark: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  brand: { color: colors.surface, fontFamily: typography.families.bold, fontSize: typography.sizes.xl, letterSpacing: -0.4 },
  brandAccent: { color: colors.primaryLight },
  stageCard: { width: '100%', borderRadius: 30, alignItems: 'center', backgroundColor: colors.background, padding: spacing.xl, shadowColor: '#061513', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.28, shadowRadius: 30, elevation: 10 },
  verificationMark: { width: 58, height: 58, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondaryLight, marginBottom: spacing.base },
  header: { alignItems: 'center', marginBottom: spacing.xl },
  eyebrow: { color: colors.primary, fontFamily: typography.families.bold, fontSize: typography.sizes.xs, letterSpacing: 1.4, marginBottom: spacing.sm },
  title: { fontSize: typography.sizes['3xl'], fontFamily: typography.families.bold, color: colors.text, letterSpacing: -0.8, lineHeight: 35, marginBottom: spacing.sm },
  subtitle: { fontSize: typography.sizes.base, fontFamily: typography.families.regular, color: colors.textSecondary, textAlign: 'center', lineHeight: 23 },
  phone: { fontFamily: typography.families.semibold, color: colors.text },
  otpContainer: { width: '100%', flexDirection: 'row', justifyContent: 'center', marginBottom: spacing.lg },
  otpInput: { borderWidth: 2, borderColor: colors.border, borderRadius: borderRadius.lg, textAlign: 'center', fontSize: typography.sizes.xl, fontFamily: typography.families.bold, color: colors.text, backgroundColor: colors.surface },
  otpInputFilled: { borderColor: colors.primary, backgroundColor: colors.secondaryLight },
  errorBanner: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, borderRadius: borderRadius.md, backgroundColor: '#FFF1F0', padding: spacing.md, marginBottom: spacing.base },
  error: { flex: 1, color: colors.error, fontFamily: typography.families.medium, fontSize: typography.sizes.sm, lineHeight: 19 },
  resendContainer: { alignItems: 'center', marginTop: spacing.base },
  resendButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  timerRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  actionDisabled: { opacity: 0.5 },
  resendTimer: { fontSize: typography.sizes.md, fontFamily: typography.families.medium, color: colors.muted },
  resendPrompt: { fontSize: typography.sizes.md, fontFamily: typography.families.regular, color: colors.textSecondary },
  resendLink: { fontSize: typography.sizes.md, color: colors.primary, fontFamily: typography.families.semibold },
  securityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.md },
  securityText: { flexShrink: 1, color: colors.textSecondary, fontFamily: typography.families.medium, fontSize: typography.sizes.sm, lineHeight: 18 },
  changeNumber: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, marginTop: spacing.sm },
  changeNumberText: { color: colors.primaryLight, fontFamily: typography.families.semibold, fontSize: typography.sizes.md },
});
