import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  FlatList,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Avatar } from '../../components/common/Avatar';
import { Card } from '../../components/common/Card';
import { useAuth } from '../../hooks/useAuth';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import type { RootStackParamList } from '../../components/navigation/AppNavigator';

type HomeNav = NativeStackNavigationProp<RootStackParamList>;

// TODO: Replace with real data from API
const mockAnnouncements = [
  {
    id: '1',
    title: 'Sunday Service Time Change',
    body: 'Starting next week, our Sunday service will begin at 10:00 AM.',
    date: '2026-03-29',
  },
  {
    id: '2',
    title: 'Youth Camp Registration',
    body: 'Register your children for summer youth camp. Limited spots available!',
    date: '2026-03-28',
  },
];

const mockUpcomingEvents = [
  {
    id: '1',
    title: 'Sunday Worship',
    date: 'Mar 30',
    time: '10:00 AM',
    location: 'Main Sanctuary',
  },
  {
    id: '2',
    title: 'Bible Study',
    date: 'Apr 1',
    time: '7:00 PM',
    location: 'Fellowship Hall',
  },
  {
    id: '3',
    title: 'Prayer Night',
    date: 'Apr 3',
    time: '6:30 PM',
    location: 'Chapel',
  },
];

const mockSermons = [
  {
    id: '1',
    title: 'Walking in Faith',
    speaker: 'Pastor James',
    date: 'Mar 23, 2026',
  },
  {
    id: '2',
    title: 'The Power of Grace',
    speaker: 'Pastor Sarah',
    date: 'Mar 16, 2026',
  },
];

interface QuickAction {
  label: string;
  icon: string;
  screen: keyof RootStackParamList;
  color: string;
}

const quickActions: QuickAction[] = [
  { label: 'Give', icon: '\u2665', screen: 'MainTabs', color: colors.secondary },
  { label: 'Pray', icon: '\u270B', screen: 'Prayer', color: colors.primary },
  { label: 'Events', icon: '\u2605', screen: 'MainTabs', color: colors.info },
  { label: 'Sermons', icon: '\u25B6', screen: 'Sermons', color: colors.success },
];

