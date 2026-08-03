import React, { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Linking, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { useAuth } from '../../hooks/useAuth';
import { useKnownOffline } from '../../hooks/useKnownOffline';
import givingService, { canonicalGiftAmount, formatMoney, MOBILE_PAYMENT_CALLBACK_URL, safeCheckoutUrl, type GiveRequest, type GivingCampaignOption, type GivingOptions, type GivingPledgeOption, type GivingType, type PaymentChannel } from '../../services/giving.service';
import { createSubmissionLock } from '../../services/submission-lock';
import { borderRadius, colors, spacing, typography } from '../../theme';
import type { RootStackParamList } from '../../components/navigation/AppNavigator';
import { useAnimatedRouteTop } from '../../hooks/useAnimatedRouteTop';
import { apiErrorMessage, isAmbiguousMutationFailure } from '../../services/api-error';
import { Ionicons } from '@expo/vector-icons';
import { createLatestRequestGate } from '../../services/latest-request';
import { formKeyboardProps } from '../../components/common/form-keyboard';

type GivingNav = NativeStackNavigationProp<RootStackParamList>;

interface GivingIdentity {
  churchId?: string;
  memberId?: string;
}

type PurposePickerItem =
  | { kind: 'campaign'; campaign: GivingCampaignOption }
  | { kind: 'pledge'; pledge: GivingPledgeOption };

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

export function givingInitiationErrorMessage(
  checkoutCreated: boolean,
  error: unknown,
): string {
  if (checkoutCreated) {
    return 'A pending checkout was created, but the payment page could not be opened. Check giving history before trying again so you do not start a second payment.';
  }
  if (isAmbiguousMutationFailure(error)) {
    return 'We could not confirm whether a checkout was created. Check giving history before trying again so you do not start a second payment.';
  }
  return apiErrorMessage(error, 'We could not start this gift.');
}

export function givingPurposeAccessibility(selected: boolean): {
  selected: boolean;
  checked: boolean;
} {
  return { selected, checked: selected };
}

export function givingOptionsRetryAccessibility(offline: boolean): {
  disabled: boolean;
  label: string;
  hint: string;
} {
  return offline
    ? { disabled: true, label: 'Reconnect to retry', hint: 'Reconnect to reload campaigns and pledges.' }
    : { disabled: false, label: 'Try again', hint: 'Reloads your active campaigns and pledges.' };
}

export function givingPrimaryActionState(
  amount: string,
  offline: boolean,
  submitting: boolean,
  identityComplete: boolean,
) {
  const canonicalAmount = canonicalGiftAmount(amount);
  return {
    label: submitting
      ? 'Preparing your secure review…'
      : !identityComplete ? 'Sign in again to give'
        : offline ? 'Reconnect to review your gift'
          : canonicalAmount ? `Review GHS ${canonicalAmount}` : 'Enter an amount over GHS 0.00',
    disabled: !identityComplete || offline || canonicalAmount === null,
    hint: !identityComplete
      ? 'Your member session is missing church details. Sign in again before giving.'
      : offline ? 'Reconnect to review fees and start a secure payment.'
        : canonicalAmount === null ? 'Enter a positive amount using no more than 2 decimal places.'
          : 'Shows the payment fee, levy and total debit before checkout.',
  } as const;
}

const quickAmounts = [20, 50, 100, 200, 500];
const givingTypes: { value: GivingType; label: string }[] = [
  { value: 'tithe', label: 'Tithe' },
  { value: 'offering', label: 'Offering' },
  { value: 'donation', label: 'Donation' },
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
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>();
  const [selectedPledgeId, setSelectedPledgeId] = useState<string>();
  const [givingOptions, setGivingOptions] = useState<GivingOptions>({ campaigns: [], pledges: [] });
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState('');
  const [purposePicker, setPurposePicker] = useState<'campaign' | 'pledge' | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<PaymentChannel>('mobile_money');
  const [note, setNote] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const submissionLock = useRef(createSubmissionLock());
  const optionsGate = useRef(createLatestRequestGate());
  const scrollRef = useRef<ScrollView>(null);
  useAnimatedRouteTop(scrollRef);
  const mountedRef = useRef(true);
  const activeIdentityRef = useRef<GivingIdentity>({ churchId: user?.churchId, memberId: user?.memberId });
  const previousIdentityRef = useRef(activeIdentityRef.current);
  const offlineRef = useRef(offline);
  activeIdentityRef.current = { churchId: user?.churchId, memberId: user?.memberId };
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
      setSelectedCampaignId(undefined);
      setSelectedPledgeId(undefined);
      setGivingOptions({ campaigns: [], pledges: [] });
      setPurposePicker(null);
      setSelectedMethod('mobile_money');
      setNote('');
      setAnonymous(false);
      setError('');
      setIsSubmitting(false);
      previousIdentityRef.current = current;
    }
  }, [user?.churchId, user?.memberId]);

  const loadGivingOptions = async () => {
    const churchId = user?.churchId;
    const memberId = user?.memberId;
    const request = optionsGate.current.begin();
    setOptionsLoading(true);
    setOptionsError('');
    try {
      if (!churchId || !memberId) throw new Error('Member identity is incomplete');
      const next = await givingService.getGivingOptions(churchId, memberId);
      if (optionsGate.current.isLatest(request)
        && activeIdentityRef.current.churchId === churchId
        && activeIdentityRef.current.memberId === memberId) {
        setGivingOptions(next);
        setSelectedType((current) => {
          if (current === 'campaign' && !next.campaigns.some(({ id }) => id === selectedCampaignId)) return 'tithe';
          if (current === 'pledge_payment' && !next.pledges.some(({ id }) => id === selectedPledgeId)) return 'tithe';
          return current;
        });
        setSelectedCampaignId((current) => current && next.campaigns.some(({ id }) => id === current) ? current : undefined);
        setSelectedPledgeId((current) => current && next.pledges.some(({ id }) => id === current) ? current : undefined);
      }
    } catch (cause) {
      if (optionsGate.current.isLatest(request)) {
        setOptionsError(apiErrorMessage(cause, 'Campaigns and pledges could not be loaded.'));
      }
    } finally {
      if (optionsGate.current.isLatest(request)) setOptionsLoading(false);
    }
  };

  useEffect(() => {
    const gate = optionsGate.current;
    if (!offline) void loadGivingOptions();
    else setOptionsLoading(false);
    return () => gate.invalidate();
    // Identity changes deliberately reload member-owned options.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.churchId, user?.memberId, offline]);

  const ownsActiveIdentity = (churchId: string, memberId: string) => givingAttemptBelongsToIdentity(
    activeIdentityRef.current,
    churchId,
    memberId,
    mountedRef.current,
  );
  const canContinue = (churchId: string, memberId: string) => ownsActiveIdentity(churchId, memberId)
    && !offlineRef.current;

  const selectedCampaign = givingOptions.campaigns.find(({ id }) => id === selectedCampaignId);
  const selectedPledge = givingOptions.pledges.find(({ id }) => id === selectedPledgeId);
  const selectedPledgeCampaign = givingOptions.campaigns.find(({ id }) => id === selectedPledge?.campaignId);
  const pickerItems: PurposePickerItem[] = purposePicker === 'campaign'
    ? givingOptions.campaigns.map((campaign) => ({ kind: 'campaign' as const, campaign }))
    : givingOptions.pledges.map((pledge) => ({ kind: 'pledge' as const, pledge }));
  const optionsRetry = givingOptionsRetryAccessibility(offline);
  const primaryAction = givingPrimaryActionState(
    amount,
    offline,
    isSubmitting,
    Boolean(user?.churchId && user?.memberId),
  );

  const handleGive = async () => {
    const canonicalAmount = canonicalGiftAmount(amount);
    if (!canonicalAmount) {
      setError('Enter an amount greater than GHS 0.00, using no more than 2 decimal places.');
      return;
    }
    const startedChurchId = user?.churchId;
    const startedMemberId = user?.memberId;
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
        campaignId: selectedCampaignId,
        pledgeId: selectedPledgeId,
        callbackUrl: MOBILE_PAYMENT_CALLBACK_URL,
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
      const giftLine = `Gift: ${formatMoney(quote.fee.gift.minor, quote.fee.gift.currency)}`;
      const feeLine = quote.fee.providerFee.minor > 0
        ? `Payment fee: ${formatMoney(quote.fee.providerFee.minor, quote.fee.providerFee.currency)} (${quote.fee.bearer === 'giver' ? 'paid by you' : 'covered by your church'})`
        : 'Payment fee: GHS 0.00';
      const total = formatMoney(quote.total.minor, quote.total.currency);

      reviewPresented = true;
      Alert.alert(
        'Review your gift',
        `${giftLine}\n${feeLine}\n${levyLine}\n\n${quote.fee.explanation}\n\nTotal debit: ${total}`,
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
              let checkoutCreated = false;
              try {
                const result = await givingService.give({
                  ...payload,
                  acceptedTotalMinor: quote.total.minor,
                }, startedChurchId, startedMemberId);
                checkoutCreated = true;
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
                  setError(givingInitiationErrorMessage(checkoutCreated, paymentError));
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
    <>
      <ScrollView ref={scrollRef} style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} {...formKeyboardProps(Platform.OS)}>
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
            editable={!isSubmitting}
          />
        </View>
        <View style={styles.quickAmounts}>
          {quickAmounts.map((value) => (
            <TouchableOpacity
              key={value}
              onPress={() => setAmount(String(value))}
              style={[styles.quickAmount, amount === String(value) && styles.quickAmountSelected, isSubmitting && styles.optionDisabled]}
              accessibilityRole="button"
              accessibilityState={{ selected: amount === String(value), disabled: isSubmitting }}
              disabled={isSubmitting}
            >
              <Text style={[styles.quickAmountText, amount === String(value) && styles.quickAmountTextSelected]}>{value}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Card>

      <View style={styles.section}>
        <Text style={styles.sectionEyebrow}>PURPOSE</Text>
        <Text style={styles.label}>What is this gift for?</Text>
        <View style={styles.chipRow} accessibilityRole="radiogroup" accessibilityLabel="Basic giving purpose">
          {givingTypes.map((type) => (
            <TouchableOpacity key={type.value} onPress={() => { setSelectedType(type.value); setSelectedCampaignId(undefined); setSelectedPledgeId(undefined); }} disabled={isSubmitting} style={[styles.chip, selectedType === type.value && styles.chipSelected, isSubmitting && styles.optionDisabled]} accessibilityRole="radio" accessibilityState={{ ...givingPurposeAccessibility(selectedType === type.value), disabled: isSubmitting }}>
              <Text style={[styles.chipText, selectedType === type.value && styles.chipTextSelected]}>{type.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {optionsLoading ? <Text style={styles.optionsStatus} accessibilityRole="progressbar">Loading campaigns and pledges…</Text> : null}
        {optionsError ? (
          <View style={styles.optionsError}>
            <Text style={styles.optionsErrorText} accessibilityRole="alert">{optionsError} You can still give a tithe, offering or donation.</Text>
            <TouchableOpacity onPress={() => void loadGivingOptions()} disabled={optionsRetry.disabled || isSubmitting} accessibilityRole="button" accessibilityState={{ disabled: optionsRetry.disabled || isSubmitting }} accessibilityHint={isSubmitting ? 'Wait while this gift review is being prepared.' : optionsRetry.hint} style={[styles.optionsRetry, (optionsRetry.disabled || isSubmitting) && styles.optionDisabled]}>
              <Text style={styles.optionsRetryText}>{optionsRetry.label}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {givingOptions.campaigns.length > 0 ? (
          <View style={styles.purposeGroup}>
            <Text style={styles.purposeGroupTitle}>Active campaigns</Text>
            <TouchableOpacity
              style={[styles.purposeCard, selectedType === 'campaign' && styles.purposeCardSelected]}
              onPress={() => setPurposePicker('campaign')}
              accessibilityRole="button"
              accessibilityLabel={selectedCampaign ? `Campaign selected, ${selectedCampaign.title}` : 'Choose an active campaign'}
              accessibilityHint="Opens the active campaign list."
              accessibilityState={{ selected: selectedType === 'campaign', disabled: isSubmitting }}
              disabled={isSubmitting}
            >
              <View style={styles.paymentText}>
                <Text style={styles.paymentLabel}>{selectedCampaign?.title || 'Choose a campaign'}</Text>
                <Text style={styles.paymentDetail}>{selectedCampaign ? `${formatMoney(selectedCampaign.currentAmount)} raised · ${selectedCampaign.progress}% of target` : `${givingOptions.campaigns.length} active ${givingOptions.campaigns.length === 1 ? 'campaign' : 'campaigns'}`}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.primaryDark} accessible={false} />
            </TouchableOpacity>
          </View>
        ) : null}
        {givingOptions.pledges.length > 0 ? (
          <View style={styles.purposeGroup}>
            <Text style={styles.purposeGroupTitle}>Your active pledges</Text>
            <TouchableOpacity
              style={[styles.purposeCard, selectedType === 'pledge_payment' && styles.purposeCardSelected]}
              onPress={() => setPurposePicker('pledge')}
              accessibilityRole="button"
              accessibilityLabel={selectedPledge ? `Pledge selected, ${selectedPledgeCampaign?.title || selectedPledge.note || 'General pledge'}` : 'Choose one of your active pledges'}
              accessibilityHint="Opens your active pledge list."
              accessibilityState={{ selected: selectedType === 'pledge_payment', disabled: isSubmitting }}
              disabled={isSubmitting}
            >
              <View style={styles.paymentText}>
                <Text style={styles.paymentLabel}>{selectedPledge ? selectedPledgeCampaign?.title || selectedPledge.note || 'General pledge' : 'Choose a pledge'}</Text>
                <Text style={styles.paymentDetail}>{selectedPledge ? `${formatMoney(selectedPledge.remainingMinor)} remaining · ${selectedPledge.percent}% fulfilled` : `${givingOptions.pledges.length} active ${givingOptions.pledges.length === 1 ? 'pledge' : 'pledges'}`}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.primaryDark} accessible={false} />
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionEyebrow}>PAYMENT METHOD</Text>
        <Text style={styles.label}>How would you like to pay?</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel="Payment method">
          {paymentMethods.map((method) => {
            const selected = selectedMethod === method.value;
            return (
              <TouchableOpacity key={method.value} onPress={() => setSelectedMethod(method.value)} disabled={isSubmitting} style={[styles.paymentRow, selected && styles.paymentRowSelected, isSubmitting && styles.optionDisabled]} accessibilityRole="radio" accessibilityState={{ selected, checked: selected, disabled: isSubmitting }}>
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
        <Input label="Note (optional)" placeholder="What is this gift for?" value={note} onChangeText={setNote} maxLength={240} editable={!isSubmitting} />
        <TouchableOpacity onPress={() => setAnonymous((value) => !value)} disabled={selectedType === 'pledge_payment' || isSubmitting} style={[styles.anonymousRow, anonymous && styles.anonymousRowSelected, (selectedType === 'pledge_payment' || isSubmitting) && styles.optionDisabled]} accessibilityRole="checkbox" accessibilityState={{ checked: anonymous, disabled: selectedType === 'pledge_payment' || isSubmitting }}>
          <View style={[styles.checkbox, anonymous && styles.checkboxSelected]}>{anonymous ? <Text style={styles.check}>✓</Text> : null}</View>
          <View style={styles.paymentText}>
            <Text style={styles.paymentLabel}>Give anonymously</Text>
            <Text style={styles.paymentDetail}>{selectedType === 'pledge_payment' ? 'Pledge payments stay linked to your promise.' : 'Your church will not see your name on this gift.'}</Text>
          </View>
        </TouchableOpacity>
      </View>

      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <Button
        title={primaryAction.label}
        onPress={handleGive}
        loading={isSubmitting}
        disabled={primaryAction.disabled}
        accessibilityHint={primaryAction.hint}
        fullWidth
        size="lg"
      />
      <TouchableOpacity onPress={() => navigation.navigate('GivingHistory')} style={styles.historyLink} accessibilityRole="link">
        <Text style={styles.historyText}>View giving history →</Text>
      </TouchableOpacity>
      <Text style={styles.secureNote}>Payments are processed securely by Paystack. Any levy is shown before you authorise payment.</Text>
      </ScrollView>
      <Modal visible={purposePicker !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPurposePicker(null)}>
        <View style={styles.pickerContainer} accessibilityViewIsModal>
          <View style={styles.pickerHeader}>
            <View style={styles.paymentText}>
              <Text style={styles.sectionEyebrow}>{purposePicker === 'campaign' ? 'ACTIVE CAMPAIGNS' : 'YOUR PLEDGES'}</Text>
              <Text style={styles.pickerTitle} accessibilityRole="header">{purposePicker === 'campaign' ? 'Choose a campaign' : 'Choose a pledge'}</Text>
            </View>
            <TouchableOpacity style={styles.pickerClose} onPress={() => setPurposePicker(null)} accessibilityRole="button" accessibilityLabel="Close giving purpose list">
              <Ionicons name="close" size={24} color={colors.text} accessible={false} />
            </TouchableOpacity>
          </View>
          <FlatList<PurposePickerItem>
            data={pickerItems}
            accessibilityRole="radiogroup"
            accessibilityLabel={purposePicker === 'campaign' ? 'Active campaigns' : 'Active pledges'}
            keyExtractor={(item) => item.kind === 'campaign' ? item.campaign.id : item.pledge.id}
            contentContainerStyle={styles.pickerList}
            renderItem={({ item }) => {
              const campaign = item.kind === 'campaign' ? item.campaign : undefined;
              const pledge = item.kind === 'pledge' ? item.pledge : undefined;
              const pledgeCampaign = pledge ? givingOptions.campaigns.find(({ id }) => id === pledge.campaignId) : undefined;
              const selected = campaign
                ? selectedType === 'campaign' && selectedCampaignId === campaign.id
                : selectedType === 'pledge_payment' && selectedPledgeId === pledge?.id;
              const title = campaign?.title || pledgeCampaign?.title || pledge?.note || 'General pledge';
              const detail = campaign
                ? `${formatMoney(campaign.currentAmount)} raised · ${campaign.progress}% of target`
                : `${formatMoney(pledge?.remainingMinor || 0)} remaining · ${pledge?.percent || 0}% fulfilled`;
              return (
                <TouchableOpacity
                  style={[styles.pickerOption, selected && styles.purposeCardSelected]}
                  onPress={() => {
                    if (campaign) {
                      setSelectedType('campaign'); setSelectedCampaignId(campaign.id); setSelectedPledgeId(undefined);
                    } else if (pledge) {
                      setSelectedType('pledge_payment'); setSelectedPledgeId(pledge.id); setSelectedCampaignId(pledge.campaignId); setAnonymous(false);
                    }
                    setPurposePicker(null);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, checked: selected }}
                  accessibilityLabel={`${title}, ${detail}`}
                >
                  <View style={styles.paymentText}><Text style={styles.paymentLabel}>{title}</Text><Text style={styles.paymentDetail}>{detail}</Text></View>
                  <View style={[styles.radio, selected && styles.radioSelected]}>{selected ? <View style={styles.radioDot} /> : null}</View>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </Modal>
    </>
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
  optionsStatus: { color: colors.muted, fontFamily: typography.families.medium, fontSize: typography.sizes.sm, marginTop: spacing.md },
  optionsError: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: '#FFF7F5', borderRadius: borderRadius.lg, padding: spacing.md, marginTop: spacing.md },
  optionsErrorText: { color: colors.error, flex: 1, fontSize: typography.sizes.sm, lineHeight: 19 },
  optionsRetry: { minHeight: 44, justifyContent: 'center' },
  optionsRetryText: { color: colors.primaryDark, fontFamily: typography.families.semibold, fontSize: typography.sizes.sm },
  purposeGroup: { marginTop: spacing.lg },
  purposeGroupTitle: { color: colors.textSecondary, fontFamily: typography.families.semibold, fontSize: typography.sizes.sm, marginBottom: spacing.sm },
  purposeCard: { flexDirection: 'row', alignItems: 'center', minHeight: 64, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: borderRadius.lg, backgroundColor: colors.surface, marginBottom: spacing.sm },
  purposeCardSelected: { borderColor: colors.primary, backgroundColor: colors.secondaryLight },
  pickerContainer: { flex: 1, backgroundColor: colors.background, paddingTop: spacing['2xl'] },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickerTitle: { color: colors.text, fontFamily: typography.families.bold, fontSize: typography.sizes['2xl'] },
  pickerClose: { width: 48, height: 48, borderRadius: borderRadius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  pickerList: { padding: spacing.base, paddingBottom: spacing['3xl'] },
  pickerOption: { flexDirection: 'row', alignItems: 'center', minHeight: 72, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: borderRadius.xl, backgroundColor: colors.surface, marginBottom: spacing.sm },
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
  optionDisabled: { opacity: 0.58 },
  checkbox: { width: 22, height: 22, borderWidth: 1.5, borderColor: colors.border, borderRadius: 6, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  checkboxSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  check: { color: colors.surface, fontFamily: typography.families.bold, fontSize: typography.sizes.sm },
  error: { color: colors.error, fontSize: typography.sizes.sm, lineHeight: 19, marginBottom: spacing.base },
  historyLink: { alignItems: 'center', padding: spacing.base },
  historyText: { color: colors.primary, fontFamily: typography.families.semibold, fontSize: typography.sizes.md },
  secureNote: { color: colors.muted, textAlign: 'center', fontSize: typography.sizes.xs, lineHeight: 18, paddingHorizontal: spacing.xl },
});
