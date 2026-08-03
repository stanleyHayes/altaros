import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  AccessibilityInfo,
  Platform,
  Alert,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { useAuth } from '../../hooks/useAuth';
import { colors, typography, spacing } from '../../theme';
import type { AuthStackParamList } from '../../components/navigation/AppNavigator';
import authService, { canonicalPhone, MAX_AUTH_EMAIL_LENGTH, MAX_AUTH_NAME_LENGTH, MAX_AUTH_PASSWORD_LENGTH, MAX_AUTH_PHONE_INPUT_LENGTH, MAX_CHURCH_CODE_LENGTH, OtpDeliveryUnknownError, RegistrationOutcomeUnknownError, type RegistrationChurch } from '../../services/auth.service';
import { apiErrorMessage } from '../../services/api-error';
import { createSubmissionLock } from '../../services/submission-lock';
import { shouldUseInlineRegistrationNameFields } from './auth-layout';
import { useKnownOffline } from '../../hooks/useKnownOffline';
import { routeScrollShouldAnimate } from '../../hooks/useAnimatedRouteTop';
import { formKeyboardProps } from '../../components/common/form-keyboard';
import {
  canonicalChurchCodeInput,
  firstInvalidRegistrationStep,
  ownsRegistrationLookup,
  REGISTRATION_STEPS,
  registrationChurchActionState,
  registrationErrorsForStep,
  registrationProgressValue,
  registrationRemovalDecision,
  unknownRegistrationRecoveryParams,
  type RegistrationFormValues,
  type RegistrationStep,
} from './registration-state';

type RegisterNav = NativeStackNavigationProp<AuthStackParamList, 'Register'>;

const STEP_ICONS = [
  'person-outline',
  'chatbubble-ellipses-outline',
  'lock-closed-outline',
  'home-outline',
] as const;

