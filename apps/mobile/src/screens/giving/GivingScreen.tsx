import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import type { RootStackParamList } from '../../components/navigation/AppNavigator';
import type { GiveRequest } from '../../services/giving.service';

type GivingNav = NativeStackNavigationProp<RootStackParamList>;

const quickAmounts = [10, 25, 50, 100, 250, 500];

const givingTypes: { value: GiveRequest['type']; label: string }[] = [
  { value: 'tithe', label: 'Tithe' },
  { value: 'offering', label: 'Offering' },
  { value: 'donation', label: 'Donation' },
  { value: 'pledge', label: 'Pledge' },
  { value: 'building_fund', label: 'Building Fund' },
];

const paymentMethods: { value: GiveRequest['paymentMethod']; label: string }[] = [
  { value: 'card', label: 'Credit/Debit Card' },
  { value: 'bank', label: 'Bank Transfer' },
  { value: 'mobile_money', label: 'Mobile Money' },
];

export function GivingScreen() {
  const navigation = useNavigation<GivingNav>();
  const [amount, setAmount] = useState('');
  const [selectedType, setSelectedType] =
    useState<GiveRequest['type']>('tithe');
  const [selectedMethod, setSelectedMethod] =
    useState<GiveRequest['paymentMethod']>('card');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleQuickAmount = (value: number) => {
    setAmount(value.toString());
  };

  const handleGive = async () => {
    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount.');
      return;
    }

    setIsSubmitting(true);
    try {
      // TODO: Replace with givingService.give()
      await new Promise<void>((resolve) => { setTimeout(() => resolve(), 1000); });
      Alert.alert(
        'Thank You!',
        `Your ${selectedType} of $${numericAmount.toFixed(2)} has been processed.`,
        [{ text: 'OK', onPress: () => setAmount('') }],
      );
    } catch {
      Alert.alert('Error', 'Failed to process your giving. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Give Generously</Text>
        <Text style={styles.headerSubtitle}>
          "Each of you should give what you have decided in your heart to give."
          {'\n'}-- 2 Corinthians 9:7
        </Text>
      </View>

      {/* Amount Input */}
      <View style={styles.section}>
        <View style={styles.amountContainer}>
          <Text style={styles.currency}>$</Text>
          <Input
            placeholder="0.00"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            containerStyle={styles.amountInput}
            style={styles.amountText}
          />
        </View>

        {/* Quick Amounts */}
        <View style={styles.quickAmounts}>
          {quickAmounts.map((qa) => (
            <TouchableOpacity
              key={qa}
              style={[
                styles.quickAmountBtn,
                amount === qa.toString() && styles.quickAmountBtnActive,
              ]}
              onPress={() => handleQuickAmount(qa)}
            >
              <Text
                style={[
                  styles.quickAmountText,
                  amount === qa.toString() && styles.quickAmountTextActive,
                ]}
              >
                ${qa}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Giving Type */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Giving Type</Text>
        <View style={styles.typeOptions}>
          {givingTypes.map((type) => (
            <TouchableOpacity
              key={type.value}
              style={[
                styles.typeChip,
                selectedType === type.value && styles.typeChipActive,
              ]}
              onPress={() => setSelectedType(type.value)}
            >
              <Text
                style={[
                  styles.typeChipText,
                  selectedType === type.value && styles.typeChipTextActive,
                ]}
              >
                {type.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Payment Method */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Payment Method</Text>
        {paymentMethods.map((method) => (
          <TouchableOpacity
            key={method.value}
            style={[
              styles.paymentOption,
              selectedMethod === method.value && styles.paymentOptionActive,
            ]}
            onPress={() => setSelectedMethod(method.value)}
          >
            <View
              style={[
                styles.radio,
                selectedMethod === method.value && styles.radioActive,
              ]}
            >
              {selectedMethod === method.value && (
                <View style={styles.radioInner} />
              )}
            </View>
            <Text style={styles.paymentLabel}>{method.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Note */}
      <View style={styles.section}>
        <Input
          label="Note (Optional)"
          placeholder="Add a note..."
          value={note}
          onChangeText={setNote}
        />
      </View>

      {/* Submit */}
      <View style={styles.submitSection}>
        <Button
          title={`Give $${amount || '0.00'}`}
          onPress={handleGive}
          loading={isSubmitting}
          fullWidth
          size="lg"
          disabled={!amount || parseFloat(amount) <= 0}
        />

        <TouchableOpacity
          style={styles.historyLink}
          onPress={() => navigation.navigate('GivingHistory')}
        >
          <Text style={styles.historyLinkText}>View Giving History</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing['2xl'],
    borderBottomLeftRadius: borderRadius['2xl'],
    borderBottomRightRadius: borderRadius['2xl'],
  },
  headerTitle: {
    fontSize: typography.sizes['2xl'],
    fontWeight: typography.weights.bold,
    color: '#FFFFFF',
    marginBottom: spacing.sm,
  },
  headerSubtitle: {
    fontSize: typography.sizes.md,
    color: 'rgba(255,255,255,0.8)',
    fontStyle: 'italic',
    lineHeight: 20,
  },
  section: {
    paddingHorizontal: spacing.xl,
    marginTop: spacing.xl,
  },
  amountContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  currency: {
    fontSize: typography.sizes['3xl'],
    fontWeight: typography.weights.bold,
    color: colors.text,
    marginRight: spacing.sm,
  },
  amountInput: {
    flex: 1,
    marginBottom: 0,
  },
  amountText: {
    fontSize: typography.sizes['2xl'],
    fontWeight: typography.weights.bold,
  },
  quickAmounts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  quickAmountBtn: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  quickAmountBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  quickAmountText: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.medium,
    color: colors.textSecondary,
  },
  quickAmountTextActive: {
    color: '#FFFFFF',
  },
  sectionLabel: {
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.semibold,
    color: colors.text,
    marginBottom: spacing.md,
  },
  typeOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  typeChip: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  typeChipActive: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary,
  },
  typeChipText: {
    fontSize: typography.sizes.md,
    color: colors.textSecondary,
  },
  typeChipTextActive: {
    color: '#FFFFFF',
    fontWeight: typography.weights.medium,
  },
  paymentOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  paymentOptionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight + '10',
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    marginRight: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: {
    borderColor: colors.primary,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  paymentLabel: {
    fontSize: typography.sizes.base,
    color: colors.text,
  },
  submitSection: {
    padding: spacing.xl,
    paddingBottom: spacing['3xl'],
  },
  historyLink: {
    alignItems: 'center',
    marginTop: spacing.base,
  },
  historyLinkText: {
    fontSize: typography.sizes.md,
    color: colors.primary,
    fontWeight: typography.weights.semibold,
  },
});
