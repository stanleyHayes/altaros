import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Card } from '../../components/common/Card';
import givingService, { formatMoney, type GivingRecord } from '../../services/giving.service';
import { borderRadius, colors, spacing, typography } from '../../theme';

const statusColors: Record<GivingRecord['status'], string> = {
  success: colors.success,
  pending: colors.warning,
  failed: colors.error,
  reversed: colors.muted,
};

export function GivingHistoryScreen() {
  const [records, setRecords] = useState<GivingRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadHistory = useCallback(async (refresh = false) => {
    refresh ? setIsRefreshing(true) : setIsLoading(true);
    setError('');
    try {
      setRecords(await givingService.getHistory());
    } catch {
      setError('We could not load your giving history.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const totalMinor = useMemo(
    () => records.filter((record) => record.status === 'success').reduce((sum, record) => sum + record.grossMinor, 0),
    [records],
  );

  if (isLoading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /><Text style={styles.loadingText}>Loading your gifts…</Text></View>;
  }

  return (
    <View style={styles.container}>
      <View style={styles.summary}>
        <Text style={styles.summaryLabel}>Confirmed giving</Text>
        <Text style={styles.summaryAmount}>{formatMoney(totalMinor)}</Text>
        <Text style={styles.summaryDetail}>{records.length} {records.length === 1 ? 'record' : 'records'} in your history</Text>
      </View>
      <FlatList
        data={records}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void loadHistory(true)} tintColor={colors.primary} />}
        renderItem={({ item }) => (
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
            {item.levyMinor > 0 ? <Text style={styles.levy}>Includes {formatMoney(item.levyMinor, item.currency)} E-Levy</Text> : null}
          </Card>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{error ? 'History unavailable' : 'Your first gift will appear here'}</Text>
            <Text style={styles.emptyBody}>{error || 'Completed and pending gifts are kept together so you can always trace what happened.'}</Text>
            {error ? <TouchableOpacity onPress={() => void loadHistory()} accessibilityRole="button"><Text style={styles.retry}>Try again</Text></TouchableOpacity> : null}
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  loadingText: { color: colors.muted, fontSize: typography.sizes.md, marginTop: spacing.md },
  summary: { backgroundColor: colors.text, paddingHorizontal: spacing.xl, paddingVertical: spacing['2xl'] },
  summaryLabel: { color: 'rgba(255,255,255,.6)', fontSize: typography.sizes.md },
  summaryAmount: { color: colors.surface, fontSize: typography.sizes['4xl'], fontWeight: typography.weights.bold, letterSpacing: -1.2, marginTop: spacing.xs },
  summaryDetail: { color: colors.primaryLight, fontSize: typography.sizes.sm, marginTop: spacing.sm },
  list: { width: '100%', maxWidth: 680, alignSelf: 'center', padding: spacing.base, flexGrow: 1 },
  recordCard: { marginBottom: spacing.md },
  recordHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  recordInfo: { flex: 1 },
  recordType: { color: colors.text, fontSize: typography.sizes.base, fontWeight: typography.weights.semibold, textTransform: 'capitalize' },
  recordDate: { color: colors.muted, fontSize: typography.sizes.sm, marginTop: 3 },
  recordAmount: { color: colors.text, fontSize: typography.sizes.lg, fontWeight: typography.weights.bold },
  recordFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md },
  channel: { color: colors.textSecondary, fontSize: typography.sizes.sm, textTransform: 'capitalize' },
  status: { borderRadius: borderRadius.full, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  statusText: { fontSize: typography.sizes.xs, fontWeight: typography.weights.bold, textTransform: 'capitalize' },
  levy: { color: colors.muted, fontSize: typography.sizes.xs, marginTop: spacing.sm },
  empty: { alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing['4xl'] },
  emptyTitle: { color: colors.text, fontSize: typography.sizes.lg, fontWeight: typography.weights.semibold, textAlign: 'center' },
  emptyBody: { color: colors.muted, fontSize: typography.sizes.md, lineHeight: 21, textAlign: 'center', marginTop: spacing.sm },
  retry: { color: colors.primary, fontWeight: typography.weights.semibold, marginTop: spacing.lg },
});
