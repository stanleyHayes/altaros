import React, { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { useAuth } from '../../hooks/useAuth';
import authService, { canonicalPhone, MAX_AUTH_EMAIL_LENGTH, MAX_AUTH_PASSWORD_LENGTH, MAX_AUTH_PHONE_INPUT_LENGTH } from '../../services/auth.service';
import { borderRadius, colors, spacing, typography } from '../../theme';
import type { AuthStackParamList } from '../../components/navigation/AppNavigator';
import { apiErrorMessage } from '../../services/api-error';
import { createSubmissionLock } from '../../services/submission-lock';
import { useKnownOffline } from '../../hooks/useKnownOffline';
import { credentialStorageCopy, sessionPlatform } from '../../services/session-copy';
import { loginErrors, type LoginFormValues, type LoginMethod } from './login-state';

type LoginNav = NativeStackNavigationProp<AuthStackParamList, 'Login'>;
export function LoginScreen() {
  const navigation = useNavigation<LoginNav>();
  const { login } = useAuth();
  const offline = useKnownOffline();
  const [method, setMethod] = useState<LoginMethod>('phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof LoginFormValues, string>>>({});
  const submissionLock = useRef(createSubmissionLock());
  const mountedRef = useRef(true);
  const passwordRef = useRef<TextInput>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const handleContinue = async () => {
    if (!submissionLock.current.acquire()) return;
    setFormError('');
    const errors = loginErrors(method, { phone, email, password });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      submissionLock.current.release();
      return;
    }
    try {
      if (method === 'phone') {
        const normalizedPhone = canonicalPhone(phone) as string;
        setIsLoading(true);
        try {
          await authService.requestOtp(normalizedPhone);
          if (mountedRef.current) navigation.navigate('Otp', { phone: normalizedPhone, deliveryUnconfirmed: true });
        } catch (error) {
          if (mountedRef.current) setFormError(apiErrorMessage(error, 'We could not send a code. Check your connection and try again.'));
        } finally {
          if (mountedRef.current) setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      try {
        await login(
          { email: email.trim().toLowerCase(), password, method: 'PASSWORD' },
          () => mountedRef.current,
        );
      } catch (error) {
        if (mountedRef.current) setFormError(apiErrorMessage(error, 'We could not sign you in. Check your details and try again.'));
      } finally {
        if (mountedRef.current) setIsLoading(false);
      }
    } finally {
      submissionLock.current.release();
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" bounces={false}>
        <View style={styles.hero}>
          <View style={styles.brandRow}>
            <View style={styles.mark}><Ionicons name="leaf-outline" size={25} color={colors.text} /></View>
            <Text style={styles.brand}>ALTAR <Text style={styles.brandAccent}>OS</Text></Text>
          </View>
          <View style={styles.intro}>
            <Text style={styles.eyebrow}>MEMBER SPACE</Text>
            <Text style={styles.title}>Your church.{`\n`}Still close.</Text>
            <Text style={styles.subtitle}>Give, join events and stay connected through the week.</Text>
          </View>
          <View style={styles.trustRow}>
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.primaryLight} />
            <Text style={styles.trustText}>Private by design. Built for church communities.</Text>
          </View>
        </View>

        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Sign in</Text>
          <Text style={styles.sheetBody}>Use your mobile number for the quickest way back.</Text>
          <View style={styles.methodSwitch} accessibilityRole="tablist">
            {(['phone', 'password'] as const).map((item) => {
              const selected = method === item;
              return (
                <TouchableOpacity
                  key={item}
                  onPress={() => { setMethod(item); setFormError(''); setFieldErrors({}); }}
                  disabled={isLoading}
                  style={[styles.methodButton, selected && styles.methodButtonSelected]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected, disabled: isLoading }}
                >
                  <Text style={[styles.methodText, selected && styles.methodTextSelected]}>
                    {item === 'phone' ? 'Phone code' : 'Password'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {method === 'phone' ? (
            <Input
              label="Mobile number"
              placeholder="+233 24 123 4567"
              value={phone}
              onChangeText={(value) => {
                setPhone(value);
                setFieldErrors((current) => ({ ...current, phone: undefined }));
                setFormError('');
              }}
              keyboardType="phone-pad"
              error={fieldErrors.phone}
              textContentType="telephoneNumber"
              autoComplete="tel"
              editable={!isLoading}
              maxLength={MAX_AUTH_PHONE_INPUT_LENGTH}
              returnKeyType="done"
              onSubmitEditing={() => { void handleContinue(); }}
            />
          ) : (
            <>
              <Input
                label="Email"
                placeholder="you@example.com"
                value={email}
                onChangeText={(value) => {
                  setEmail(value);
                  setFieldErrors((current) => ({ ...current, email: undefined }));
                  setFormError('');
                }}
                autoCapitalize="none"
                keyboardType="email-address"
                error={fieldErrors.email}
                textContentType="emailAddress"
                autoComplete="email"
                editable={!isLoading}
                maxLength={MAX_AUTH_EMAIL_LENGTH}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
              <Input
                ref={passwordRef}
                label="Password"
                placeholder="Your password"
                value={password}
                onChangeText={(value) => {
                  setPassword(value);
                  setFieldErrors((current) => ({ ...current, password: undefined }));
                  setFormError('');
                }}
                secureTextEntry
                error={fieldErrors.password}
                textContentType="password"
                autoComplete="current-password"
                editable={!isLoading}
                maxLength={MAX_AUTH_PASSWORD_LENGTH}
                returnKeyType="done"
                onSubmitEditing={() => { void handleContinue(); }}
              />
            </>
          )}

          {formError ? <Text style={styles.formError} accessibilityRole="alert">{formError}</Text> : null}
          <Button
            title={method === 'phone' ? 'Send my code' : 'Sign in'}
            onPress={handleContinue}
            loading={isLoading}
            disabled={offline}
            accessibilityHint={offline
              ? method === 'phone'
                ? 'Reconnect to request a sign-in code.'
                : 'Reconnect to sign in.'
              : undefined}
            fullWidth
            size="lg"
          />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>New to Altar OS? </Text>
          <TouchableOpacity style={styles.footerLink} onPress={() => navigation.navigate('Register')} disabled={isLoading} accessibilityRole="link" accessibilityState={{ disabled: isLoading }}>
            <Text style={styles.link}>Create an account</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.securityNote}>
          {credentialStorageCopy(sessionPlatform(Platform.OS))}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.text },
  container: { flexGrow: 1, width: '100%', maxWidth: 620, alignSelf: 'center', backgroundColor: colors.background },
  hero: { minHeight: 330, backgroundColor: colors.text, paddingHorizontal: spacing.xl, paddingTop: spacing['3xl'], paddingBottom: spacing['2xl'], justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mark: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  brand: { fontSize: typography.sizes.lg, fontFamily: typography.families.bold, color: colors.surface, letterSpacing: -.6 },
  brandAccent: { color: colors.primaryLight },
  intro: { marginVertical: spacing['2xl'] },
  eyebrow: { color: colors.primaryLight, fontSize: typography.sizes.xs, fontFamily: typography.families.bold, letterSpacing: 1.5, marginBottom: spacing.md },
  title: { color: colors.surface, fontSize: 42, lineHeight: 44, fontFamily: typography.families.bold, letterSpacing: -1.7 },
  subtitle: { color: 'rgba(247,251,248,.68)', fontSize: typography.sizes.base, lineHeight: 23, marginTop: spacing.md, maxWidth: 380 },
  trustRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  trustText: { color: 'rgba(247,251,248,.7)', fontSize: typography.sizes.sm, flex: 1 },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, marginTop: -24, paddingHorizontal: spacing.xl, paddingTop: spacing['2xl'], paddingBottom: spacing.xl },
  sheetTitle: { color: colors.text, fontSize: typography.sizes['2xl'], fontFamily: typography.families.bold, letterSpacing: -.8 },
  sheetBody: { color: colors.textSecondary, fontSize: typography.sizes.md, lineHeight: 21, marginTop: spacing.xs, marginBottom: spacing.xl },
  methodSwitch: { flexDirection: 'row', padding: 4, backgroundColor: colors.surfaceMuted, borderRadius: borderRadius.md, marginBottom: spacing.xl },
  methodButton: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.sm, borderRadius: borderRadius.sm },
  methodButtonSelected: { backgroundColor: colors.surface },
  methodText: { color: colors.textSecondary, fontSize: typography.sizes.md, fontFamily: typography.families.medium },
  methodTextSelected: { color: colors.primaryDark, fontFamily: typography.families.semibold },
  formError: { color: colors.error, fontSize: typography.sizes.sm, lineHeight: 19, marginBottom: spacing.base },
  footer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', marginTop: spacing.xl },
  footerLink: { minHeight: 44, justifyContent: 'center' },
  footerText: { color: colors.muted, fontSize: typography.sizes.md },
  link: { color: colors.primary, fontSize: typography.sizes.md, fontFamily: typography.families.semibold },
  securityNote: { color: colors.muted, fontSize: typography.sizes.xs, textAlign: 'center', marginTop: spacing.xl, lineHeight: 18 },
});
