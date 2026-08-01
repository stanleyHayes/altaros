import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { Card } from '../../components/common/Card';
import { colors, typography, spacing, borderRadius } from '../../theme';
import type { Sermon } from '../../services/spiritual.service';
import spiritualService from '../../services/spiritual.service';

export function SermonsScreen() {
  const [sermons, setSermons] = useState<Sermon[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadSermons = async () => {
      try {
        const result = await spiritualService.getSermons({ limit: 40 });
        setSermons(result.sermons);
      } catch {
        setSermons([]);
      } finally {
        setIsLoading(false);
      }
    };
    loadSermons();
  }, []);

  const renderSermon = ({ item }: { item: Sermon }) => (
    <Card style={styles.sermonCard}>
      <View style={styles.sermonRow}>
        <TouchableOpacity
          style={styles.playButton}
          activeOpacity={0.7}
          disabled={!item.audioUrl && !item.videoUrl}
          onPress={() => void Linking.openURL(item.audioUrl ?? item.videoUrl ?? '')}
          accessibilityRole="button"
          accessibilityLabel={`Play ${item.title}`}
          accessibilityState={{ disabled: !item.audioUrl && !item.videoUrl }}
        >
          <Text style={styles.playIcon}>{'\u25B6'}</Text>
        </TouchableOpacity>
        <View style={styles.sermonInfo}>
          <Text style={styles.sermonTitle}>{item.title}</Text>
          <Text style={styles.sermonSpeaker}>{item.speaker}</Text>
          <View style={styles.sermonMeta}>
            <Text style={styles.metaText}>{item.date}</Text>
            <Text style={styles.metaDot}>{'\u2022'}</Text>
            <Text style={styles.metaText}>{item.duration}</Text>
          </View>
          {item.series && (
            <View style={styles.seriesBadge}>
              <Text style={styles.seriesText}>{item.series}</Text>
            </View>
          )}
        </View>
      </View>
      {item.description && (
        <Text style={styles.description} numberOfLines={2}>
          {item.description}
        </Text>
      )}
    </Card>
  );

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={sermons}
      keyExtractor={(item) => item.id}
      renderItem={renderSermon}
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No sermons available yet.</Text>
        </View>
      }
    />
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
  list: {
    padding: spacing.xl,
  },
  sermonCard: {
    marginBottom: spacing.md,
  },
  sermonRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  playButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  playIcon: {
    color: '#FFFFFF',
    fontSize: 18,
    marginLeft: 3,
  },
  sermonInfo: {
    flex: 1,
  },
  sermonTitle: {
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.semibold,
    color: colors.text,
  },
  sermonSpeaker: {
    fontSize: typography.sizes.md,
    color: colors.textSecondary,
    marginTop: 2,
  },
  sermonMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  metaText: {
    fontSize: typography.sizes.sm,
    color: colors.muted,
  },
  metaDot: {
    fontSize: typography.sizes.sm,
    color: colors.muted,
    marginHorizontal: spacing.xs,
  },
  seriesBadge: {
    backgroundColor: colors.primaryLight + '20',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  seriesText: {
    fontSize: typography.sizes.xs,
    color: colors.primary,
    fontWeight: typography.weights.medium,
  },
  description: {
    fontSize: typography.sizes.md,
    color: colors.muted,
    marginTop: spacing.sm,
    lineHeight: 20,
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
