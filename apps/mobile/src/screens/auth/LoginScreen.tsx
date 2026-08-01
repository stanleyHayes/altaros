import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import axios from 'axios';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { useAuth } from '../../hooks/useAuth';
import authService from '../../services/auth.service';
import { borderRadius, colors, spacing, typography } from '../../theme';
import type { AuthStackParamList } from '../../components/navigation/AppNavigator';

type LoginNav = NativeStackNavigationProp<AuthStackParamList, 'Login'>;
type LoginMethod = 'phone' | 'password';

function errorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError<{ error?: string; message?: string }>(error)) {
    return error.response?.data?.error ?? error.response?.data?.message ?? fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

export function LoginScreen() {
  const navigation = useNavigation<LoginNav>();
  const { login } = useAuth();
  const [method, setMethod] = useState<LoginMethod>('phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [formError, setFormError] = useState('');

  const handleContinue = async () => {
    setFormError('');
    if (method === 'phone') {
      const normalizedPhone = phone.replace(/[\s()-]/g, '');
      if (!/^\+?[0-9]{9,15}$/.test(normalizedPhone)) {
        setFormError('Enter a valid mobile number, including the country code.');
        return;
      }
      setIsLoading(true);
      try {
        await authService.requestOtp(normalizedPhone);
        navigation.navigate('Otp', { phone: normalizedPhone });
      } catch (error) {
        setFormError(errorMessage(error, 'We could not send a code. Check your connection and try again.'));
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (!email.trim() || password.length < 6) {
      setFormError('Enter your email and password to continue.');
      return;
    }
    setIsLoading(true);
    try {
      await login({ email: email.trim().toLowerCase(), password, method: 'PASSWORD' });
    } catch (error) {
      setFormError(errorMessage(error, 'We could not sign you in. Check your details and try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.brandRow}>
          <View style={styles.mark}>
            <View style={styles.markCircle} />
            <View style={styles.markStem} />
          </View>
          <Text style={styles.brand}>ALTAR <Text style={styles.brandAccent}>OS</Text></Text>
        </View>

        <View style={styles.intro}>
          <Text style={styles.eyebrow}>YOUR CHURCH, THROUGH THE WEEK</Text>
          <Text style={styles.title}>Welcome back.</Text>
          <Text style={styles.subtitle}>Sign in to give, join events, pray with others, and stay close to your church.</Text>
        </View>

        <View style={styles.formCard}>
          <View style={styles.methodSwitch} accessibilityRole="tablist">
            {(['phone', 'password'] as const).map((item) => {
              const selected = method === item;
              return (
                <TouchableOpacity
                  key={item}
                  onPress={() => { setMethod(item); setFormError(''); }}
                  style={[styles.methodButton, selected && styles.methodButtonSelected]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
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
              onChangeText={setPhone}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
            />
          ) : (
            <>
              <Input
                label="Email"
                placeholder="you@example.com"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
              />
              <Input
                label="Password"
                placeholder="Your password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType="password"
                autoComplete="current-password"
              />
            </>
          )}

          {formError ? <Text style={styles.formError} accessibilityRole="alert">{formError}</Text> : null}
          <Button
            title={method === 'phone' ? 'Send my code' : 'Sign in'}
            onPress={handleContinue}
            loading={isLoading}
            fullWidth
            size="lg"
          />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>New to Altar OS? </Text>
          <Text style={styles.link} onPress={() => navigation.navigate('Register')} accessibilityRole="link">Create an account</Text>
        </View>
        <Text style={styles.securityNote}>Your session is encrypted and stored securely on this device.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, justifyContent: 'center', width: '100%', maxWidth: 520, alignSelf: 'center', padding: spacing.xl, paddingVertical: spacing['3xl'] },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing['3xl'] },
  mark: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.text, overflow: 'hidden' },
  markCircle: { position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primaryLight, left: 8, top: 8 },
  markStem: { position: 'absolute', width: 9, height: 19, borderRadius: 5, backgroundColor: colors.text, left: 14.5, bottom: 0 },
  brand: { fontSize: typography.sizes.lg, fontWeight: typography.weights.bold, color: colors.text, letterSpacing: -.6 },
  brandAccent: { color: colors.primary },
  intro: { marginBottom: spacing['2xl'] },
  eyebrow: { color: colors.primary, fontSize: typography.sizes.xs, fontWeight: typography.weights.bold, letterSpacing: 1.5, marginBottom: spacing.md },
  title: { color: colors.text, fontSize: 40, lineHeight: 44, fontWeight: typography.weights.bold, letterSpacing: -1.5 },
  subtitle: { color: colors.textSecondary, fontSize: typography.sizes.base, lineHeight: 24, marginTop: spacing.md, maxWidth: 440 },
  formCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: borderRadius['2xl'], padding: spacing.lg },
  methodSwitch: { flexDirection: 'row', padding: 4, backgroundColor: colors.surfaceMuted, borderRadius: borderRadius.md, marginBottom: spacing.xl },
  methodButton: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: borderRadius.sm },
  methodButtonSelected: { backgroundColor: colors.surface },
  methodText: { color: colors.textSecondary, fontSize: typography.sizes.md, fontWeight: typography.weights.medium },
  methodTextSelected: { color: colors.primaryDark, fontWeight: typography.weights.semibold },
  formError: { color: colors.error, fontSize: typography.sizes.sm, lineHeight: 19, marginBottom: spacing.base },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.xl },
  footerText: { color: colors.muted, fontSize: typography.sizes.md },
  link: { color: colors.primary, fontSize: typography.sizes.md, fontWeight: typography.weights.semibold },
  securityNote: { color: colors.muted, fontSize: typography.sizes.xs, textAlign: 'center', marginTop: spacing.xl },
});
