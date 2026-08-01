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
import spiritualService from '../../services/spiritual.service';

export function DevotionalScreen() {
  const [devotional, setDevotional] = useState<Devotional | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadDevotional = async () => {
      try {
        setDevotional(await spiritualService.getTodayDevotional());
      } catch {
        setDevotional(null);
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
        <Text style={styles.emptyText}>Today&apos;s devotional is not available yet.</Text>
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
