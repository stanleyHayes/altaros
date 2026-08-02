import React, { useEffect, useRef, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { useAuth } from '../../hooks/useAuth';
import { useKnownOffline } from '../../hooks/useKnownOffline';
import givingService, { canonicalGiftAmount, formatMoney, safeCheckoutUrl, type GiveRequest, type GivingType, type PaymentChannel } from '../../services/giving.service';
import { createSubmissionLock } from '../../services/submission-lock';
import { borderRadius, colors, spacing, typography } from '../../theme';
import type { RootStackParamList } from '../../components/navigation/AppNavigator';
import { useAnimatedRouteTop } from '../../hooks/useAnimatedRouteTop';
import { apiErrorMessage } from '../../services/api-error';
import { Ionicons } from '@expo/vector-icons';

type GivingNav = NativeStackNavigationProp<RootStackParamList>;

interface GivingIdentity {
  churchId?: string;
  memberId?: string;
}

export function canContinueGivingCheckout(
  active: GivingIdentity,
  startedChurchId: string,
  startedMemberId: string,
  offline: boolean,
): boolean {
  return !offline && givingAttemptBelongsToIdentity(active, startedChurchId, startedMemberId, true);
}

export function givingAttemptBelongsToIdentity(
  active: GivingIdentity,
  startedChurchId: string,
  startedMemberId: string,
  mounted: boolean,
): boolean {
  return mounted
    && active.churchId === startedChurchId
    && active.memberId === startedMemberId;
}

const quickAmounts = [20, 50, 100, 200, 500];
const givingTypes: { value: GivingType; label: string }[] = [
  { value: 'tithe', label: 'Tithe' },
  { value: 'offering', label: 'Offering' },
  { value: 'donation', label: 'Donation' },
  { value: 'campaign', label: 'Campaign' },
  { value: 'pledge_payment', label: 'Pledge' },
];
const paymentMethods: { value: PaymentChannel; label: string; detail: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { value: 'mobile_money', label: 'Mobile money', detail: 'MTN MoMo, Telecel Cash or AT Money', icon: 'phone-portrait-outline' },
  { value: 'card', label: 'Bank card', detail: 'Visa or Mastercard', icon: 'card-outline' },
  { value: 'bank_transfer', label: 'Bank transfer', detail: 'Pay from your bank account', icon: 'business-outline' },
  { value: 'ussd', label: 'USSD', detail: 'Complete payment from your phone', icon: 'keypad-outline' },
];

export function GivingScreen() {
  const navigation = useNavigation<GivingNav>();
  const { user } = useAuth();
  const offline = useKnownOffline();
  const [amount, setAmount] = useState('');
  const [selectedType, setSelectedType] = useState<GivingType>('tithe');
  const [selectedMethod, setSelectedMethod] = useState<PaymentChannel>('mobile_money');
  const [note, setNote] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const submissionLock = useRef(createSubmissionLock());
  const scrollRef = useRef<ScrollView>(null);
  useAnimatedRouteTop(scrollRef);
  const mountedRef = useRef(true);
  const activeIdentityRef = useRef<GivingIdentity>({ churchId: user?.churchId, memberId: user?.id });
  const previousIdentityRef = useRef(activeIdentityRef.current);
  const offlineRef = useRef(offline);
  activeIdentityRef.current = { churchId: user?.churchId, memberId: user?.id };
  offlineRef.current = offline;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const previous = previousIdentityRef.current;
    const current = activeIdentityRef.current;
    if (previous.churchId !== current.churchId || previous.memberId !== current.memberId) {
      submissionLock.current = createSubmissionLock();
      setAmount('');
      setSelectedType('tithe');
      setSelectedMethod('mobile_money');
      setNote('');
      setAnonymous(false);
      setError('');
      setIsSubmitting(false);
      previousIdentityRef.current = current;
    }
  }, [user?.churchId, user?.id]);

  const ownsActiveIdentity = (churchId: string, memberId: string) => givingAttemptBelongsToIdentity(
    activeIdentityRef.current,
    churchId,
    memberId,
    mountedRef.current,
  );
  const canContinue = (churchId: string, memberId: string) => ownsActiveIdentity(churchId, memberId)
    && !offlineRef.current;

  const handleGive = async () => {
    const canonicalAmount = canonicalGiftAmount(amount);
    if (!canonicalAmount) {
      setError('Enter an amount greater than GHS 0.00, using no more than 2 decimal places.');
      return;
    }
    const startedChurchId = user?.churchId;
    const startedMemberId = user?.id;
    if (!startedMemberId || !startedChurchId) {
      setError('Your member session is missing church details. Sign in again before giving.');
      return;
    }
    const actionLock = submissionLock.current;
    if (!actionLock.acquire()) return;
    setError('');
    setIsSubmitting(true);
    let reviewPresented = false;
    let paymentStarted = false;
    try {
      const payload: GiveRequest = {
        amount: canonicalAmount,
        currency: 'GHS',
        type: selectedType,
        channel: selectedMethod,
        email: user?.email || undefined,
        note: note.trim() || undefined,
        anonymous,
        callbackUrl: 'altaros://giving/complete',
      };
      const quote = await givingService.quote(payload);
      if (!canContinue(startedChurchId, startedMemberId)) {
        if (ownsActiveIdentity(startedChurchId, startedMemberId)) {
          setError('You are offline. Reconnect to review this gift; no payment was started.');
        }
        return;
      }
      const levyLine = quote.exempt
        ? 'No E-Levy applies to this gift.'
        : `E-Levy: ${formatMoney(quote.levy.minor)}\n${quote.reason}`;
      const total = formatMoney(quote.total.minor, quote.total.currency);

      reviewPresented = true;
      Alert.alert(
        'Review your gift',
        `${levyLine}\n\nTotal debit: ${total}`,
        [
          { text: 'Not now', style: 'cancel', onPress: () => {
            actionLock.release();
            if (ownsActiveIdentity(startedChurchId, startedMemberId)) setIsSubmitting(false);
          } },
          {
            text: 'Continue to payment',
            onPress: async () => {
              if (!canContinue(startedChurchId, startedMemberId)) {
                if (ownsActiveIdentity(startedChurchId, startedMemberId)) {
                  setError('You are offline. Reconnect before continuing; no payment was started.');
                }
                actionLock.release();
                if (ownsActiveIdentity(startedChurchId, startedMemberId)) setIsSubmitting(false);
                return;
              }
              paymentStarted = true;
              setIsSubmitting(true);
              try {
                const result = await givingService.give({
                  ...payload,
                  acceptedTotalMinor: quote.total.minor,
                }, startedChurchId, startedMemberId);
                if (!canContinue(startedChurchId, startedMemberId)) {
                  if (ownsActiveIdentity(startedChurchId, startedMemberId)) {
                    setError('Checkout was created but could not be opened while offline. Check giving history before trying again.');
                  }
                  return;
                }
                const checkoutUrl = safeCheckoutUrl(result.authorizationUrl);
                if (!checkoutUrl) throw new Error('The payment provider returned an unsafe checkout link.');
                const supported = await Linking.canOpenURL(checkoutUrl);
                if (!supported) throw new Error('This payment link cannot be opened on your device.');
                if (!canContinue(startedChurchId, startedMemberId)) return;
                await Linking.openURL(checkoutUrl);
                if (canContinue(startedChurchId, startedMemberId)) {
                  setAmount('');
                  setNote('');
                }
              } catch (paymentError) {
                if (ownsActiveIdentity(startedChurchId, startedMemberId)) {
                  setError(apiErrorMessage(paymentError, 'We could not start this gift.'));
                }
              } finally {
                actionLock.release();
                if (ownsActiveIdentity(startedChurchId, startedMemberId)) setIsSubmitting(false);
              }
            },
          },
        ],
        { cancelable: true, onDismiss: () => {
          if (!paymentStarted) {
            actionLock.release();
            if (ownsActiveIdentity(startedChurchId, startedMemberId)) setIsSubmitting(false);
          }
        } },
      );
    } catch (requestError) {
      reviewPresented = false;
      if (startedChurchId && startedMemberId && ownsActiveIdentity(startedChurchId, startedMemberId)) {
        setError(apiErrorMessage(requestError, 'We could not start this gift.'));
      }
    } finally {
      if (!reviewPresented) {
        actionLock.release();
        if (ownsActiveIdentity(startedChurchId, startedMemberId)) setIsSubmitting(false);
      }
    }
  };

  return (
    <ScrollView ref={scrollRef} style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <View style={styles.heroOrb} accessible={false} />
        <View style={styles.heroRing} accessible={false} />
        <Text style={styles.eyebrow}>DIRECT TO YOUR CHURCH</Text>
        <Text style={styles.title}>Give with clarity.</Text>
        <Text style={styles.subtitle}>Your gift settles to your church. Altar OS never holds church funds.</Text>
        <View style={styles.trustRow}>
          <Ionicons name="git-compare-outline" size={16} color={colors.primaryLight} accessible={false} />
          <Text style={styles.trustText}>Church settlement · clear total before checkout</Text>
        </View>
      </View>

      <Card style={styles.amountCard}>
        <Text style={styles.sectionEyebrow}>YOUR GIFT</Text>
        <Text style={styles.label}>Choose an amount</Text>
        <View style={styles.amountRow}>
          <Text style={styles.currency}>GHS</Text>
          <Input
            placeholder="0.00"
            value={amount}
            onChangeText={(value) => {
              const nextValue = value.startsWith('.') ? `0${value}` : value;
              if (/^\d*(?:\.\d{0,2})?$/.test(nextValue)) {
                setAmount(nextValue);
                setError('');
              }
            }}
            keyboardType="decimal-pad"
            maxLength={15}
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
        <Text style={styles.sectionEyebrow}>PURPOSE</Text>
        <Text style={styles.label}>What is this gift for?</Text>
        <View style={styles.chipRow}>
          {givingTypes.map((type) => (
            <TouchableOpacity key={type.value} onPress={() => setSelectedType(type.value)} style={[styles.chip, selectedType === type.value && styles.chipSelected]} accessibilityRole="button" accessibilityState={{ selected: selectedType === type.value }}>
              <Text style={[styles.chipText, selectedType === type.value && styles.chipTextSelected]}>{type.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionEyebrow}>PAYMENT METHOD</Text>
        <Text style={styles.label}>How would you like to pay?</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel="Payment method">
          {paymentMethods.map((method) => {
            const selected = selectedMethod === method.value;
            return (
              <TouchableOpacity key={method.value} onPress={() => setSelectedMethod(method.value)} style={[styles.paymentRow, selected && styles.paymentRowSelected]} accessibilityRole="radio" accessibilityState={{ selected, checked: selected }}>
                <View style={[styles.paymentIcon, selected && styles.paymentIconSelected]}><Ionicons name={method.icon} size={20} color={selected ? colors.primaryDark : colors.textSecondary} accessible={false} /></View>
                <View style={styles.paymentText}>
                  <View style={styles.paymentTitleRow}>
                    <Text style={styles.paymentLabel}>{method.label}</Text>
                    {method.value === 'mobile_money' ? <Text style={styles.recommended}>RECOMMENDED</Text> : null}
                  </View>
                  <Text style={styles.paymentDetail}>{method.detail}</Text>
                </View>
                <View style={[styles.radio, selected && styles.radioSelected]}>{selected ? <View style={styles.radioDot} /> : null}</View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionEyebrow}>DETAILS</Text>
        <Input label="Note (optional)" placeholder="What is this gift for?" value={note} onChangeText={setNote} maxLength={240} />
        <TouchableOpacity onPress={() => setAnonymous((value) => !value)} style={[styles.anonymousRow, anonymous && styles.anonymousRowSelected]} accessibilityRole="checkbox" accessibilityState={{ checked: anonymous }}>
          <View style={[styles.checkbox, anonymous && styles.checkboxSelected]}>{anonymous ? <Text style={styles.check}>✓</Text> : null}</View>
          <View style={styles.paymentText}>
            <Text style={styles.paymentLabel}>Give anonymously</Text>
            <Text style={styles.paymentDetail}>Your church will not see your name on this gift.</Text>
          </View>
        </TouchableOpacity>
      </View>

      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <Button
        title={amount ? `Continue with GHS ${amount}` : 'Enter an amount'}
        onPress={handleGive}
        loading={isSubmitting}
        disabled={!amount || offline}
        accessibilityHint={offline ? 'Reconnect to start a secure payment.' : undefined}
        fullWidth
        size="lg"
      />
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
  hero: { minHeight: 210, backgroundColor: colors.text, borderRadius: borderRadius['2xl'], padding: spacing.xl, paddingBottom: spacing['2xl'], marginBottom: 0, overflow: 'hidden' },
  heroOrb: { position: 'absolute', width: 210, height: 210, borderRadius: 105, backgroundColor: '#174C45', top: -104, right: -62 },
  heroRing: { position: 'absolute', width: 128, height: 128, borderRadius: 64, borderWidth: 1, borderColor: 'rgba(109,213,196,.28)', top: -52, right: 14 },
  eyebrow: { color: colors.primaryLight, fontFamily: typography.families.bold, fontSize: typography.sizes.xs, letterSpacing: 1.5 },
  title: { color: colors.surface, fontFamily: typography.families.bold, fontSize: typography.sizes['4xl'], lineHeight: 40, letterSpacing: -1.2, marginTop: spacing.lg },
  subtitle: { color: 'rgba(255,255,255,.68)', fontFamily: typography.families.regular, fontSize: typography.sizes.md, lineHeight: 21, marginTop: spacing.sm, maxWidth: 390 },
  trustRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg },
  trustText: { color: colors.primaryLight, fontFamily: typography.families.medium, fontSize: typography.sizes.xs },
  amountCard: { marginTop: -18, marginHorizontal: spacing.sm, marginBottom: spacing['2xl'], padding: spacing.xl, borderColor: colors.border },
  sectionEyebrow: { color: colors.primary, fontFamily: typography.families.bold, fontSize: typography.sizes.xs, letterSpacing: 1.35, marginBottom: spacing.xs },
  label: { color: colors.text, fontFamily: typography.families.semibold, fontSize: typography.sizes.base, marginBottom: spacing.md },
  amountRow: { flexDirection: 'row', alignItems: 'center' },
  currency: { color: colors.primaryDark, fontFamily: typography.families.bold, fontSize: typography.sizes.md, marginRight: spacing.md },
  amountInputContainer: { flex: 1, marginBottom: 0 },
  amountInput: { borderWidth: 0, paddingHorizontal: 0, fontSize: 38, fontFamily: typography.families.bold, color: colors.text },
  quickAmounts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.base },
  quickAmount: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: borderRadius.full, backgroundColor: colors.surfaceMuted, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  quickAmountSelected: { backgroundColor: colors.primary },
  quickAmountText: { color: colors.textSecondary, fontFamily: typography.families.semibold, fontSize: typography.sizes.sm },
  quickAmountTextSelected: { color: colors.surface },
  section: { marginBottom: spacing['2xl'] },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: borderRadius.full, paddingHorizontal: spacing.base, paddingVertical: spacing.sm, backgroundColor: colors.surface },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.secondaryLight },
  chipText: { color: colors.textSecondary, fontSize: typography.sizes.md },
  chipTextSelected: { color: colors.primaryDark, fontFamily: typography.families.semibold },
  paymentRow: { flexDirection: 'row', alignItems: 'center', minHeight: 72, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: borderRadius.xl, backgroundColor: colors.surface, marginBottom: spacing.sm },
  paymentRowSelected: { borderColor: colors.primary, backgroundColor: colors.secondaryLight },
  paymentIcon: { width: 42, height: 42, borderRadius: borderRadius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted, marginRight: spacing.md },
  paymentIconSelected: { backgroundColor: 'rgba(109,213,196,.3)' },
  radio: { width: 22, height: 22, borderWidth: 1.5, borderColor: colors.border, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.md },
  radioSelected: { borderColor: colors.primary },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary },
  paymentText: { flex: 1 },
  paymentTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  paymentLabel: { color: colors.text, fontFamily: typography.families.semibold, fontSize: typography.sizes.md },
  recommended: { color: colors.primaryDark, fontFamily: typography.families.bold, fontSize: 9, letterSpacing: .8 },
  paymentDetail: { color: colors.muted, fontSize: typography.sizes.sm, marginTop: 2 },
  anonymousRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: borderRadius.xl, backgroundColor: colors.surface, padding: spacing.md },
  anonymousRowSelected: { borderColor: colors.primary, backgroundColor: colors.secondaryLight },
  checkbox: { width: 22, height: 22, borderWidth: 1.5, borderColor: colors.border, borderRadius: 6, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  checkboxSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  check: { color: colors.surface, fontFamily: typography.families.bold, fontSize: typography.sizes.sm },
  error: { color: colors.error, fontSize: typography.sizes.sm, lineHeight: 19, marginBottom: spacing.base },
  historyLink: { alignItems: 'center', padding: spacing.base },
  historyText: { color: colors.primary, fontFamily: typography.families.semibold, fontSize: typography.sizes.md },
  secureNote: { color: colors.muted, textAlign: 'center', fontSize: typography.sizes.xs, lineHeight: 18, paddingHorizontal: spacing.xl },
});
