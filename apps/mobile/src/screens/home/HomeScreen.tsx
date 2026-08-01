import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Avatar } from '../../components/common/Avatar';
import { Card } from '../../components/common/Card';
import { useAuth } from '../../hooks/useAuth';
import eventService, { type ChurchEvent } from '../../services/event.service';
import spiritualService, { type Devotional, type Sermon } from '../../services/spiritual.service';
import { borderRadius, colors, spacing, typography } from '../../theme';
import type { RootStackParamList } from '../../components/navigation/AppNavigator';

type HomeNav = NativeStackNavigationProp<RootStackParamList>;

const quickActions = [
  { label: 'Give', symbol: '₵', route: 'Give' as const },
  { label: 'Events', symbol: '○', route: 'Events' as const },
  { label: 'Prayer', symbol: '+', screen: 'Prayer' as const },
  { label: 'Care', symbol: '♡', screen: 'Welfare' as const },
];

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function HomeScreen() {
  const navigation = useNavigation<HomeNav>();
  const { user } = useAuth();
  const [events, setEvents] = useState<ChurchEvent[]>([]);
  const [devotional, setDevotional] = useState<Devotional | null>(null);
  const [sermons, setSermons] = useState<Sermon[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadHome = useCallback(async () => {
    setIsLoading(true);
    setError('');
    const [eventResult, devotionalResult, sermonResult] = await Promise.allSettled([
      eventService.getUpcoming(3),
      spiritualService.getTodayDevotional(),
      spiritualService.getSermons({ limit: 2 }),
    ]);
    if (eventResult.status === 'fulfilled') setEvents(eventResult.value);
    if (devotionalResult.status === 'fulfilled') setDevotional(devotionalResult.value);
    if (sermonResult.status === 'fulfilled') setSermons(sermonResult.value.sermons);
    if ([eventResult, devotionalResult, sermonResult].every((result) => result.status === 'rejected')) {
      setError('Your church updates could not be loaded. Pull down on each section to try again.');
    }
    setIsLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { void loadHome(); }, [loadHome]));

  const fullName = `${user?.firstName ?? 'Member'} ${user?.lastName ?? ''}`.trim();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.topRow}>
        <View style={styles.greetingWrap}>
          <Text style={styles.greeting}>{greeting()},</Text>
          <Text style={styles.name}>{user?.firstName || 'Member'}.</Text>
          <Text style={styles.church}>{user?.churchName || 'Your church community'}</Text>
        </View>
        <Avatar name={fullName} uri={user?.avatar} size="lg" />
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
            <View style={styles.actionIcon}><Text style={styles.actionSymbol}>{action.symbol}</Text></View>
            <Text style={styles.actionLabel}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {error ? <Card style={styles.errorCard}><Text style={styles.errorText}>{error}</Text><TouchableOpacity onPress={() => void loadHome()}><Text style={styles.retry}>Try again</Text></TouchableOpacity></Card> : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionKicker}>FOR TODAY</Text>
        <Text style={styles.sectionTitle}>A quiet place to begin.</Text>
      </View>
      <TouchableOpacity onPress={() => navigation.navigate('Devotional')} activeOpacity={.82}>
        <Card style={styles.devotionalCard}>
          <Text style={styles.devotionalRef}>{devotional?.scriptureReference || (isLoading ? 'Loading…' : 'Daily devotional')}</Text>
          <Text style={styles.devotionalTitle}>{devotional?.title || (isLoading ? 'Preparing today’s reading' : 'No devotional has been published today')}</Text>
          {devotional?.scripture ? <Text style={styles.devotionalText} numberOfLines={3}>“{devotional.scripture}”</Text> : null}
          <Text style={styles.cardLink}>Read today&apos;s devotional →</Text>
        </Card>
      </TouchableOpacity>

      <View style={styles.sectionHeaderRow}>
        <View>
          <Text style={styles.sectionKicker}>COMING UP</Text>
          <Text style={styles.sectionTitle}>Gather together.</Text>
        </View>
        <TouchableOpacity onPress={() => navigation.navigate('MainTabs', { screen: 'Events' })}><Text style={styles.seeAll}>All events</Text></TouchableOpacity>
      </View>
      {events.length === 0 && !isLoading ? <Text style={styles.emptyText}>No upcoming events have been published.</Text> : events.map((event) => {
        const date = new Date(event.startDate);
        return (
          <TouchableOpacity key={event.id} onPress={() => navigation.navigate('EventDetail', { eventId: event.id })} activeOpacity={.8}>
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
        <TouchableOpacity onPress={() => navigation.navigate('Sermons')}><Text style={styles.seeAll}>All sermons</Text></TouchableOpacity>
      </View>
      {sermons.length === 0 && !isLoading ? <Text style={styles.emptyText}>No sermons are available yet.</Text> : sermons.map((sermon) => (
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
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.text, borderRadius: borderRadius['2xl'], padding: spacing.xl },
  greetingWrap: { flex: 1 },
  greeting: { color: 'rgba(255,255,255,.62)', fontSize: typography.sizes.base },
  name: { color: colors.surface, fontSize: typography.sizes['3xl'], lineHeight: 35, fontWeight: typography.weights.bold, letterSpacing: -1 },
  church: { color: colors.primaryLight, fontSize: typography.sizes.sm, marginTop: spacing.sm },
  actionGrid: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: spacing.xl, paddingHorizontal: spacing.sm },
  action: { alignItems: 'center', minWidth: 58 },
  actionIcon: { width: 50, height: 50, borderRadius: 17, backgroundColor: colors.secondaryLight, alignItems: 'center', justifyContent: 'center' },
  actionSymbol: { color: colors.primaryDark, fontSize: typography.sizes.xl, fontWeight: typography.weights.bold },
  actionLabel: { color: colors.text, fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, marginTop: spacing.sm },
  errorCard: { backgroundColor: '#FFF7F5', borderColor: '#EBCDC8', marginBottom: spacing.xl },
  errorText: { color: colors.error, fontSize: typography.sizes.md, lineHeight: 20 },
  retry: { color: colors.primary, fontWeight: typography.weights.semibold, marginTop: spacing.sm },
  sectionHeader: { marginTop: spacing.md, marginBottom: spacing.md },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: spacing['2xl'], marginBottom: spacing.md },
  sectionKicker: { color: colors.primary, fontSize: typography.sizes.xs, fontWeight: typography.weights.bold, letterSpacing: 1.4 },
  sectionTitle: { color: colors.text, fontSize: typography.sizes.xl, fontWeight: typography.weights.bold, letterSpacing: -.5, marginTop: 3 },
  seeAll: { color: colors.primary, fontSize: typography.sizes.sm, fontWeight: typography.weights.semibold, paddingBottom: 2 },
  devotionalCard: { backgroundColor: colors.secondaryLight, borderColor: '#CBE8E0', padding: spacing.xl },
  devotionalRef: { color: colors.primaryDark, fontSize: typography.sizes.sm, fontWeight: typography.weights.bold },
  devotionalTitle: { color: colors.text, fontSize: typography.sizes['2xl'], fontWeight: typography.weights.bold, letterSpacing: -.6, marginTop: spacing.md },
  devotionalText: { color: colors.textSecondary, fontSize: typography.sizes.base, lineHeight: 24, marginTop: spacing.md },
  cardLink: { color: colors.primaryDark, fontSize: typography.sizes.sm, fontWeight: typography.weights.semibold, marginTop: spacing.lg },
  eventRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  dateTile: { width: 50, height: 56, borderRadius: borderRadius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  dateMonth: { color: colors.primary, fontSize: typography.sizes.xs, fontWeight: typography.weights.bold, textTransform: 'uppercase' },
  dateDay: { color: colors.text, fontSize: typography.sizes.xl, fontWeight: typography.weights.bold },
  eventInfo: { flex: 1 },
  eventTitle: { color: colors.text, fontSize: typography.sizes.base, fontWeight: typography.weights.semibold },
  eventMeta: { color: colors.muted, fontSize: typography.sizes.sm, marginTop: 3 },
  chevron: { color: colors.muted, fontSize: 26 },
  emptyText: { color: colors.muted, fontSize: typography.sizes.md, paddingVertical: spacing.lg },
  sermonRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  play: { width: 46, height: 46, borderRadius: 16, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  playText: { color: colors.primaryLight, fontSize: typography.sizes.sm, marginLeft: 2 },
});