export function HomeScreen() {
  const navigation = useNavigation<HomeNav>();
  const { user } = useAuth();

  const firstName = user?.firstName || 'Member';

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Welcome Header */}
      <View style={styles.welcomeSection}>
        <View style={styles.welcomeRow}>
          <View style={styles.welcomeText}>
            <Text style={styles.greeting}>Good morning,</Text>
            <Text style={styles.userName}>{firstName}</Text>
          </View>
          <Avatar
            name={`${user?.firstName || 'U'} ${user?.lastName || ''}`}
            uri={user?.avatar}
            size="lg"
          />
        </View>
        {user?.churchName && (
          <Text style={styles.churchName}>{user.churchName}</Text>
        )}
      </View>

      {/* Quick Actions */}
      <View style={styles.quickActions}>
        {quickActions.map((action) => (
          <TouchableOpacity
            key={action.label}
            style={styles.quickAction}
            onPress={() => navigation.navigate(action.screen)}
            activeOpacity={0.7}
          >
            <View
              style={[styles.quickActionIcon, { backgroundColor: action.color }]}
            >
              <Text style={styles.quickActionEmoji}>{action.icon}</Text>
            </View>
            <Text style={styles.quickActionLabel}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Announcements */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Announcements</Text>
        {mockAnnouncements.map((announcement) => (
          <Card key={announcement.id} style={styles.announcementCard}>
            <Text style={styles.announcementTitle}>{announcement.title}</Text>
            <Text style={styles.announcementBody}>{announcement.body}</Text>
            <Text style={styles.announcementDate}>{announcement.date}</Text>
          </Card>
        ))}
      </View>

      {/* Upcoming Events */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Upcoming Events</Text>
          <TouchableOpacity onPress={() => navigation.navigate('MainTabs')}>
            <Text style={styles.seeAll}>See All</Text>
          </TouchableOpacity>
        </View>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={mockUpcomingEvents}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.eventsList}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.eventCard}
              onPress={() =>
                navigation.navigate('EventDetail', { eventId: item.id })
              }
              activeOpacity={0.7}
            >
              <View style={styles.eventDateBadge}>
                <Text style={styles.eventDateText}>{item.date}</Text>
              </View>
              <Text style={styles.eventTitle}>{item.title}</Text>
              <Text style={styles.eventTime}>{item.time}</Text>
              <Text style={styles.eventLocation}>{item.location}</Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {/* Recent Sermons */}
      <View style={[styles.section, styles.lastSection]}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Sermons</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Sermons')}>
            <Text style={styles.seeAll}>See All</Text>
          </TouchableOpacity>
        </View>
        {mockSermons.map((sermon) => (
          <Card key={sermon.id} style={styles.sermonCard}>
            <View style={styles.sermonRow}>
              <View style={styles.playButton}>
                <Text style={styles.playIcon}>{'\u25B6'}</Text>
              </View>
              <View style={styles.sermonInfo}>
                <Text style={styles.sermonTitle}>{sermon.title}</Text>
                <Text style={styles.sermonMeta}>
                  {sermon.speaker} \u2022 {sermon.date}
                </Text>
              </View>
            </View>
          </Card>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  welcomeSection: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.base,
    paddingBottom: spacing['2xl'],
    borderBottomLeftRadius: borderRadius['2xl'],
    borderBottomRightRadius: borderRadius['2xl'],
  },
  welcomeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  welcomeText: {
    flex: 1,
  },
  greeting: {
    fontSize: typography.sizes.base,
    color: 'rgba(255,255,255,0.8)',
  },
  userName: {
    fontSize: typography.sizes['3xl'],
    fontWeight: typography.weights.bold,
    color: '#FFFFFF',
  },
  churchName: {
    fontSize: typography.sizes.sm,
    color: 'rgba(255,255,255,0.7)',
    marginTop: spacing.xs,
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: spacing.base,
    marginTop: -spacing.lg,
    marginBottom: spacing.base,
  },
  quickAction: {
    alignItems: 'center',
  },
  quickActionIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.md,
  },
  quickActionEmoji: {
    fontSize: 22,
    color: '#FFFFFF',
  },
  quickActionLabel: {
    fontSize: typography.sizes.sm,
    color: colors.text,
    fontWeight: typography.weights.medium,
    marginTop: spacing.xs,
  },
  section: {
    paddingHorizontal: spacing.xl,
    marginTop: spacing.xl,
  },
  lastSection: {
    marginBottom: spacing['2xl'],
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.bold,
    color: colors.text,
    marginBottom: spacing.md,
  },
  seeAll: {
    fontSize: typography.sizes.md,
    color: colors.primary,
    fontWeight: typography.weights.medium,
    marginBottom: spacing.md,
  },
  announcementCard: {
    marginBottom: spacing.md,
  },
  announcementTitle: {
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.semibold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  announcementBody: {
    fontSize: typography.sizes.md,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  announcementDate: {
    fontSize: typography.sizes.sm,
    color: colors.muted,
    marginTop: spacing.sm,
  },
  eventsList: {
    paddingRight: spacing.xl,
  },
  eventCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.base,
    marginRight: spacing.md,
    width: 160,
    ...shadows.sm,
  },
  eventDateBadge: {
    backgroundColor: colors.primaryLight + '20',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    alignSelf: 'flex-start',
    marginBottom: spacing.sm,
  },
  eventDateText: {
    fontSize: typography.sizes.sm,
    color: colors.primary,
    fontWeight: typography.weights.semibold,
  },
  eventTitle: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  eventTime: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
  },
  eventLocation: {
    fontSize: typography.sizes.sm,
    color: colors.muted,
    marginTop: 2,
  },
  sermonCard: {
    marginBottom: spacing.md,
  },
  sermonRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  playIcon: {
    color: '#FFFFFF',
    fontSize: 16,
    marginLeft: 2,
  },
  sermonInfo: {
    flex: 1,
  },
  sermonTitle: {
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.semibold,
    color: colors.text,
  },
  sermonMeta: {
    fontSize: typography.sizes.sm,
    color: colors.muted,
    marginTop: 2,
  },
});
