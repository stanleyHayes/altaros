import React, { useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import axios from 'axios';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { useAuth } from '../../hooks/useAuth';
import givingService, { formatMoney, type GiveRequest, type GivingType, type PaymentChannel } from '../../services/giving.service';
import { borderRadius, colors, spacing, typography } from '../../theme';
import type { RootStackParamList } from '../../components/navigation/AppNavigator';

type GivingNav = NativeStackNavigationProp<RootStackParamList>;

const quickAmounts = [20, 50, 100, 200, 500];
const givingTypes: { value: GivingType; label: string }[] = [
  { value: 'tithe', label: 'Tithe' },
  { value: 'offering', label: 'Offering' },
  { value: 'donation', label: 'Donation' },
  { value: 'campaign', label: 'Campaign' },
  { value: 'pledge_payment', label: 'Pledge' },
];
const paymentMethods: { value: PaymentChannel; label: string; detail: string }[] = [
  { value: 'mobile_money', label: 'Mobile money', detail: 'MTN MoMo, Telecel Cash or AT Money' },
  { value: 'card', label: 'Bank card', detail: 'Visa or Mastercard' },
  { value: 'bank_transfer', label: 'Bank transfer', detail: 'Pay from your bank account' },
  { value: 'ussd', label: 'USSD', detail: 'Complete payment from your phone' },
];

function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError<{ error?: string; message?: string }>(error)) {
    return error.response?.data?.error ?? error.response?.data?.message ?? 'We could not start this gift.';
  }
  return error instanceof Error ? error.message : 'We could not start this gift.';
}

