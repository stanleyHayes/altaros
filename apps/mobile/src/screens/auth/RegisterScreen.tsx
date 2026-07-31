import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { useAuth } from '../../hooks/useAuth';
import { colors, typography, spacing } from '../../theme';
import type { AuthStackParamList } from '../../components/navigation/AppNavigator';

type RegisterNav = NativeStackNavigationProp<AuthStackParamList, 'Register'>;

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  churchCode: string;
}

export function RegisterScreen() {
  const navigation = useNavigation<RegisterNav>();
  const { register } = useAuth();

  const [form, setForm] = useState<FormState>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    churchCode: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>(
    {},
  );

  const updateField = (field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const validate = (): boolean => {
    const newErrors: typeof errors = {};
    if (!form.firstName.trim()) newErrors.firstName = 'First name is required';
    if (!form.lastName.trim()) newErrors.lastName = 'Last name is required';
    if (!form.email.trim()) newErrors.email = 'Email is required';
    if (!form.phone.trim()) newErrors.phone = 'Phone is required';
    if (form.password.length < 6)
      newErrors.password = 'Password must be at least 6 characters';
    if (form.password !== form.confirmPassword)
      newErrors.confirmPassword = 'Passwords do not match';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleRegister = async () => {
    if (!validate()) return;

    setIsLoading(true);
    try {
      await register({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        password: form.password,
        churchCode: form.churchCode.trim() || undefined,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Registration failed. Please try again.';
      Alert.alert('Registration Failed', message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>
            Join your church community on ALTAR OS
          </Text>
        </View>

        <View style={styles.form}>
          <View style={styles.row}>
            <Input
              label="First Name"
              placeholder="First name"
              value={form.firstName}
              onChangeText={(v) => updateField('firstName', v)}
              error={errors.firstName}
              containerStyle={styles.halfInput}
            />
            <Input
              label="Last Name"
              placeholder="Last name"
              value={form.lastName}
              onChangeText={(v) => updateField('lastName', v)}
              error={errors.lastName}
              containerStyle={styles.halfInput}
            />
          </View>

          <Input
            label="Email"
            placeholder="you@example.com"
            value={form.email}
            onChangeText={(v) => updateField('email', v)}
            autoCapitalize="none"
            keyboardType="email-address"
            error={errors.email}
          />

          <Input
            label="Phone"
            placeholder="+1 (555) 000-0000"
            value={form.phone}
            onChangeText={(v) => updateField('phone', v)}
            keyboardType="phone-pad"
            error={errors.phone}
          />

          <Input
            label="Password"
            placeholder="Minimum 6 characters"
            value={form.password}
            onChangeText={(v) => updateField('password', v)}
            secureTextEntry
            error={errors.password}
          />

          <Input
            label="Confirm Password"
            placeholder="Re-enter password"
            value={form.confirmPassword}
            onChangeText={(v) => updateField('confirmPassword', v)}
            secureTextEntry
            error={errors.confirmPassword}
          />

          <Input
            label="Church Code (Optional)"
            placeholder="Enter your church code"
            value={form.churchCode}
            onChangeText={(v) => updateField('churchCode', v)}
            autoCapitalize="characters"
          />

          <Button
            title="Create Account"
            onPress={handleRegister}
            loading={isLoading}
            fullWidth
            size="lg"
          />

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <Text
              style={styles.link}
              onPress={() => navigation.navigate('Login')}
            >
              Sign In
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flexGrow: 1,
    padding: spacing.xl,
    paddingTop: spacing['3xl'],
  },
  header: {
    marginBottom: spacing['2xl'],
  },
  title: {
    fontSize: typography.sizes['2xl'],
    fontWeight: typography.weights.bold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: typography.sizes.base,
    color: colors.muted,
  },
  form: {
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  halfInput: {
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  footerText: {
    fontSize: typography.sizes.md,
    color: colors.muted,
  },
  link: {
    fontSize: typography.sizes.md,
    color: colors.primary,
    fontWeight: typography.weights.semibold,
  },
});
