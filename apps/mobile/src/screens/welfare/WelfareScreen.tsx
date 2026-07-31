import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { colors, typography, spacing, borderRadius } from '../../theme';

type WelfareCategory = 'medical' | 'financial' | 'bereavement' | 'food' | 'other';
type RequestStatus = 'submitted' | 'in_review' | 'approved' | 'closed';

interface WelfareRequest {
  id: string;
  category: WelfareCategory;
  summary: string;
  status: RequestStatus;
  submittedAt: string;
}

const categories: { value: WelfareCategory; label: string }[] = [
  { value: 'medical', label: 'Medical' },
  { value: 'financial', label: 'Financial' },
  { value: 'bereavement', label: 'Bereavement' },
  { value: 'food', label: 'Food' },
  { value: 'other', label: 'Other' },
];

const statusLabels: Record<RequestStatus, string> = {
  submitted: 'Submitted',
  in_review: 'In review',
  approved: 'Approved',
  closed: 'Closed',
};

const statusColors: Record<RequestStatus, string> = {
  submitted: colors.info,
  in_review: colors.warning,
  approved: colors.success,
  closed: colors.muted,
};

// TODO: Replace with real API data (GET /welfare/requests).
const mockRequests: WelfareRequest[] = [
  {
    id: '1',
    category: 'medical',
    summary: 'Support with hospital bills after surgery.',
    status: 'in_review',
    submittedAt: '2026-07-24T09:00:00Z',
  },
  {
    id: '2',
    category: 'food',
    summary: 'Food support for the family this month.',
    status: 'approved',
    submittedAt: '2026-07-12T14:30:00Z',
  },
];

export function WelfareScreen() {
  const [category, setCategory] = useState<WelfareCategory>('medical');
  const [summary, setSummary] = useState('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [requests] = useState<WelfareRequest[]>(mockRequests);

  const handleSubmit = async () => {
    if (!summary.trim()) {
      Alert.alert('Add a summary', 'Please describe what you need help with.');
      return;
    }

    setSubmitting(true);
    try {
      // TODO: wire to POST /welfare/requests
      await new Promise<void>((resolve) => { setTimeout(() => resolve(), 600); });
      Alert.alert(
        'Request sent',
        'Your request has been sent privately to the pastoral team. Someone will reach out to you.',
      );
      setSummary('');
      setDetails('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEmergency = () => {
    Alert.alert(
      'Send emergency alert?',
      'This immediately notifies the pastoral team that you need urgent help.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send alert',
          style: 'destructive',
          // TODO: wire to POST /welfare/emergency
          onPress: () =>
            Alert.alert('Alert sent', 'The pastoral team has been notified.'),
        },
      ],
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Emergency */}
      <Card style={styles.emergencyCard}>
        <Text style={styles.emergencyTitle}>Need urgent help?</Text>
        <Text style={styles.emergencyBody}>
          Send an immediate alert to your church&apos;s pastoral team.
        </Text>
        <TouchableOpacity
          style={styles.emergencyButton}
          onPress={handleEmergency}
          accessibilityRole="button"
          accessibilityLabel="Send emergency alert"
        >
          <Text style={styles.emergencyButtonText}>Send Emergency Alert</Text>
        </TouchableOpacity>
      </Card>

      {/* Request assistance */}
      <Text style={styles.sectionTitle}>Request assistance</Text>
      <Card style={styles.formCard}>
        <Text style={styles.label}>Category</Text>
        <View style={styles.chipRow}>
          {categories.map((item) => {
            const selected = item.value === category;
            return (
              <TouchableOpacity
                key={item.value}
                onPress={() => setCategory(item.value)}
                style={[styles.chip, selected && styles.chipSelected]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Input
          label="Summary"
          value={summary}
          onChangeText={setSummary}
          placeholder="Briefly, what do you need help with?"
        />

        <Input
          label="Details (optional)"
          value={details}
          onChangeText={setDetails}
          placeholder="Anything the pastoral team should know"
          multiline
          numberOfLines={4}
        />

        <Text style={styles.privacyNote}>
          Welfare requests are private. Only your church&apos;s assigned pastoral
          team can see them.
        </Text>

        <Button
          title={submitting ? 'Sending…' : 'Submit Request'}
          onPress={handleSubmit}
          disabled={submitting}
        />
      </Card>

      {/* Existing requests */}
      <Text style={styles.sectionTitle}>Your requests</Text>
      {requests.length === 0 ? (
        <Card>
          <Text style={styles.emptyText}>You have no welfare requests yet.</Text>
        </Card>
      ) : (
        requests.map((request) => (
          <Card key={request.id} style={styles.requestCard}>
            <View style={styles.requestHeader}>
              <Text style={styles.requestCategory}>
                {categories.find((c) => c.value === request.category)?.label ??
                  'Other'}
              </Text>
              <View
                style={[
                  styles.statusPill,
                  { backgroundColor: `${statusColors[request.status]}22` },
                ]}
              >
                <Text
                  style={[styles.statusText, { color: statusColors[request.status] }]}
                >
                  {statusLabels[request.status]}
                </Text>
              </View>
            </View>
            <Text style={styles.requestSummary}>{request.summary}</Text>
            <Text style={styles.requestDate}>
              {new Date(request.submittedAt).toLocaleDateString()}
            </Text>
          </Card>
        ))
      )}

      <View style={styles.footerSpace} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.base,
  },
  emergencyCard: {
    marginBottom: spacing.xl,
    borderLeftWidth: 4,
    borderLeftColor: colors.error,
  },
  emergencyTitle: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.bold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  emergencyBody: {
    fontSize: typography.sizes.md,
    color: colors.textSecondary,
    marginBottom: spacing.base,
  },
  emergencyButton: {
    backgroundColor: colors.error,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  emergencyButtonText: {
    color: colors.surface,
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.semibold,
  },
  sectionTitle: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.text,
    marginBottom: spacing.md,
  },
  formCard: {
    marginBottom: spacing.xl,
  },
  label: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.base,
  },
  chip: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: typography.sizes.md,
    color: colors.textSecondary,
    fontWeight: typography.weights.medium,
  },
  chipTextSelected: {
    color: colors.surface,
    fontWeight: typography.weights.semibold,
  },
  privacyNote: {
    fontSize: typography.sizes.sm,
    color: colors.muted,
    marginBottom: spacing.base,
    lineHeight: 18,
  },
  requestCard: {
    marginBottom: spacing.md,
  },
  requestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  requestCategory: {
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.semibold,
    color: colors.text,
  },
  statusPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  statusText: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
  },
  requestSummary: {
    fontSize: typography.sizes.md,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  requestDate: {
    fontSize: typography.sizes.sm,
    color: colors.muted,
  },
  emptyText: {
    fontSize: typography.sizes.md,
    color: colors.muted,
    textAlign: 'center',
  },
  footerSpace: {
    height: spacing['3xl'],
  },
});
