import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from '../../components/common/Button';
import { useAuth } from '../../hooks/useAuth';
import { useKnownOffline } from '../../hooks/useKnownOffline';
import givingService, { formatMoney, normalizePaymentReference, type GivingRecord } from '../../services/giving.service';
import { borderRadius, colors, spacing, typography } from '../../theme';
import type { RootStackParamList } from '../../components/navigation/AppNavigator';

type CompleteRoute = RouteProp<RootStackParamList, 'GivingComplete'>;
type CompleteNav = NativeStackNavigationProp<RootStackParamList, 'GivingComplete'>;

export const SETTLEMENT_POLL_INTERVAL_MS = 4_000;
export const SETTLEMENT_MAX_ATTEMPTS = 4;

export type SettlementContext = {
  reference: string;
  churchId: string;
  memberId: string;
};

type SettlementViewState = {
  owner: SettlementContext | null;
  transaction: GivingRecord | null;
  isChecking: boolean;
  error: string;
  attempt: number;
};

export function settlementContextMatches(
  left: SettlementContext | null,
  right: SettlementContext | null,
): boolean {
  return Boolean(
    left
    && right
    && left.reference === right.reference
    && left.churchId === right.churchId
    && left.memberId === right.memberId,
  );
}

function settlementContextKey(context: SettlementContext): string {
  return `${context.reference}\u0000${context.churchId}\u0000${context.memberId}`;
}

export function normalizePaymentCallbackReference(
  reference: unknown,
  transactionReference: unknown,
): string | null {
  const primary = normalizePaymentReference(reference);
  const secondary = normalizePaymentReference(transactionReference);
  if ((reference !== undefined && !primary) || (transactionReference !== undefined && !secondary)) {
    return null;
  }
  if (primary && secondary && primary !== secondary) return null;
  return primary ?? secondary;
}

export function shouldPollSettlement(status: GivingRecord['status'] | undefined, attempt: number): boolean {
  return status === 'pending' && attempt > 0 && attempt < SETTLEMENT_MAX_ATTEMPTS;
}

export function settlementPreflightError(
  reference: string | null,
  hasMemberIdentity: boolean,
  offline: boolean,
): string | null {
  if (!reference) {
    return 'The payment provider returned without a valid transaction reference. Your account has not been marked as paid.';
  }
  if (!hasMemberIdentity) {
    return 'Your member session is missing church details. Sign in again before checking this payment.';
  }
  if (offline) {
    return 'You are offline. Reconnect to verify this payment safely. Do not start another payment while its status is unknown.';
  }
  return null;
}

