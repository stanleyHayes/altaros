import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card } from '../../components/common/Card';
import givingService, { formatMoney, GIVING_HISTORY_PAGE_SIZE, memberPaymentUpliftMinor, pendingGivingRecoveryReference, sumConfirmedGivingMinor, type GivingRecord } from '../../services/giving.service';
import { borderRadius, colors, spacing, typography } from '../../theme';
import { ScreenSkeleton } from '../../components/common/ScreenSkeleton';
import { createLatestRequestGate } from '../../services/latest-request';
import { useAuth } from '../../hooks/useAuth';
import { useKnownOffline } from '../../hooks/useKnownOffline';
import { connectivityErrorMessage } from '../../services/connectivity';
import { StatePanel } from '../../components/common/StatePanel';
import { useAnimatedRouteTop } from '../../hooks/useAnimatedRouteTop';
import { paginationActionState } from '../../components/common/pagination-action';
import type { RootStackParamList } from '../../components/navigation/AppNavigator';
import { appendUniquePageById } from '../../services/list-reconciliation';

type GivingHistoryNavigation = NativeStackNavigationProp<RootStackParamList, 'GivingHistory'>;

const statusColors: Record<GivingRecord['status'], string> = {
  success: colors.success,
  pending: colors.warning,
  failed: colors.error,
  reversed: colors.muted,
};

interface GivingHistoryOwner {
  churchId?: string;
  memberId?: string;
}

export function givingHistoryBelongsToIdentity(
  owner: GivingHistoryOwner | null,
  active: GivingHistoryOwner,
): boolean {
  return owner !== null
    && owner.churchId !== undefined
    && owner.memberId !== undefined
    && owner.churchId === active.churchId
    && owner.memberId === active.memberId;
}

export function givingHistoryRetryAccessibility(offline: boolean): {
  disabled: boolean;
  label: string;
  hint: string;
} {
  return offline
    ? { disabled: true, label: 'Reconnect to retry', hint: 'Reconnect to refresh your giving history.' }
    : { disabled: false, label: 'Try again', hint: 'Refreshes your giving history.' };
}

