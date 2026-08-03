import React, { useCallback, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Avatar } from '../../components/common/Avatar';
import { Card } from '../../components/common/Card';
import { useAuth } from '../../hooks/useAuth';
import eventService, { type ChurchEvent } from '../../services/event.service';
import spiritualService, { type Devotional, type Sermon } from '../../services/spiritual.service';
import { borderRadius, colors, spacing, typography } from '../../theme';
import type { RootStackParamList } from '../../components/navigation/AppNavigator';
import { ScreenSkeleton } from '../../components/common/ScreenSkeleton';
import { createLatestRequestGate } from '../../services/latest-request';
import { connectivityErrorMessage } from '../../services/connectivity';
import { useKnownOffline } from '../../hooks/useKnownOffline';
import { homeContentBelongsToIdentity, homeSectionRecoveryAction, type HomeContentOwner } from './home-state';
import { useAnimatedRouteTop } from '../../hooks/useAnimatedRouteTop';
import { Ionicons } from '@expo/vector-icons';

type HomeNav = NativeStackNavigationProp<RootStackParamList>;

const quickActions = [
  { label: 'Give', icon: 'heart-outline' as const, route: 'Give' as const },
  { label: 'Events', icon: 'calendar-outline' as const, route: 'Events' as const },
  { label: 'Prayer', icon: 'sparkles-outline' as const, screen: 'Prayer' as const },
  { label: 'Care', icon: 'hand-left-outline' as const, screen: 'Welfare' as const },
];

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function HomeSectionError({
  message,
  offline,
  refreshing,
  onRetry,
}: {
  message: string;
  offline: boolean;
  refreshing: boolean;
  onRetry: () => void;
}) {
  const action = homeSectionRecoveryAction(offline, refreshing);
  return (
    <View style={styles.sectionErrorPanel}>
      <Text style={styles.sectionError} accessibilityRole="alert">{message}</Text>
      <TouchableOpacity
        style={[styles.sectionRetry, action.disabled && styles.actionDisabled]}
        onPress={onRetry}
        disabled={action.disabled}
        accessibilityRole="button"
        accessibilityLabel={action.label}
        accessibilityHint={action.hint}
        accessibilityState={{ disabled: action.disabled, busy: action.busy }}
      >
        <Text style={styles.sectionRetryText}>{action.label}</Text>
      </TouchableOpacity>
    </View>
  );
}

