import React, { useCallback, useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Card } from '../../components/common/Card';
import { colors, typography, spacing } from '../../theme';
import type { Devotional } from '../../services/spiritual.service';
import spiritualService from '../../services/spiritual.service';
import { ScreenSkeleton } from '../../components/common/ScreenSkeleton';
import { useAuth } from '../../hooks/useAuth';
import { createLatestRequestGate } from '../../services/latest-request';
import { connectivityErrorMessage } from '../../services/connectivity';
import { useKnownOffline } from '../../hooks/useKnownOffline';
import { spiritualContentBelongsToIdentity, type SpiritualScreenOwner } from './spiritual-screen-state';
import { StatePanel } from '../../components/common/StatePanel';
import { useAnimatedRouteTop } from '../../hooks/useAnimatedRouteTop';

export function DevotionalScreen() {
  const { user } = useAuth();
  const offline = useKnownOffline();
  const scrollRef = useRef<ScrollView>(null);
  useAnimatedRouteTop(scrollRef);
  const [devotional, setDevotional] = useState<Devotional | null>(null);
  const [contentOwner, setContentOwner] = useState<SpiritualScreenOwner | null>(() => ({
    churchId: user?.churchId,
    memberId: user?.memberId,
  }));
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const loadGate = useRef(createLatestRequestGate());
  const contentOwnerRef = useRef(contentOwner);
  const activeIdentityRef = useRef<SpiritualScreenOwner>({ churchId: user?.churchId, memberId: user?.memberId });
  contentOwnerRef.current = contentOwner;
  activeIdentityRef.current = { churchId: user?.churchId, memberId: user?.memberId };

  const displayDate = (value: string) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? value
      : parsed.toLocaleDateString('en-GH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };

  const loadDevotional = useCallback(async () => {
      const request = loadGate.current.begin();
      const startedOwner = { churchId: user?.churchId, memberId: user?.memberId };
      if (!spiritualContentBelongsToIdentity(contentOwnerRef.current, startedOwner)) {
        contentOwnerRef.current = startedOwner;
        setContentOwner(startedOwner);
        setDevotional(null);
      }
      setError('');
      setIsLoading(true);
      try {
        if (!user?.churchId || !user.memberId) throw new Error('No church selected');
        const result = await spiritualService.getTodayDevotional(user.churchId);
        if (loadGate.current.isLatest(request)) {
          setDevotional(result);
          const loadedOwner = { churchId: user.churchId, memberId: user.memberId };
          contentOwnerRef.current = loadedOwner;
          setContentOwner(loadedOwner);
        }
      } catch (cause) {
        if (loadGate.current.isLatest(request)) setError(connectivityErrorMessage(cause, 'Today’s devotional could not be loaded.'));
      } finally {
        if (loadGate.current.isLatest(request)) setIsLoading(false);
      }
  }, [user?.churchId, user?.memberId]);

  useEffect(() => {
    const gate = loadGate.current;
    void loadDevotional();
    return () => gate.invalidate();
  }, [loadDevotional]);

  const ownsContent = spiritualContentBelongsToIdentity(contentOwner, activeIdentityRef.current);

  if (isLoading || !ownsContent) {
    return <ScreenSkeleton cards={2} showHero />;
  }

  if (!devotional) {
    return (
      <View style={styles.loading}>
        <StatePanel
          icon={error ? (offline ? 'cloud-offline-outline' : 'book-outline') : 'leaf-outline'}
          tone={error ? (offline ? 'offline' : 'error') : 'quiet'}
          title={error ? (offline ? 'Today’s reading is offline' : 'A quiet moment, delayed') : 'No devotional today'}
          message={error || 'Your church has not published today’s reading yet.'}
          actionLabel={error ? (offline ? 'Reconnect to retry' : 'Try again') : undefined}
          actionHint={offline ? 'Reconnect to load today’s devotional.' : 'Loads today’s devotional again.'}
          actionDisabled={offline}
          onAction={error ? () => void loadDevotional() : undefined}
        />
      </View>
    );
  }

  return (
    <ScrollView ref={scrollRef} style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.dateHeader}>
        <Text style={styles.dateEyebrow}>A QUIET PLACE TO BEGIN</Text>
        <Text style={styles.dateText}>{displayDate(devotional.date)}</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>{devotional.title}</Text>
        <Text style={styles.author}>by {devotional.author}</Text>

        <Card style={styles.scriptureCard}>
          <Text style={styles.scriptureText}>"{devotional.scripture}"</Text>
          {devotional.scriptureReference ? (
            <Text style={styles.scriptureRef}>— {devotional.scriptureReference}</Text>
          ) : null}
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
  dateHeader: {
    backgroundColor: colors.text,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing['2xl'],
  },
  dateEyebrow: { color: colors.primaryLight, fontFamily: typography.families.bold, fontSize: typography.sizes.xs, letterSpacing: 1.35, marginBottom: spacing.sm },
  dateText: {
    fontFamily: typography.families.semibold,
    fontSize: typography.sizes.lg,
    color: colors.surface,
  },
  content: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    padding: spacing.xl,
  },
  title: {
    fontSize: typography.sizes['2xl'],
    fontFamily: typography.families.bold,
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
    fontFamily: typography.families.semibold,
  },
  body: {
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    lineHeight: 26,
  },
});
