import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Card } from '../../components/common/Card';
import { colors, typography, spacing, borderRadius } from '../../theme';
import type { GivingRecord } from '../../services/giving.service';

// TODO: Replace with real API call
const mockHistory: GivingRecord[] = [
  {
    id: '1',
    amount: 100,
    currency: 'USD',
    type: 'tithe',
    paymentMethod: 'card',
    status: 'completed',
    reference: 'TXN-001',
    createdAt: '2026-03-28T09:00:00Z',
  },
  {
    id: '2',
    amount: 50,
    currency: 'USD',
    type: 'offering',
    paymentMethod: 'bank',
    status: 'completed',
    reference: 'TXN-002',
    createdAt: '2026-03-21T10:30:00Z',
  },
  {
    id: '3',
    amount: 250,
    currency: 'USD',
    type: 'building_fund',
    paymentMethod: 'card',
    status: 'completed',
    reference: 'TXN-003',
    note: 'Monthly building fund contribution',
    createdAt: '2026-03-14T14:00:00Z',
  },
  {
    id: '4',
    amount: 75,
    currency: 'USD',
    type: 'donation',
    paymentMethod: 'mobile_money',
    status: 'pending',
    reference: 'TXN-004',
    createdAt: '2026-03-07T16:45:00Z',
  },
];

const statusColors: Record<string, string> = {
  completed: colors.success,
  pending: colors.warning,
  failed: colors.error,
};

export function GivingHistoryScreen() {
  const [records, setRecords] = useState<GivingRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // TODO: Replace with givingService.getHistory()
    const loadHistory = async () => {
      try {
        await new Promise<void>((resolve) => { setTimeout(() => resolve(), 500); });
        setRecords(mockHistory);
      } catch (error) {
        console.error('Failed to load giving history:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadHistory();
  }, []);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const renderRecord = ({ item }: { item: GivingRecord }) => (
    <Card style={styles.recordCard}>
      <View style={styles.recordHeader}>
        <View>
          <Text style={styles.recordType}>
            {item.type.replace('_', ' ').toUpperCase()}
          </Text>
          <Text style={styles.recordDate}>{formatDate(item.createdAt)}</Text>
        </View>
        <Text style={styles.recordAmount}>
          ${item.amount.toFixed(2)}
        </Text>
      </View>
      <View style={styles.recordFooter}>
        <Text style={styles.recordMethod}>
          {item.paymentMethod.replace('_', ' ')}
        </Text>
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: (statusColors[item.status] || colors.muted) + '20' },
          ]}
        >
          <Text
            style={[
              styles.statusText,
              { color: statusColors[item.status] || colors.muted },
            ]}
          >
            {item.status}
          </Text>
        </View>
      </View>
      {item.note && <Text style={styles.recordNote}>{item.note}</Text>}
    </Card>
  );

  // Calculate total
  const total = records
    .filter((r) => r.status === 'completed')
    .reduce((sum, r) => sum + r.amount, 0);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Summary */}
      <View style={styles.summary}>
        <Text style={styles.summaryLabel}>Total Given</Text>
        <Text style={styles.summaryAmount}>${total.toFixed(2)}</Text>
      </View>

      <FlatList
        data={records}
        keyExtractor={(item) => item.id}
        renderItem={renderRecord}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No giving records yet.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  summary: {
    backgroundColor: colors.primary,
    padding: spacing.xl,
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: typography.sizes.md,
    color: 'rgba(255,255,255,0.8)',
  },
  summaryAmount: {
    fontSize: typography.sizes['4xl'],
    fontWeight: typography.weights.bold,
    color: '#FFFFFF',
    marginTop: spacing.xs,
  },
  list: {
    padding: spacing.xl,
  },
  recordCard: {
    marginBottom: spacing.md,
  },
  recordHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  recordType: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.text,
  },
  recordDate: {
    fontSize: typography.sizes.sm,
    color: colors.muted,
    marginTop: 2,
  },
  recordAmount: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.text,
  },
  recordFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  recordMethod: {
    fontSize: typography.sizes.sm,
    color: colors.muted,
    textTransform: 'capitalize',
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  statusText: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.semibold,
    textTransform: 'capitalize',
  },
  recordNote: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: spacing.sm,
  },
  empty: {
    alignItems: 'center',
    paddingTop: spacing['4xl'],
  },
  emptyText: {
    fontSize: typography.sizes.base,
    color: colors.muted,
  },
});