export function GivingScreen() {
  const navigation = useNavigation<GivingNav>();
  const { user } = useAuth();
  const [amount, setAmount] = useState('');
  const [selectedType, setSelectedType] = useState<GivingType>('tithe');
  const [selectedMethod, setSelectedMethod] = useState<PaymentChannel>('mobile_money');
  const [note, setNote] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleGive = async () => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError('Enter an amount greater than GHS 0.00.');
      return;
    }
    setError('');
    setIsSubmitting(true);
    try {
      const payload: GiveRequest = {
        amount: numericAmount.toFixed(2),
        currency: 'GHS',
        type: selectedType,
        channel: selectedMethod,
        email: user?.email || undefined,
        note: note.trim() || undefined,
        anonymous,
        callbackUrl: 'altaros://giving/complete',
      };
      const result = await givingService.give(payload);
      const levyLine = result.levy.exempt
        ? 'No E-Levy applies to this gift.'
        : `E-Levy: ${formatMoney(result.levy.levy.minor)}\n${result.levy.reason}`;
      const total = formatMoney(result.levy.total.minor, result.levy.total.currency);

      Alert.alert(
        'Review your gift',
        `${levyLine}\n\nTotal debit: ${total}`,
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Continue to payment',
            onPress: () => {
              if (result.authorizationUrl) void Linking.openURL(result.authorizationUrl);
              setAmount('');
              setNote('');
            },
          },
        ],
      );
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>DIRECT TO YOUR CHURCH</Text>
        <Text style={styles.title}>Give with clarity.</Text>
        <Text style={styles.subtitle}>Your gift settles to your church. Altar OS never holds church funds.</Text>
      </View>

      <Card style={styles.amountCard}>
        <Text style={styles.label}>Amount</Text>
        <View style={styles.amountRow}>
          <Text style={styles.currency}>GHS</Text>
          <Input
            placeholder="0.00"
            value={amount}
            onChangeText={(value) => { setAmount(value.replace(/[^0-9.]/g, '')); setError(''); }}
            keyboardType="decimal-pad"
            containerStyle={styles.amountInputContainer}
            style={styles.amountInput}
            accessibilityLabel="Gift amount in Ghana cedis"
          />
        </View>
        <View style={styles.quickAmounts}>
          {quickAmounts.map((value) => (
            <TouchableOpacity
              key={value}
              onPress={() => setAmount(String(value))}
              style={[styles.quickAmount, amount === String(value) && styles.quickAmountSelected]}
              accessibilityRole="button"
              accessibilityState={{ selected: amount === String(value) }}
            >
              <Text style={[styles.quickAmountText, amount === String(value) && styles.quickAmountTextSelected]}>{value}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Card>

      <View style={styles.section}>
        <Text style={styles.label}>This gift is for</Text>
        <View style={styles.chipRow}>
          {givingTypes.map((type) => (
            <TouchableOpacity key={type.value} onPress={() => setSelectedType(type.value)} style={[styles.chip, selectedType === type.value && styles.chipSelected]} accessibilityRole="button" accessibilityState={{ selected: selectedType === type.value }}>
              <Text style={[styles.chipText, selectedType === type.value && styles.chipTextSelected]}>{type.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>How would you like to pay?</Text>
        {paymentMethods.map((method, index) => {
          const selected = selectedMethod === method.value;
          return (
            <TouchableOpacity key={method.value} onPress={() => setSelectedMethod(method.value)} style={[styles.paymentRow, index > 0 && styles.paymentBorder]} accessibilityRole="radio" accessibilityState={{ selected }}>
              <View style={[styles.radio, selected && styles.radioSelected]}>{selected ? <View style={styles.radioDot} /> : null}</View>
              <View style={styles.paymentText}>
                <Text style={styles.paymentLabel}>{method.label}{method.value === 'mobile_money' ? ' · Recommended' : ''}</Text>
                <Text style={styles.paymentDetail}>{method.detail}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.section}>
        <Input label="Note (optional)" placeholder="What is this gift for?" value={note} onChangeText={setNote} maxLength={240} />
        <TouchableOpacity onPress={() => setAnonymous((value) => !value)} style={styles.anonymousRow} accessibilityRole="checkbox" accessibilityState={{ checked: anonymous }}>
          <View style={[styles.checkbox, anonymous && styles.checkboxSelected]}>{anonymous ? <Text style={styles.check}>✓</Text> : null}</View>
          <View style={styles.paymentText}>
            <Text style={styles.paymentLabel}>Give anonymously</Text>
            <Text style={styles.paymentDetail}>Your church will not see your name on this gift.</Text>
          </View>
        </TouchableOpacity>
      </View>

      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <Button title={amount ? `Continue with GHS ${amount}` : 'Enter an amount'} onPress={handleGive} loading={isSubmitting} disabled={!amount} fullWidth size="lg" />
      <TouchableOpacity onPress={() => navigation.navigate('GivingHistory')} style={styles.historyLink} accessibilityRole="link">
        <Text style={styles.historyText}>View giving history →</Text>
      </TouchableOpacity>
      <Text style={styles.secureNote}>Payments are processed securely by Paystack. Any levy is shown before you authorise payment.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { width: '100%', maxWidth: 680, alignSelf: 'center', padding: spacing.base, paddingBottom: spacing['4xl'] },
  hero: { backgroundColor: colors.text, borderRadius: borderRadius['2xl'], padding: spacing.xl, marginBottom: spacing.base },
  eyebrow: { color: colors.primaryLight, fontSize: typography.sizes.xs, fontWeight: typography.weights.bold, letterSpacing: 1.5 },
  title: { color: colors.surface, fontSize: typography.sizes['3xl'], lineHeight: 36, fontWeight: typography.weights.bold, letterSpacing: -1, marginTop: spacing.md },
  subtitle: { color: 'rgba(255,255,255,.68)', fontSize: typography.sizes.md, lineHeight: 21, marginTop: spacing.sm, maxWidth: 460 },
  amountCard: { marginBottom: spacing.xl, padding: spacing.lg },
  label: { color: colors.text, fontSize: typography.sizes.md, fontWeight: typography.weights.semibold, marginBottom: spacing.md },
  amountRow: { flexDirection: 'row', alignItems: 'center' },
  currency: { color: colors.primaryDark, fontSize: typography.sizes.md, fontWeight: typography.weights.bold, marginRight: spacing.md },
  amountInputContainer: { flex: 1, marginBottom: 0 },
  amountInput: { borderWidth: 0, paddingHorizontal: 0, fontSize: 34, fontWeight: typography.weights.bold, color: colors.text },
  quickAmounts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.base },
  quickAmount: { borderRadius: borderRadius.full, backgroundColor: colors.surfaceMuted, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  quickAmountSelected: { backgroundColor: colors.primary },
  quickAmountText: { color: colors.textSecondary, fontSize: typography.sizes.sm, fontWeight: typography.weights.semibold },
  quickAmountTextSelected: { color: colors.surface },
  section: { marginBottom: spacing.xl },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: borderRadius.full, paddingHorizontal: spacing.base, paddingVertical: spacing.sm, backgroundColor: colors.surface },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.secondaryLight },
  chipText: { color: colors.textSecondary, fontSize: typography.sizes.md },
  chipTextSelected: { color: colors.primaryDark, fontWeight: typography.weights.semibold },
  paymentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  paymentBorder: { borderTopWidth: 1, borderTopColor: colors.divider },
  radio: { width: 22, height: 22, borderWidth: 1.5, borderColor: colors.border, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  radioSelected: { borderColor: colors.primary },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary },
  paymentText: { flex: 1 },
  paymentLabel: { color: colors.text, fontSize: typography.sizes.md, fontWeight: typography.weights.semibold },
  paymentDetail: { color: colors.muted, fontSize: typography.sizes.sm, marginTop: 2 },
  anonymousRow: { flexDirection: 'row', alignItems: 'center', paddingTop: spacing.xs },
  checkbox: { width: 22, height: 22, borderWidth: 1.5, borderColor: colors.border, borderRadius: 6, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  checkboxSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  check: { color: colors.surface, fontSize: typography.sizes.sm, fontWeight: typography.weights.bold },
  error: { color: colors.error, fontSize: typography.sizes.sm, lineHeight: 19, marginBottom: spacing.base },
  historyLink: { alignItems: 'center', padding: spacing.base },
  historyText: { color: colors.primary, fontSize: typography.sizes.md, fontWeight: typography.weights.semibold },
  secureNote: { color: colors.muted, textAlign: 'center', fontSize: typography.sizes.xs, lineHeight: 18, paddingHorizontal: spacing.xl },
});
