import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../../components/common/Card';
import { StatePanel } from '../../components/common/StatePanel';
import { borderRadius, colors, spacing, typography } from '../../theme';
import liveService, { type LiveSession } from '../../services/live.service';

/**
 * The church's services — live now, coming up, and finished.
 *
 * Replaces the Zoom or Meet link a church currently pastes into WhatsApp. The
 * difference that matters is not the video: it is that giving happens inside
 * the service instead of in another app the member may not come back from.
 */

function whenText(session: LiveSession): string {
  if (session.status === 'live') {
    const watching = session.currentViewers;
    return watching === 1 ? '1 person watching' : `${watching} people watching`;
  }
  if (session.status === 'ended') {
    return session.endedAt ? `Ended ${new Date(session.endedAt).toLocaleDateString()}` : 'Ended';
  }
  return 'Not started yet';
}

function SessionCard({
  session,
  onOpen,
}: {
  session: LiveSession;
  onOpen: (session: LiveSession) => void;
}) {
  const live = session.status === 'live';
  const full = live && session.maxViewers > 0 && session.currentViewers >= session.maxViewers;

  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <View style={styles.info}>
          <View style={styles.titleRow}>
            {live ? (
              <View style={styles.liveBadge}>
                <View style={styles.dot} />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
            ) : null}
            <Text style={styles.title} numberOfLines={2}>
              {session.title}
            </Text>
          </View>
          <Text style={styles.when}>{whenText(session)}</Text>

          {/*
            Said on the LIST, not only inside the service. Someone deciding
            whether to open a service is entitled to know it is recorded
            before they are in it.
          */}
          {session.recording ? (
            <View style={styles.noticeRow}>
              <Ionicons name="radio-button-on" size={12} color={colors.textSecondary} />
              <Text style={styles.noticeText}>This service is recorded</Text>
            </View>
          ) : null}
        </View>

        {live ? (
          <TouchableOpacity
            style={[styles.watchButton, full && styles.watchDisabled]}
            onPress={() => onOpen(session)}
            disabled={full}
            accessibilityRole="button"
            accessibilityLabel={full ? 'This service is full' : `Watch ${session.title}`}
          >
            <Text style={styles.watchText}>{full ? 'Full' : 'Watch'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </Card>
  );
}

export function LiveScreen() {
  const navigation = useNavigation<{ navigate: (screen: string, params?: object) => void }>();
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setSessions(await liveService.sessions());
    } catch {
      setError('We could not load the services. Check your connection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onOpen = useCallback(
    (session: LiveSession) => {
      navigation.navigate('LiveSession', {
        sessionId: session.id,
        title: session.title,
        campaignId: session.campaignId,
      });
    },
    [navigation],
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      data={sessions}
      keyExtractor={(s) => s.id}
      contentContainerStyle={sessions.length === 0 ? styles.emptyContent : styles.content}
      renderItem={({ item }) => <SessionCard session={item} onOpen={onOpen} />}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void load(true)}
          tintColor={colors.primary}
        />
      }
      ListEmptyComponent={
        error ? (
          <StatePanel
            title="Could not load services"
            icon="alert-circle-outline"
            message={error}
            actionLabel="Try again"
            onAction={() => void load()}
          />
        ) : (
          <StatePanel
            title="No services yet"
            icon="videocam-outline"
            message="When your church goes live, the service will appear here."
          />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  emptyContent: { flexGrow: 1, justifyContent: 'center', padding: spacing.md },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { padding: spacing.md, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  info: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.error,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.surface },
  liveText: {
    color: colors.surface,
    fontFamily: typography.families.bold,
    fontSize: 10,
    letterSpacing: 0.5,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontFamily: typography.families.bold,
    fontSize: typography.sizes.md,
  },
  when: {
    color: colors.textSecondary,
    fontFamily: typography.families.regular,
    fontSize: typography.sizes.xs,
    marginTop: 2,
  },
  noticeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  noticeText: {
    color: colors.textSecondary,
    fontFamily: typography.families.regular,
    fontSize: typography.sizes.xs,
  },
  watchButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    justifyContent: 'center',
  },
  watchDisabled: { backgroundColor: colors.border },
  watchText: {
    color: colors.surface,
    fontFamily: typography.families.bold,
    fontSize: typography.sizes.sm,
  },
});

export default LiveScreen;
