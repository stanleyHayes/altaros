import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Linking,
  RefreshControl,
} from 'react-native';
import { Card } from '../../components/common/Card';
import { colors, typography, spacing, borderRadius } from '../../theme';
import type { Sermon } from '../../services/spiritual.service';
import spiritualService, { sermonPlaybackAction } from '../../services/spiritual.service';
import { ScreenSkeleton } from '../../components/common/ScreenSkeleton';
import { useAuth } from '../../hooks/useAuth';
import { createLatestRequestGate } from '../../services/latest-request';
import { connectivityErrorMessage } from '../../services/connectivity';
import { useKnownOffline } from '../../hooks/useKnownOffline';
import { createSubmissionLock } from '../../services/submission-lock';
import { spiritualContentBelongsToIdentity, type SpiritualScreenOwner } from './spiritual-screen-state';
import { StatePanel } from '../../components/common/StatePanel';
import { Ionicons } from '@expo/vector-icons';

export function SermonsScreen() {
  const { user } = useAuth();
  const offline = useKnownOffline();
  const [sermons, setSermons] = useState<Sermon[]>([]);
  const [contentOwner, setContentOwner] = useState<SpiritualScreenOwner | null>(() => ({
    churchId: user?.churchId,
    memberId: user?.id,
  }));
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [mediaError, setMediaError] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const hasLoaded = useRef(false);
  const loadGate = useRef(createLatestRequestGate());
  const playbackLock = useRef(createSubmissionLock());
  const mountedRef = useRef(true);
  const offlineRef = useRef(offline);
  const activeIdentityRef = useRef<SpiritualScreenOwner>({ churchId: user?.churchId, memberId: user?.id });
  const contentOwnerRef = useRef(contentOwner);
  const activeSermonIdsRef = useRef(new Set<string>());
  offlineRef.current = offline;
  activeIdentityRef.current = { churchId: user?.churchId, memberId: user?.id };
  contentOwnerRef.current = contentOwner;
  activeSermonIdsRef.current = new Set(sermons.map((sermon) => sermon.id));

  const loadSermons = useCallback(async (refresh = false) => {
    const request = loadGate.current.begin();
    const startedOwner = { churchId: user?.churchId, memberId: user?.id };
    if (!spiritualContentBelongsToIdentity(contentOwnerRef.current, startedOwner)) {
      contentOwnerRef.current = startedOwner;
      setContentOwner(startedOwner);
      setSermons([]);
      setMediaError('');
      setOpeningId(null);
      playbackLock.current.release();
      hasLoaded.current = false;
    }
    if (refresh) setIsRefreshing(true);
    else if (!hasLoaded.current) setIsLoading(true);
    setError('');
    try {
      if (!user?.churchId || !user.id) throw new Error('No church selected');
      const result = await spiritualService.getSermons(user.churchId, { limit: 40 });
      if (loadGate.current.isLatest(request)) {
        setSermons(result.sermons);
        const loadedOwner = { churchId: user.churchId, memberId: user.id };
        contentOwnerRef.current = loadedOwner;
        setContentOwner(loadedOwner);
      }
    } catch (cause) {
      if (loadGate.current.isLatest(request)) setError(connectivityErrorMessage(cause, 'Sermons are unavailable right now.'));
    } finally {
      if (loadGate.current.isLatest(request)) {
        hasLoaded.current = true;
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [user?.churchId, user?.id]);

  useEffect(() => {
    mountedRef.current = true;
    const gate = loadGate.current;
    void loadSermons();
    return () => { mountedRef.current = false; gate.invalidate(); };
  }, [loadSermons]);

  const openMedia = async (item: Sermon) => {
    const startedChurchId = user?.churchId;
    const startedMemberId = user?.id;
    if (!startedChurchId || !startedMemberId
      || !mountedRef.current
      || !spiritualContentBelongsToIdentity(contentOwnerRef.current, activeIdentityRef.current)
      || !activeSermonIdsRef.current.has(item.id)) return;
    const action = sermonPlaybackAction(item, offline, openingId);
    if (!action.url || action.disabled || !playbackLock.current.acquire()) return;
    setMediaError('');
    setOpeningId(item.id);
    try {
      if (!(await Linking.canOpenURL(action.url))) throw new Error('unsupported media URL');
      if (!mountedRef.current
        || offlineRef.current
        || activeIdentityRef.current.churchId !== startedChurchId
        || activeIdentityRef.current.memberId !== startedMemberId
        || !activeSermonIdsRef.current.has(item.id)) return;
      await Linking.openURL(action.url);
    } catch {
      if (mountedRef.current
        && activeIdentityRef.current.churchId === startedChurchId
        && activeIdentityRef.current.memberId === startedMemberId
        && activeSermonIdsRef.current.has(item.id)) {
        setMediaError(`“${item.title}” could not be opened on this device.`);
      }
    } finally {
      if (mountedRef.current) setOpeningId(null);
      playbackLock.current.release();
    }
  };

  const displayDate = (value: string) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? value
      : parsed.toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const renderSermon = ({ item }: { item: Sermon }) => {
    const playback = sermonPlaybackAction(item, offline, openingId);
    return <Card style={[styles.sermonCard, playback.busy && styles.playbackPending]}>
      <View style={styles.sermonRow}>
        <TouchableOpacity
          style={styles.playButton}
          activeOpacity={0.7}
          disabled={playback.disabled}
          onPress={() => void openMedia(item)}
          accessibilityRole="link"
          accessibilityLabel={playback.label}
          accessibilityHint={playback.hint}
          accessibilityState={{ disabled: playback.disabled, busy: playback.busy }}
        >
          <Ionicons name="play" size={18} color={colors.surface} accessible={false} />
        </TouchableOpacity>
        <View style={styles.sermonInfo}>
          <Text style={styles.sermonTitle}>{item.title}</Text>
          <Text style={styles.sermonSpeaker}>{item.speaker}</Text>
          <View style={styles.sermonMeta}>
            <Text style={styles.metaText}>{displayDate(item.date)}</Text>
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
    </Card>;
  };

  const ownsContent = spiritualContentBelongsToIdentity(contentOwner, activeIdentityRef.current);
  const visibleSermons = ownsContent ? sermons : [];

  if (isLoading || !ownsContent) {
    return <ScreenSkeleton cards={4} />;
  }

  return (
    <FlatList
      style={styles.container}
      data={visibleSermons}
      keyExtractor={(item) => item.id}
      renderItem={renderSermon}
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => { if (!offline) void loadSermons(true); }} enabled={!offline} tintColor={colors.primary} />}
      ListHeaderComponent={(
        <>
          {mediaError ? <Text style={styles.mediaError} accessibilityRole="alert">{mediaError}</Text> : null}
          {error && visibleSermons.length > 0 ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText} accessibilityRole="alert">{error} Showing the last loaded messages.</Text>
              <TouchableOpacity onPress={() => void loadSermons(true)} accessibilityRole="button" disabled={offline} accessibilityState={{ disabled: offline }} accessibilityHint={offline ? 'Reconnect to refresh sermons.' : undefined} style={offline && styles.actionDisabled}>
                <Text style={styles.bannerRetry}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </>
      )}
      ListEmptyComponent={
        <StatePanel
          icon={error ? (offline ? 'cloud-offline-outline' : 'headset-outline') : 'mic-outline'}
          tone={error ? (offline ? 'offline' : 'error') : 'quiet'}
          title={error ? (offline ? 'Messages are offline' : 'Could not load sermons') : 'No sermons available yet'}
          message={error || 'Messages published by your church will appear here.'}
          actionLabel={error ? (offline ? 'Reconnect to retry' : 'Try again') : undefined}
          actionHint={offline ? 'Reconnect to load sermons.' : 'Loads sermons again.'}
          actionDisabled={offline}
          onAction={error ? () => void loadSermons() : undefined}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  actionDisabled: { opacity: 0.5 },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  list: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    padding: spacing.xl,
    flexGrow: 1,
  },
  sermonCard: {
    marginBottom: spacing.md,
  },
  playbackPending: { opacity: 0.62 },
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
  sermonInfo: {
    flex: 1,
  },
  sermonTitle: {
    fontSize: typography.sizes.base,
    fontFamily: typography.families.semibold,
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
    fontFamily: typography.families.medium,
  },
  description: {
    fontSize: typography.sizes.md,
    color: colors.muted,
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  mediaError: { color: colors.error, backgroundColor: '#FFF7F5', padding: spacing.md, borderRadius: borderRadius.lg, marginBottom: spacing.md },
  errorBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, backgroundColor: '#FFF7F5', borderRadius: borderRadius.lg, padding: spacing.md, marginBottom: spacing.md },
  errorText: { color: colors.error, fontSize: typography.sizes.sm, lineHeight: 19, flex: 1 },
  bannerRetry: { color: colors.primary, fontFamily: typography.families.semibold, fontSize: typography.sizes.sm, paddingVertical: spacing.xs },
});
