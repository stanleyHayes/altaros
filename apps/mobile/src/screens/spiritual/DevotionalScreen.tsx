import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Card } from '../../components/common/Card';
import { colors, typography, spacing, borderRadius } from '../../theme';
import type { Devotional } from '../../services/spiritual.service';

// TODO: Replace with real API call
const mockDevotional: Devotional = {
  id: '1',
  title: 'Walking by Faith',
  scripture:
    'For we walk by faith, not by sight.',
  scriptureReference: '2 Corinthians 5:7',
  content:
    'Faith is the foundation of our walk with God. It is not about seeing every step ahead, but trusting the One who knows the way. Today, let us be reminded that our faith is not in what we can see or understand, but in the unchanging character of God.\n\nWhen we face uncertainty, we can hold fast to His promises. When the road ahead seems unclear, we can trust that He is guiding our steps. Faith does not eliminate our questions, but it gives us peace in the midst of them.\n\nAs you go through this day, choose to walk by faith. Choose to trust God even when the circumstances around you seem challenging. He is faithful, and He will see you through.',
  author: 'Pastor James',
  date: '2026-03-30',
};

export function DevotionalScreen() {
  const [devotional, setDevotional] = useState<Devotional | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // TODO: Replace with spiritualService.getTodayDevotional()
    const loadDevotional = async () => {
      try {
        // Simulate API delay
        await new Promise<void>((resolve) => { setTimeout(() => resolve(), 500); });
        setDevotional(mockDevotional);
      } catch (error) {
        console.error('Failed to load devotional:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadDevotional();
  }, []);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!devotional) {
    return (
      <View style={styles.loading}>
        <Text style={styles.emptyText}>No devotional available today.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.dateHeader}>
        <Text style={styles.dateText}>{devotional.date}</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>{devotional.title}</Text>
        <Text style={styles.author}>by {devotional.author}</Text>

        <Card style={styles.scriptureCard}>
          <Text style={styles.scriptureText}>"{devotional.scripture}"</Text>
          <Text style={styles.scriptureRef}>
            -- {devotional.scriptureReference}
          </Text>
        </Card>

        <Text style={styles.body}>{devotional.content}</Text>
      </View>
    </ScrollView>
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
  emptyText: {
    fontSize: typography.sizes.base,
    color: colors.muted,
  },
  dateHeader: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  dateText: {
    fontSize: typography.sizes.md,
    color: 'rgba(255,255,255,0.8)',
  },
  content: {
    padding: spacing.xl,
  },
  title: {
    fontSize: typography.sizes['2xl'],
    fontWeight: typography.weights.bold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  author: {
    fontSize: typography.sizes.md,
    color: colors.muted,
    marginBottom: spacing.xl,
  },
  scriptureCard: {
    backgroundColor: colors.primaryLight + '15',
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    marginBottom: spacing.xl,
  },
  scriptureText: {
    fontSize: typography.sizes.lg,
    fontStyle: 'italic',
    color: colors.text,
    lineHeight: 28,
    marginBottom: spacing.sm,
  },
  scriptureRef: {
    fontSize: typography.sizes.md,
    color: colors.primary,
    fontWeight: typography.weights.semibold,
  },
  body: {
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    lineHeight: 26,
  },
});