export function GivingCompleteScreen() {
  const route = useRoute<CompleteRoute>();
  const navigation = useNavigation<CompleteNav>();
  const { user } = useAuth();
  const offline = useKnownOffline();
  const reference = normalizePaymentCallbackReference(
    route.params?.reference,
    route.params?.trxref,
  );
  const context = useMemo(
    () => reference && user?.id && user.churchId
      ? { reference, churchId: user.churchId, memberId: user.id }
      : null,
    [reference, user?.churchId, user?.id],
  );
  const activeContextRef = useRef<SettlementContext | null>(context);
  activeContextRef.current = context;
  const [viewState, setViewState] = useState<SettlementViewState>({
    owner: null,
    transaction: null,
    isChecking: true,
    error: '',
    attempt: 0,
  });
  const attemptsRef = useRef(new Map<string, number>());
  const inFlightRef = useRef(new Set<string>());
  const mountedRef = useRef(true);

  const verify = useCallback(async () => {
    const requestContext = context;
    const preflightError = settlementPreflightError(
      reference,
      Boolean(requestContext),
      offline,
    );
    if (preflightError) {
      setViewState({
        owner: requestContext,
        transaction: null,
        isChecking: false,
        error: preflightError,
        attempt: 0,
      });
      return;
    }
    if (!requestContext) return;
    const requestKey = settlementContextKey(requestContext);
    if (inFlightRef.current.has(requestKey)) return;
    inFlightRef.current.add(requestKey);
    const nextAttempt = (attemptsRef.current.get(requestKey) ?? 0) + 1;
    attemptsRef.current.set(requestKey, nextAttempt);
    setViewState({
      owner: requestContext,
      transaction: null,
      isChecking: true,
      error: '',
      attempt: nextAttempt,
    });
    try {
      const result = await givingService.settle(
        requestContext.reference,
        requestContext.churchId,
        requestContext.memberId,
      );
      if (mountedRef.current && settlementContextMatches(activeContextRef.current, requestContext)) {
        setViewState({
          owner: requestContext,
          transaction: result,
          isChecking: false,
          error: '',
          attempt: nextAttempt,
        });
      }
    } catch {
      if (mountedRef.current && settlementContextMatches(activeContextRef.current, requestContext)) {
        setViewState({
          owner: requestContext,
          transaction: null,
          isChecking: false,
          error: 'We could not verify this payment yet. This does not mean you were charged twice. Check again shortly.',
          attempt: nextAttempt,
        });
      }
    } finally {
      inFlightRef.current.delete(requestKey);
    }
  }, [context, offline, reference]);

  useEffect(() => {
    mountedRef.current = true;
    void verify();
    return () => { mountedRef.current = false; };
  }, [verify]);

  const ownsViewState = context
    ? settlementContextMatches(viewState.owner, context)
    : viewState.owner === null;
  const transaction = ownsViewState ? viewState.transaction : null;
  const isChecking = ownsViewState ? viewState.isChecking : true;
  const error = ownsViewState ? viewState.error : '';
  const attempt = ownsViewState ? viewState.attempt : 0;

  useEffect(() => {
    if (isChecking || error || !shouldPollSettlement(transaction?.status, attempt)) return undefined;
    const timer = setTimeout(() => { void verify(); }, SETTLEMENT_POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [attempt, error, isChecking, transaction?.status, verify]);

  const checkAgain = () => {
    const currentContext = activeContextRef.current;
    if (currentContext) attemptsRef.current.set(settlementContextKey(currentContext), 0);
    void verify();
  };

  const success = transaction?.status === 'success';
  const failed = transaction?.status === 'failed' || transaction?.status === 'reversed';

  return (
    <View style={styles.container}>
      <View style={styles.ambientOrb} accessible={false} />
      <View style={styles.ambientRing} accessible={false} />
      <View style={styles.stage}>
        <View
          style={[styles.mark, success && styles.successMark, failed && styles.failedMark]}
          accessible
          accessibilityRole={isChecking ? 'progressbar' : 'image'}
          accessibilityLabel={isChecking
            ? 'Checking payment status'
            : success
              ? 'Payment confirmed'
              : failed
                ? 'Payment not completed'
                : 'Payment confirmation pending'}
        >
          {isChecking
            ? <ActivityIndicator color={colors.surface} importantForAccessibility="no" />
            : <Text style={styles.markText} importantForAccessibility="no">{success ? '✓' : failed ? '!' : '…'}</Text>}
        </View>
        <Text style={styles.eyebrow}>PAYMENT STATUS</Text>
        <Text style={styles.title} accessibilityRole="header" accessibilityLiveRegion="polite">
          {isChecking ? 'Checking your gift…' : success ? 'Gift confirmed.' : failed ? 'Payment not completed.' : 'Confirmation pending.'}
        </Text>
        <Text style={styles.body} accessibilityRole={error ? 'alert' : undefined}>
          {error || (success
            ? `Your ${formatMoney(transaction.grossMinor, transaction.currency)} gift is confirmed. Your receipt will follow by SMS.`
            : failed
              ? 'No confirmed gift was added to your church account. You can safely try again.'
              : shouldPollSettlement(transaction?.status, attempt)
                ? `The provider has not confirmed the debit yet. We will check again automatically (${attempt} of ${SETTLEMENT_MAX_ATTEMPTS}). Do not start another payment.`
                : 'The provider has not confirmed the debit yet. Do not start another payment while this one is pending. You can check again safely.')}
        </Text>
        {reference ? <Text style={styles.reference}>Reference · {reference}</Text> : null}
        {!isChecking && !success ? (
          <Button
            title={offline ? 'Reconnect to check' : 'Check again'}
            onPress={checkAgain}
            disabled={offline}
            accessibilityHint={offline ? 'Reconnect to verify this payment without starting another charge.' : undefined}
            fullWidth
          />
        ) : null}
        <Button
          title="View giving history"
          variant={success ? 'primary' : 'outline'}
          onPress={() => navigation.replace('GivingHistory')}
          fullWidth
        />
        <Text style={styles.note}>Only a provider-verified success appears in confirmed giving.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, overflow: 'hidden' },
  ambientOrb: { position: 'absolute', width: 280, height: 280, borderRadius: 140, backgroundColor: '#174C45', top: -140, right: -80 },
  ambientRing: { position: 'absolute', width: 180, height: 180, borderRadius: 90, borderWidth: 1, borderColor: 'rgba(109,213,196,.25)', top: -72, right: 5 },
  stage: { width: '100%', maxWidth: 460, backgroundColor: colors.surface, borderRadius: borderRadius['2xl'], alignItems: 'center', padding: spacing['2xl'], gap: spacing.base },
  mark: { width: 72, height: 72, borderRadius: borderRadius.full, backgroundColor: colors.warning, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  successMark: { backgroundColor: colors.success },
  failedMark: { backgroundColor: colors.error },
  markText: { color: colors.surface, fontFamily: typography.families.bold, fontSize: typography.sizes['3xl'] },
  eyebrow: { color: colors.primary, fontFamily: typography.families.bold, fontSize: typography.sizes.xs, letterSpacing: 1.5 },
  title: { color: colors.text, fontFamily: typography.families.bold, fontSize: typography.sizes['2xl'], textAlign: 'center' },
  body: { color: colors.textSecondary, fontSize: typography.sizes.base, lineHeight: 24, textAlign: 'center', maxWidth: 460 },
  reference: { color: colors.muted, fontSize: typography.sizes.xs, marginBottom: spacing.sm },
  note: { color: colors.muted, fontSize: typography.sizes.xs, textAlign: 'center', maxWidth: 360 },
});