export function GivingHistoryScreen() {
  const navigation = useNavigation<GivingHistoryNavigation>();
  const { user } = useAuth();
  const offline = useKnownOffline();
  const listRef = useRef<FlatList<GivingRecord>>(null);
  useAnimatedRouteTop(listRef);
  const [records, setRecords] = useState<GivingRecord[]>([]);
  const [recordsOwner, setRecordsOwner] = useState<GivingHistoryOwner | null>(() => ({
    churchId: user?.churchId,
    memberId: user?.memberId,
  }));
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadedPage, setLoadedPage] = useState(0);
  const [totalRecords, setTotalRecords] = useState(0);
  const [error, setError] = useState('');
  const loadGate = useRef(createLatestRequestGate());
  const recordsOwnerRef = useRef(recordsOwner);
  recordsOwnerRef.current = recordsOwner;

  const loadHistory = useCallback(async (refresh = false, page = 1) => {
    const request = loadGate.current.begin();
    const startedOwner = { churchId: user?.churchId, memberId: user?.memberId };
    if (!givingHistoryBelongsToIdentity(recordsOwnerRef.current, startedOwner)) {
      recordsOwnerRef.current = startedOwner;
      setRecordsOwner(startedOwner);
      setRecords([]);
      setLoadedPage(0);
      setTotalRecords(0);
    }
    if (page > 1) setIsLoadingMore(true);
    else if (refresh) setIsRefreshing(true);
    else setIsLoading(true);
    setError('');
    try {
      if (!user?.churchId || !user.memberId) throw new Error('Member identity is incomplete');
      const result = await givingService.getHistoryPage(
        user.churchId,
        user.memberId,
        page,
        GIVING_HISTORY_PAGE_SIZE,
      );
      if (loadGate.current.isLatest(request)) {
        setRecords((current) => page === 1
          ? result.records
          : appendUniquePageById(current, result.records));
        setLoadedPage(page);
        setTotalRecords(result.total);
        const loadedOwner = { churchId: user.churchId, memberId: user.memberId };
        recordsOwnerRef.current = loadedOwner;
        setRecordsOwner(loadedOwner);
      }
    } catch (cause) {
      if (loadGate.current.isLatest(request)) setError(connectivityErrorMessage(cause, 'We could not load your giving history.'));
    } finally {
      if (loadGate.current.isLatest(request)) {
        setIsLoading(false);
        setIsRefreshing(false);
        setIsLoadingMore(false);
      }
    }
  }, [user?.churchId, user?.memberId]);

  useEffect(() => {
    const gate = loadGate.current;
    void loadHistory();
    return () => gate.invalidate();
  }, [loadHistory]);

  const ownsRecords = givingHistoryBelongsToIdentity(recordsOwner, {
    churchId: user?.churchId,
    memberId: user?.memberId,
  });
  const visibleRecords = ownsRecords ? records : [];
  const totalMinor = sumConfirmedGivingMinor(visibleRecords);
  const hasOlderRecords = visibleRecords.length < totalRecords;
  const paginationAction = paginationActionState('older gifts', {
    offline,
    loading: isLoadingMore,
    refreshing: isRefreshing,
    requiresRefresh: Boolean(error),
  });
  const retry = givingHistoryRetryAccessibility(offline);

  if (isLoading || (!ownsRecords && !error)) {
    return <ScreenSkeleton cards={4} showHero />;
  }

  return (
    <View style={styles.container}>
      {!error || visibleRecords.length > 0 ? (
        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>{hasOlderRecords || error ? 'Loaded confirmed giving' : 'Confirmed giving'}</Text>
          <Text style={styles.summaryAmount}>{formatMoney(totalMinor)}</Text>
          <Text style={styles.summaryDetail}>{visibleRecords.length} of {totalRecords} {totalRecords === 1 ? 'record' : 'records'} loaded</Text>
        </View>
      ) : null}
      <FlatList
        ref={listRef}
        data={visibleRecords}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => { if (!offline) void loadHistory(true); }} enabled={!offline} tintColor={colors.primary} />}
        ListHeaderComponent={error && visibleRecords.length > 0 ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText} accessibilityRole="alert">{error} Showing your last loaded records.</Text>
            <TouchableOpacity style={[styles.textAction, retry.disabled && styles.actionDisabled]} onPress={() => void loadHistory(true)} accessibilityRole="button" disabled={retry.disabled} accessibilityState={{ disabled: retry.disabled }} accessibilityHint={retry.hint}>
              <Text style={styles.bannerRetry}>{retry.label}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      renderItem={({ item }) => {
        const recoveryReference = pendingGivingRecoveryReference(item);
        const record = (
          <Card style={styles.recordCard}>
            <View style={styles.recordHeader}>
              <View style={styles.recordInfo}>
                <Text style={styles.recordType}>{item.type.replaceAll('_', ' ')}</Text>
                <Text style={styles.recordDate}>{new Date(item.occurredAt || item.createdAt).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
              </View>
              <Text style={styles.recordAmount}>{formatMoney(item.grossMinor, item.currency)}</Text>
            </View>
            <View style={styles.recordFooter}>
              <Text style={styles.channel}>{item.channel.replaceAll('_', ' ')}</Text>
              <View style={[styles.status, { backgroundColor: `${statusColors[item.status]}18` }]}>
                <Text style={[styles.statusText, { color: statusColors[item.status] }]}>{item.status}</Text>
              </View>
            </View>
            {item.chargedMinor + item.levyMinor > item.grossMinor ? (
              <Text style={styles.levy}>
                Total debit {formatMoney(item.chargedMinor + item.levyMinor, item.currency)}
                {memberPaymentUpliftMinor(item) > 0 ? ` · ${formatMoney(memberPaymentUpliftMinor(item), item.currency)} payment fee` : ''}
                {item.levyMinor > 0 ? ` · ${formatMoney(item.levyMinor, item.currency)} E-Levy` : ''}
              </Text>
            ) : null}
            {recoveryReference ? <Text style={styles.recovery}>Check this payment’s status →</Text> : null}
          </Card>
        );
        return recoveryReference ? (
          <TouchableOpacity
            onPress={() => navigation.navigate('GivingComplete', { reference: recoveryReference })}
            activeOpacity={0.82}
            accessibilityRole="button"
            accessibilityLabel={`Check pending ${item.type.replaceAll('_', ' ')} payment of ${formatMoney(item.grossMinor, item.currency)}`}
            accessibilityHint="Verifies this existing payment without starting another charge."
          >
            {record}
          </TouchableOpacity>
        ) : record;
      }}
        ListEmptyComponent={
          <StatePanel
            icon={error ? (offline ? 'cloud-offline-outline' : 'receipt-outline') : 'heart-outline'}
            tone={error ? (offline ? 'offline' : 'error') : 'quiet'}
            title={error ? (offline ? 'Your history is offline' : 'History unavailable') : 'Your first gift starts here'}
            message={error || 'Completed and pending gifts stay together here, so every contribution is easy to trace.'}
            actionLabel={error ? (offline ? 'Reconnect to retry' : 'Try again') : undefined}
            actionHint={offline ? 'Reconnect to load your giving history.' : 'Loads your giving history again.'}
            actionDisabled={offline}
            onAction={error ? () => void loadHistory() : undefined}
          />
        }
        ListFooterComponent={visibleRecords.length > 0 ? (
          <View style={styles.footer}>
            {hasOlderRecords ? (
              <TouchableOpacity
                style={[styles.loadMore, paginationAction.disabled && styles.actionDisabled]}
                onPress={() => void loadHistory(false, loadedPage + 1)}
                disabled={paginationAction.disabled}
                accessibilityRole="button"
                accessibilityLabel={paginationAction.label}
                accessibilityHint={paginationAction.hint}
                accessibilityState={{ disabled: paginationAction.disabled, busy: paginationAction.busy }}
              >
                <Text style={styles.loadMoreText}>{paginationAction.label}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.endText}>You’ve reached the beginning of your giving history.</Text>
            )}
          </View>
        ) : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  summary: { backgroundColor: colors.text, paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing['2xl'] },
  summaryLabel: { color: colors.primaryLight, fontFamily: typography.families.bold, fontSize: typography.sizes.xs, letterSpacing: 1.25, textTransform: 'uppercase' },
  summaryAmount: { color: colors.surface, fontFamily: typography.families.bold, fontSize: typography.sizes['4xl'], letterSpacing: -1.2, marginTop: spacing.sm },
  summaryDetail: { color: 'rgba(255,255,255,.65)', fontFamily: typography.families.medium, fontSize: typography.sizes.sm, marginTop: spacing.sm },
  list: { width: '100%', maxWidth: 680, alignSelf: 'center', padding: spacing.base, flexGrow: 1 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, backgroundColor: '#FFF7F5', borderRadius: borderRadius.lg, padding: spacing.md, marginBottom: spacing.md },
  errorText: { color: colors.error, fontSize: typography.sizes.sm, lineHeight: 19, flex: 1 },
  bannerRetry: { color: colors.primary, fontFamily: typography.families.semibold, fontSize: typography.sizes.sm, paddingVertical: spacing.xs },
  recordCard: { marginBottom: spacing.md, borderRadius: borderRadius.xl },
  recordHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  recordInfo: { flex: 1 },
  recordType: { color: colors.text, fontFamily: typography.families.semibold, fontSize: typography.sizes.base, textTransform: 'capitalize' },
  recordDate: { color: colors.muted, fontSize: typography.sizes.sm, marginTop: 3 },
  recordAmount: { color: colors.text, fontFamily: typography.families.bold, fontSize: typography.sizes.lg, flexShrink: 1, textAlign: 'right' },
  recordFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md },
  channel: { color: colors.textSecondary, fontSize: typography.sizes.sm, textTransform: 'capitalize' },
  status: { borderRadius: borderRadius.full, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  statusText: { fontFamily: typography.families.bold, fontSize: typography.sizes.xs, textTransform: 'capitalize' },
  levy: { color: colors.muted, fontSize: typography.sizes.xs, marginTop: spacing.sm },
  recovery: { color: colors.primaryDark, fontFamily: typography.families.semibold, fontSize: typography.sizes.sm, marginTop: spacing.md },
  textAction: { minHeight: 44, justifyContent: 'center' },
  actionDisabled: { opacity: 0.5 },
  footer: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.xl },
  loadMore: { minHeight: 48, minWidth: 190, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primary, borderRadius: borderRadius.full, paddingHorizontal: spacing.xl },
  loadMoreText: { color: colors.primaryDark, fontFamily: typography.families.semibold, fontSize: typography.sizes.sm },
  endText: { color: colors.muted, fontFamily: typography.families.medium, fontSize: typography.sizes.sm, textAlign: 'center' },
});