export function HomeScreen() {
  const navigation = useNavigation<HomeNav>();
  const { user } = useAuth();
  const offline = useKnownOffline();
  const [events, setEvents] = useState<ChurchEvent[]>([]);
  const [devotional, setDevotional] = useState<Devotional | null>(null);
  const [sermons, setSermons] = useState<Sermon[]>([]);
  const [contentOwner, setContentOwner] = useState<HomeContentOwner | null>(() => ({
    churchId: user?.churchId,
    memberId: user?.memberId,
  }));
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [eventError, setEventError] = useState('');
  const [devotionalError, setDevotionalError] = useState('');
  const [sermonError, setSermonError] = useState('');
  const loadGate = useRef(createLatestRequestGate());
  const refreshInFlightRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  useAnimatedRouteTop(scrollRef);
  const contentOwnerRef = useRef(contentOwner);
  const activeIdentityRef = useRef<HomeContentOwner>({ churchId: user?.churchId, memberId: user?.memberId });
  contentOwnerRef.current = contentOwner;
  activeIdentityRef.current = { churchId: user?.churchId, memberId: user?.memberId };

  const loadHome = useCallback(async (refresh = false) => {
    const request = loadGate.current.begin();
    const startedOwner = { churchId: user?.churchId, memberId: user?.memberId };
    if (!homeContentBelongsToIdentity(contentOwnerRef.current, startedOwner)) {
      contentOwnerRef.current = startedOwner;
      setContentOwner(startedOwner);
      setEvents([]);
      setDevotional(null);
      setSermons([]);
      setIsLoading(true);
    }
    if (refresh) setRefreshing(true);
    else setRefreshing(false);
    setEventError('');
    setDevotionalError('');
    setSermonError('');
    const churchId = user?.churchId;
    const [eventResult, devotionalResult, sermonResult] = await Promise.allSettled([
      churchId && user?.memberId
        ? eventService.getUpcoming(churchId, user.memberId, 3)
        : Promise.reject(new Error('No church selected')),
      churchId
        ? spiritualService.getTodayDevotional(churchId)
        : Promise.reject(new Error('No church selected')),
      churchId
        ? spiritualService.getSermons(churchId, { limit: 2 })
        : Promise.reject(new Error('No church selected')),
    ]);
    if (!loadGate.current.isLatest(request)) return;
    contentOwnerRef.current = startedOwner;
    setContentOwner(startedOwner);
    if (eventResult.status === 'fulfilled') setEvents(eventResult.value);
    else setEventError(connectivityErrorMessage(eventResult.reason, 'Upcoming events could not be loaded.'));
    if (devotionalResult.status === 'fulfilled') setDevotional(devotionalResult.value);
    else setDevotionalError(connectivityErrorMessage(devotionalResult.reason, 'Today’s devotional is unavailable right now.'));
    if (sermonResult.status === 'fulfilled') setSermons(sermonResult.value.sermons);
    else setSermonError(connectivityErrorMessage(sermonResult.reason, 'Recent sermons could not be loaded.'));
    setIsLoading(false);
    setRefreshing(false);
  }, [user?.churchId, user?.memberId]);

  const refreshHome = useCallback(() => {
    if (offline || refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    void loadHome(true).finally(() => { refreshInFlightRef.current = false; });
  }, [loadHome, offline]);

  useFocusEffect(useCallback(() => {
    const gate = loadGate.current;
    void loadHome();
    return () => gate.invalidate();
  }, [loadHome]));

  const fullName = `${user?.firstName ?? 'Member'} ${user?.lastName ?? ''}`.trim();
  const ownsContent = homeContentBelongsToIdentity(contentOwner, activeIdentityRef.current);
  const visibleEvents = ownsContent ? events : [];
  const visibleDevotional = ownsContent ? devotional : null;
  const visibleSermons = ownsContent ? sermons : [];

  if (isLoading || !ownsContent) return <ScreenSkeleton cards={3} showHero />;

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshHome} enabled={!offline} tintColor={colors.primary} />}
    >
      <View style={styles.topRow}>
        <View style={styles.heroOrb} accessible={false} />
        <View style={styles.heroRing} accessible={false} />
        <View style={styles.greetingWrap}>
          <Text style={styles.heroEyebrow}>YOUR CHURCH, THIS WEEK</Text>
          <Text style={styles.greeting}>{greeting()},</Text>
          <Text style={styles.name}>{user?.firstName || 'Member'}.</Text>
          <Text style={styles.church}>{user?.churchName || 'Your church community'}</Text>
        </View>
        <View style={styles.heroActions}>
          <TouchableOpacity
            style={styles.notificationButton}
            onPress={() => navigation.navigate('Notifications')}
            accessibilityRole="button"
            accessibilityLabel="Open notifications"
          >
            <Ionicons name="notifications-outline" size={19} color={colors.surface} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => navigation.navigate('MainTabs', { screen: 'Profile' })}
            accessibilityRole="button"
            accessibilityLabel="Open your profile"
          >
            <Avatar name={fullName} uri={user?.avatar} size="lg" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.actionGrid}>
        {quickActions.map((action) => (
          <TouchableOpacity
            key={action.label}
            style={styles.action}
            onPress={() => action.route
              ? navigation.navigate('MainTabs', { screen: action.route })
              : navigation.navigate(action.screen)}
            accessibilityRole="button"
            accessibilityLabel={action.label}
          >
            <View style={styles.actionIcon}><Ionicons name={action.icon} size={21} color={colors.primaryDark} /></View>
            <Text style={styles.actionLabel}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionKicker}>FOR TODAY</Text>
        <Text style={styles.sectionTitle}>A quiet place to begin.</Text>
      </View>
      <TouchableOpacity onPress={() => navigation.navigate('Devotional')} activeOpacity={.82} accessibilityRole="button" accessibilityLabel="Open today’s devotional">
        <Card style={styles.devotionalCard}>
          <Text style={styles.devotionalRef}>{visibleDevotional?.scriptureReference || 'Daily devotional'}</Text>
          <Text style={styles.devotionalTitle}>{visibleDevotional?.title || (devotionalError ? 'Reading unavailable' : 'No devotional has been published today')}</Text>
          {visibleDevotional?.scripture ? <Text style={styles.devotionalText} numberOfLines={3}>“{visibleDevotional.scripture}”</Text> : null}
          <Text style={styles.cardLink}>{devotionalError ? 'Try the devotional screen →' : 'Read today’s devotional →'}</Text>
        </Card>
      </TouchableOpacity>
      {devotionalError ? <HomeSectionError message={devotionalError} offline={offline} refreshing={refreshing} onRetry={refreshHome} /> : null}

      <View style={styles.sectionHeaderRow}>
        <View>
          <Text style={styles.sectionKicker}>COMING UP</Text>
          <Text style={styles.sectionTitle}>Gather together.</Text>
        </View>
        <TouchableOpacity style={styles.seeAllButton} onPress={() => navigation.navigate('MainTabs', { screen: 'Events' })} accessibilityRole="button"><Text style={styles.seeAll}>All events</Text></TouchableOpacity>
      </View>
      {eventError ? <HomeSectionError message={eventError} offline={offline} refreshing={refreshing} onRetry={refreshHome} /> : null}
      {visibleEvents.length === 0 && !eventError ? <Text style={styles.emptyText}>No upcoming events have been published.</Text> : visibleEvents.map((event) => {
        const date = new Date(event.startDate);
        return (
          <TouchableOpacity key={event.id} onPress={() => navigation.navigate('EventDetail', { eventId: event.id })} activeOpacity={.8} accessibilityRole="button" accessibilityLabel={`Open ${event.title} event details`}>
            <View style={styles.eventRow}>
              <View style={styles.dateTile}><Text style={styles.dateMonth}>{date.toLocaleDateString('en-GH', { month: 'short' })}</Text><Text style={styles.dateDay}>{date.getDate()}</Text></View>
              <View style={styles.eventInfo}><Text style={styles.eventTitle}>{event.title}</Text><Text style={styles.eventMeta}>{date.toLocaleTimeString('en-GH', { hour: 'numeric', minute: '2-digit' })} · {event.location}</Text></View>
              <Text style={styles.chevron}>›</Text>
            </View>
          </TouchableOpacity>
        );
      })}

      <View style={styles.sectionHeaderRow}>
        <View><Text style={styles.sectionKicker}>LISTEN AGAIN</Text><Text style={styles.sectionTitle}>Recent messages.</Text></View>
        <TouchableOpacity style={styles.seeAllButton} onPress={() => navigation.navigate('Sermons')} accessibilityRole="button"><Text style={styles.seeAll}>All sermons</Text></TouchableOpacity>
      </View>
      {sermonError ? <HomeSectionError message={sermonError} offline={offline} refreshing={refreshing} onRetry={refreshHome} /> : null}
      {visibleSermons.length === 0 && !sermonError ? <Text style={styles.emptyText}>No sermons are available yet.</Text> : visibleSermons.map((sermon) => (
        <TouchableOpacity key={sermon.id} onPress={() => navigation.navigate('Sermons')} style={styles.sermonRow} accessibilityRole="button">
          <View style={styles.play}><Text style={styles.playText}>▶</Text></View>
          <View style={styles.eventInfo}><Text style={styles.eventTitle}>{sermon.title}</Text><Text style={styles.eventMeta}>{sermon.speaker} · {sermon.duration}</Text></View>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: spacing.base, paddingBottom: spacing['4xl'] },
  topRow: { minHeight: 188, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', backgroundColor: colors.text, borderRadius: borderRadius['2xl'], padding: spacing.xl, overflow: 'hidden' },
  heroOrb: { position: 'absolute', width: 190, height: 190, borderRadius: 95, backgroundColor: '#174C45', top: -92, right: -48 },
  heroRing: { position: 'absolute', width: 130, height: 130, borderRadius: 65, borderWidth: 1, borderColor: 'rgba(109,213,196,.28)', top: -48, right: 18 },
  greetingWrap: { flex: 1, paddingRight: spacing.md },
  heroEyebrow: { color: colors.primaryLight, fontFamily: typography.families.bold, fontSize: typography.sizes.xs, letterSpacing: 1.45, marginBottom: spacing.lg },
  greeting: { color: 'rgba(255,255,255,.62)', fontFamily: typography.families.regular, fontSize: typography.sizes.base },
  name: { color: colors.surface, fontFamily: typography.families.bold, fontSize: typography.sizes['4xl'], lineHeight: 40, letterSpacing: -1.3 },
  church: { color: colors.primaryLight, fontFamily: typography.families.medium, fontSize: typography.sizes.sm, marginTop: spacing.sm },
  heroActions: { alignItems: 'center', gap: spacing.md },
  notificationButton: { width: 44, height: 44, borderRadius: borderRadius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,.14)' },
  actionGrid: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: borderRadius.xl, marginTop: -14, marginHorizontal: spacing.sm, marginBottom: spacing.xl, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.base, borderWidth: 1, borderColor: colors.border },
  action: { alignItems: 'center', minWidth: 58 },
  actionIcon: { width: 46, height: 42, borderRadius: borderRadius.md, backgroundColor: colors.secondaryLight, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { color: colors.text, fontFamily: typography.families.medium, fontSize: typography.sizes.sm, marginTop: spacing.sm },
  sectionHeader: { marginTop: spacing.md, marginBottom: spacing.md },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: spacing['2xl'], marginBottom: spacing.md },
  sectionKicker: { color: colors.primary, fontFamily: typography.families.bold, fontSize: typography.sizes.xs, letterSpacing: 1.4 },
  sectionTitle: { color: colors.text, fontFamily: typography.families.bold, fontSize: typography.sizes.xl, letterSpacing: -.5, marginTop: 3 },
  seeAllButton: { minHeight: 44, justifyContent: 'center', paddingLeft: spacing.md },
  seeAll: { color: colors.primary, fontFamily: typography.families.semibold, fontSize: typography.sizes.sm, paddingBottom: 2 },
  devotionalCard: { backgroundColor: colors.secondaryLight, borderColor: '#CBE8E0', padding: spacing.xl },
  devotionalRef: { color: colors.primaryDark, fontFamily: typography.families.bold, fontSize: typography.sizes.sm },
  devotionalTitle: { color: colors.text, fontFamily: typography.families.bold, fontSize: typography.sizes['2xl'], letterSpacing: -.6, marginTop: spacing.md },
  devotionalText: { color: colors.textSecondary, fontSize: typography.sizes.base, lineHeight: 24, marginTop: spacing.md },
  cardLink: { color: colors.primaryDark, fontFamily: typography.families.semibold, fontSize: typography.sizes.sm, marginTop: spacing.lg },
  eventRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  dateTile: { width: 50, height: 56, borderRadius: borderRadius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  dateMonth: { color: colors.primary, fontFamily: typography.families.bold, fontSize: typography.sizes.xs, textTransform: 'uppercase' },
  dateDay: { color: colors.text, fontFamily: typography.families.bold, fontSize: typography.sizes.xl },
  eventInfo: { flex: 1 },
  eventTitle: { color: colors.text, fontFamily: typography.families.semibold, fontSize: typography.sizes.base },
  eventMeta: { color: colors.muted, fontSize: typography.sizes.sm, marginTop: 3 },
  chevron: { color: colors.muted, fontSize: 26 },
  emptyText: { color: colors.muted, fontSize: typography.sizes.md, paddingVertical: spacing.lg },
  sectionErrorPanel: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, backgroundColor: '#FFF7F5', borderRadius: borderRadius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  sectionError: { flexGrow: 1, flexShrink: 1, color: colors.error, fontSize: typography.sizes.sm, lineHeight: 19, paddingVertical: spacing.sm },
  sectionRetry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md },
  sectionRetryText: { color: colors.primaryDark, fontFamily: typography.families.semibold, fontSize: typography.sizes.sm },
  actionDisabled: { opacity: 0.5 },
  sermonRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  play: { width: 46, height: 46, borderRadius: 16, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  playText: { color: colors.primaryLight, fontSize: typography.sizes.sm, marginLeft: 2 },
});