export function RegisterScreen() {
  const navigation = useNavigation<RegisterNav>();
  const { register } = useAuth();
  const offline = useKnownOffline();
  const { width: viewportWidth } = useWindowDimensions();
  const inlineNameFields = shouldUseInlineRegistrationNameFields(viewportWidth);

  const [form, setForm] = useState<RegistrationFormValues>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    churchCode: '',
  });
  const [step, setStep] = useState<RegistrationStep>(0);
  const scrollRef = useRef<ScrollView>(null);
  const lastNameRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isResolvingChurch, setIsResolvingChurch] = useState(false);
  const [resolvedChurch, setResolvedChurch] = useState<RegistrationChurch | null>(null);
  const submissionLock = useRef(createSubmissionLock());
  const churchLookupLock = useRef(createSubmissionLock());
  const mountedRef = useRef(true);
  const churchCodeRef = useRef(form.churchCode);
  const churchRevisionRef = useRef(0);
  const explicitExitRef = useRef(false);
  const [errors, setErrors] = useState<Partial<Record<keyof RegistrationFormValues, string>>>(
    {},
  );

  churchCodeRef.current = form.churchCode;
  const churchActions = registrationChurchActionState(
    offline,
    isResolvingChurch,
    isLoading,
    Boolean(form.churchCode.trim()),
    Boolean(resolvedChurch),
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const updateField = (field: keyof RegistrationFormValues, value: string) => {
    if (field === 'churchCode') {
      churchRevisionRef.current += 1;
      churchCodeRef.current = value;
    }
    setForm((prev) => ({ ...prev, [field]: value }));
    if (field === 'churchCode') setResolvedChurch(null);
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const scrollStepToTop = () => {
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduceMotionEnabled) => {
        if (mountedRef.current) {
          scrollRef.current?.scrollTo({
            y: 0,
            animated: routeScrollShouldAnimate(reduceMotionEnabled),
          });
        }
      });
  };

  const goToStep = (nextStep: RegistrationStep) => {
    setStep(nextStep);
    setErrors({});
    scrollStepToTop();
  };

  const handleContinue = () => {
    const stepErrors = registrationErrorsForStep(step, form, resolvedChurch);
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length > 0 || step === 3) return;
    goToStep((step + 1) as RegistrationStep);
  };

  usePreventRemove(step > 0 || isLoading, ({ data }) => {
    const decision = registrationRemovalDecision(step, isLoading, explicitExitRef.current);
    if (decision.kind === 'allow') {
      navigation.dispatch(data.action);
    } else if (decision.kind === 'step') {
      goToStep(decision.step);
    }
  });

  const handleResolveChurch = async () => {
    if (!churchLookupLock.current.acquire()) return;
    const code = form.churchCode.trim();
    const startedRevision = churchRevisionRef.current;
    setResolvedChurch(null);
    setErrors((current) => ({ ...current, churchCode: undefined }));
    setIsResolvingChurch(true);
    try {
      const church = await authService.resolveChurchCode(code);
      if (mountedRef.current && ownsRegistrationLookup(
        churchRevisionRef.current,
        startedRevision,
        churchCodeRef.current,
        code,
      )) {
        setResolvedChurch(church);
      }
    } catch (error: unknown) {
      if (mountedRef.current && ownsRegistrationLookup(
        churchRevisionRef.current,
        startedRevision,
        churchCodeRef.current,
        code,
      )) {
        setErrors((current) => ({
          ...current,
          churchCode: apiErrorMessage(
            error,
            'We could not find an active church with that code. Check it with your church office.',
          ),
        }));
      }
    } finally {
      if (mountedRef.current) setIsResolvingChurch(false);
      churchLookupLock.current.release();
    }
  };

  const handleRegister = async () => {
    if (!submissionLock.current.acquire()) return;
    const invalid = firstInvalidRegistrationStep(form, resolvedChurch);
    if (invalid) {
      setStep(invalid.step);
      setErrors(invalid.errors);
      scrollStepToTop();
      submissionLock.current.release();
      return;
    }

    setIsLoading(true);
    try {
      const registeredPhone = await register({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        password: form.password,
        churchCode: canonicalChurchCodeInput(form.churchCode) || undefined,
        confirmedChurchId: resolvedChurch?.id,
      });
      const phone = canonicalPhone(registeredPhone);
      if (!phone) throw new Error('The server returned an invalid phone number.');
      const workspace = canonicalChurchCodeInput(form.churchCode);
      if (!mountedRef.current) return;
      try {
        await authService.requestOtp(phone, workspace);
        if (mountedRef.current) {
          explicitExitRef.current = true;
          navigation.replace('Otp', { phone, workspace, codeRequested: true });
        }
      } catch (dispatchError) {
        // The account already exists at this point. Keep the member in the
        // verification journey instead of presenting a misleading registration
        // failure or encouraging a duplicate signup. Unknown delivery starts
        // the cooldown; explicit rejection leaves the request action available.
        if (mountedRef.current) {
          explicitExitRef.current = true;
          navigation.replace('Otp', {
            phone,
            workspace,
            codeRequested: dispatchError instanceof OtpDeliveryUnknownError,
            deliveryUnconfirmed: dispatchError instanceof OtpDeliveryUnknownError,
          });
        }
      }
    } catch (error: unknown) {
      if (error instanceof RegistrationOutcomeUnknownError) {
        const recovery = unknownRegistrationRecoveryParams(form.phone, form.churchCode);
        if (recovery) {
          let codeRequested = false;
          let deliveryUnconfirmed = false;
          try {
            await authService.requestOtp(recovery.phone, recovery.workspace);
            codeRequested = true;
          } catch (dispatchError) {
            if (dispatchError instanceof OtpDeliveryUnknownError) {
              codeRequested = true;
              deliveryUnconfirmed = true;
            }
            // Explicit rejection keeps the request action immediately available;
            // unknown delivery starts the normal cooldown.
          }
          if (mountedRef.current) {
            explicitExitRef.current = true;
            navigation.replace('Otp', { ...recovery, codeRequested, deliveryUnconfirmed });
          }
          return;
        }
      }
      const message = apiErrorMessage(error, 'Registration failed. Please try again.');
      if (mountedRef.current) Alert.alert('Registration Failed', message);
    } finally {
      if (mountedRef.current) setIsLoading(false);
      submissionLock.current.release();
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style="light" />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.container}
        {...formKeyboardProps(Platform.OS)}
        bounces={false}
      >
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
            <View style={styles.stepMeta}>
              <View style={styles.stepIcon} importantForAccessibility="no-hide-descendants">
                <Ionicons name={STEP_ICONS[step]} size={22} color={colors.primaryDark} />
              </View>
              <View
                style={styles.progress}
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel={`Create account, step ${step + 1} of ${REGISTRATION_STEPS.length}: ${REGISTRATION_STEPS[step].title}`}
                accessibilityValue={registrationProgressValue(step)}
              >
                <Text style={styles.progressLabel}>STEP {step + 1} OF {REGISTRATION_STEPS.length}</Text>
                <View style={styles.progressTrack} importantForAccessibility="no-hide-descendants">
                  {REGISTRATION_STEPS.map((item, index) => (
                    <View key={item.title} style={[styles.progressSegment, index <= step && styles.progressSegmentActive]} />
                  ))}
                </View>
              </View>
            </View>

            <View style={styles.header}>
              <Text style={styles.title} accessibilityRole="header">{REGISTRATION_STEPS[step].title}</Text>
              <Text style={styles.subtitle}>{REGISTRATION_STEPS[step].subtitle}</Text>
            </View>

            <View style={styles.form}>
              {step === 0 ? (
                <View style={[styles.row, !inlineNameFields && styles.rowStacked]}>
                  <Input
                    autoFocus
                    label="First name"
                    placeholder="e.g. Ama"
                    value={form.firstName}
                    onChangeText={(v) => updateField('firstName', v)}
                    error={errors.firstName}
                    containerStyle={styles.halfInput}
                    textContentType="givenName"
                    autoComplete="given-name"
                    editable={!isLoading}
                    maxLength={MAX_AUTH_NAME_LENGTH}
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => lastNameRef.current?.focus()}
                  />
                  <Input
                    ref={lastNameRef}
                    label="Last name"
                    placeholder="e.g. Mensah"
                    value={form.lastName}
                    onChangeText={(v) => updateField('lastName', v)}
                    error={errors.lastName}
                    containerStyle={styles.halfInput}
                    textContentType="familyName"
                    autoComplete="family-name"
                    editable={!isLoading}
                    maxLength={MAX_AUTH_NAME_LENGTH}
                    returnKeyType="done"
                    onSubmitEditing={handleContinue}
                  />
                </View>
              ) : null}

              {step === 1 ? <>
                <Input
                  autoFocus
                  label="Email address"
                  placeholder="you@example.com"
                  value={form.email}
                  onChangeText={(v) => updateField('email', v)}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  error={errors.email}
                  textContentType="emailAddress"
                  autoComplete="email"
                  editable={!isLoading}
                  maxLength={MAX_AUTH_EMAIL_LENGTH}
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => phoneRef.current?.focus()}
                />

                <Input
                  ref={phoneRef}
                  label="Mobile number"
                  placeholder="+233 24 123 4567"
                  value={form.phone}
                  onChangeText={(v) => updateField('phone', v)}
                  keyboardType="phone-pad"
                  error={errors.phone}
                  textContentType="telephoneNumber"
                  autoComplete="tel"
                  editable={!isLoading}
                  maxLength={MAX_AUTH_PHONE_INPUT_LENGTH}
                  returnKeyType="done"
                  onSubmitEditing={handleContinue}
                />
              </> : null}

              {step === 2 ? <>
                <Input
                  autoFocus
                  label="Create password"
                  placeholder="At least 8 characters"
                  value={form.password}
                  onChangeText={(v) => updateField('password', v)}
                  secureTextEntry
                  error={errors.password}
                  textContentType="newPassword"
                  autoComplete="new-password"
                  editable={!isLoading}
                  maxLength={MAX_AUTH_PASSWORD_LENGTH}
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => confirmPasswordRef.current?.focus()}
                />
                <Input
                  ref={confirmPasswordRef}
                  label="Confirm password"
                  placeholder="Type it once more"
                  value={form.confirmPassword}
                  onChangeText={(v) => updateField('confirmPassword', v)}
                  secureTextEntry
                  error={errors.confirmPassword}
                  textContentType="newPassword"
                  autoComplete="new-password"
                  editable={!isLoading}
                  maxLength={MAX_AUTH_PASSWORD_LENGTH}
                  returnKeyType="done"
                  onSubmitEditing={handleContinue}
                />
              </> : null}

              {step === 3 ? <>
                <Input
                  autoFocus
                  label="Church code"
                  placeholder="e.g. grace-chapel-accra"
                  value={form.churchCode}
                  onChangeText={(v) => updateField('churchCode', v)}
                  autoCapitalize="characters"
                  error={errors.churchCode}
                  autoCorrect={false}
                  editable={!isLoading && !isResolvingChurch}
                  maxLength={MAX_CHURCH_CODE_LENGTH}
                  returnKeyType="search"
                  onSubmitEditing={() => {
                    if (!offline && form.churchCode.trim()) void handleResolveChurch();
                  }}
                />

                {resolvedChurch ? (
                  <Card style={styles.churchConfirmation}>
                    <View style={styles.confirmedRow}>
                      <View style={styles.confirmedMark} importantForAccessibility="no-hide-descendants">
                        <Ionicons name="checkmark" size={18} color={colors.surface} />
                      </View>
                      <View style={styles.confirmedContent}>
                        <Text style={styles.confirmedEyebrow}>CHURCH CONFIRMED</Text>
                        <Text style={styles.confirmedName} accessibilityRole="header">
                          {resolvedChurch.name}
                        </Text>
                        <Text style={styles.confirmedCode}>{resolvedChurch.slug}</Text>
                      </View>
                    </View>
                    <Text style={styles.confirmedHelp}>
                      Your account will join this church community. Edit the code above to choose another church.
                    </Text>
                  </Card>
                ) : (
                  <Button
                    title={churchActions.lookup.label}
                    variant="outline"
                    onPress={() => void handleResolveChurch()}
                    loading={isResolvingChurch}
                    disabled={churchActions.lookup.disabled}
                    accessibilityHint={churchActions.lookup.hint}
                    fullWidth
                  />
                )}

                <View style={styles.navigationRow}>
                  <Button
                    title="Back"
                    variant="outline"
                    onPress={() => goToStep(2)}
                    disabled={isLoading || isResolvingChurch}
                    style={styles.backButton}
                  />
                  <Button
                    title={churchActions.submit.label}
                    onPress={handleRegister}
                    loading={isLoading}
                    size="lg"
                    disabled={churchActions.submit.disabled}
                    accessibilityHint={churchActions.submit.hint}
                    style={styles.primaryButton}
                  />
                </View>
              </> : (
                <View style={styles.navigationRow}>
                  {step > 0 ? (
                    <Button
                      title="Back"
                      variant="outline"
                      onPress={() => goToStep((step - 1) as RegistrationStep)}
                      disabled={isLoading}
                      style={styles.backButton}
                    />
                  ) : null}
                  <Button
                    title={step === 0 ? 'Start my account' : 'Continue'}
                    onPress={handleContinue}
                    disabled={isLoading}
                    size="lg"
                    style={styles.primaryButton}
                    accessibilityHint={`Continues to ${REGISTRATION_STEPS[step + 1].title}`}
                  />
                </View>
              )}
            </View>

            <View style={styles.reassurance}>
              <Ionicons name="shield-checkmark-outline" size={17} color={colors.primary} />
              <Text style={styles.reassuranceText}>Your details stay private to your church community.</Text>
            </View>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <TouchableOpacity
              style={styles.footerLink}
              onPress={() => {
                explicitExitRef.current = true;
                navigation.popTo('Login');
              }}
              disabled={isLoading}
              accessibilityRole="link"
              accessibilityState={{ disabled: isLoading }}
            >
              <Text style={styles.link}>Sign In</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.text,
  },
  container: {
    flexGrow: 1,
    width: '100%',
    minHeight: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing['2xl'],
  },
  ambientTop: { position: 'absolute', width: 260, height: 260, borderRadius: 130, backgroundColor: '#17423D', top: -130, right: -90 },
  ambientBottom: { position: 'absolute', width: 220, height: 220, borderRadius: 110, borderWidth: 1, borderColor: '#28504A', bottom: -120, left: -80 },
  journey: { width: '100%', maxWidth: 560 },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  brandMark: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  brand: { color: colors.surface, fontFamily: typography.families.bold, fontSize: typography.sizes.xl, letterSpacing: -0.4 },
  brandAccent: { color: colors.primaryLight },
  stageCard: { width: '100%', borderRadius: 30, backgroundColor: colors.background, padding: spacing.xl, shadowColor: '#061513', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.28, shadowRadius: 30, elevation: 10 },
  stepMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  stepIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondaryLight },
  progress: { flex: 1 },
  progressLabel: { color: colors.primary, fontFamily: typography.families.bold, fontSize: typography.sizes.xs, letterSpacing: 1.4 },
  progressTrack: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
  progressSegment: { flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.border },
  progressSegmentActive: { backgroundColor: colors.primary },
  header: { marginBottom: spacing.xl },
  title: {
    fontSize: typography.sizes['3xl'],
    fontFamily: typography.families.bold,
    color: colors.text,
    letterSpacing: -0.8,
    lineHeight: 35,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: typography.sizes.base,
    fontFamily: typography.families.regular,
    color: colors.textSecondary,
    lineHeight: 23,
    maxWidth: 420,
  },
  form: { width: '100%' },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowStacked: {
    flexDirection: 'column',
    gap: 0,
  },
  halfInput: {
    flex: 1,
  },
  churchConfirmation: {
    padding: spacing.md,
    marginBottom: spacing.base,
    backgroundColor: colors.secondaryLight,
  },
  confirmedRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  confirmedMark: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  confirmedContent: { flex: 1 },
  confirmedEyebrow: {
    color: colors.primary,
    fontFamily: typography.families.bold,
    fontSize: typography.sizes.xs,
    letterSpacing: 1.2,
  },
  confirmedName: {
    color: colors.text,
    fontSize: typography.sizes.lg,
    fontFamily: typography.families.bold,
    marginTop: spacing.xs,
  },
  confirmedCode: {
    color: colors.primaryDark,
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.semibold,
    marginTop: 2,
  },
  confirmedHelp: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.regular,
    lineHeight: 19,
    marginTop: spacing.sm,
  },
  navigationRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  backButton: { flex: 0.42 },
  primaryButton: { flex: 1 },
  reassurance: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.lg },
  reassuranceText: { flexShrink: 1, color: colors.textSecondary, fontFamily: typography.families.medium, fontSize: typography.sizes.sm, lineHeight: 18 },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  footerText: {
    fontSize: typography.sizes.md,
    fontFamily: typography.families.regular,
    color: '#B8CAC6',
  },
  footerLink: {
    minHeight: 44,
    justifyContent: 'center',
  },
  link: {
    fontSize: typography.sizes.md,
    color: colors.primaryLight,
    fontFamily: typography.families.semibold,
  },
});
